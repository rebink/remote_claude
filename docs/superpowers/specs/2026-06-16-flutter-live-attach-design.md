# Flutter live-attach — remote agent eyes on the local running app

**Date:** 2026-06-16
**Status:** Approved design, ready for plan
**Relates to:** `2026-06-03-local-hotreload-alignment-design.md` (M5 — local-hot-reload + privacy model), `2026-06-03-device-bridge-design.md` (M4 — deleted, off-model)

---

## Problem

In the current product model (M5), the remote AI agent works only on synced code and returns a git diff applied to the developer's **local** project; the developer runs `flutter run` **locally** (simulator / device / web) with full hot reload. The agent is **blind** — it edits code it cannot see rendered, and cannot verify its own UI changes.

This feature gives the remote agent **eyes and hot-reload control on the live, locally-running Flutter app**: screenshot, widget-tree inspect, runtime logs, and hot reload/restart — driven over the app's Dart VM Service.

## What this is NOT (vs deleted device-bridge M4)

M4 ran `flutter run` **on the remote** against a local physical device over adb-over-Tailscale (compile + run remote). It was deleted as off-model. **This feature does the opposite:** the app is compiled and run **locally** by the developer; only an **observe/control channel** to the local Dart VM Service is exposed to the remote agent. Compile and run stay on the laptop. Reviewers must not pattern-match this to M4.

## Privacy / threat model (explicit — see M5 stance)

M5 markets: *"the agent only ever sees the project you sync, never the rest of your laptop."* This feature opens a **reverse ingress** channel into the laptop: the Dart VM Service is a full debug-control protocol (`evaluate` = arbitrary Dart in the running process). Decisions that keep this honest and on-model:

- **Opt-in, per-session, dev-initiated.** Off by default. Nothing is exposed until the developer attaches a session in the Flutter panel for an open project.
- **Scoped tools only.** The MCP server exposes exactly four tools (hot-reload, screenshot, inspect, logs). It does **not** expose a raw `evaluate` / arbitrary-eval tool. The underlying VM Service still technically permits eval; we deliberately do not surface it.
- **Remote bind is loopback.** The reverse tunnel binds the remote listener to `127.0.0.1` so only the agent host (not other tailnet peers) can reach the VM Service.
- **Ephemeral.** Teardown on detach or app death; no persisted credentials. The only persisted state is a per-project `flutterEnabled` flag.
- **Website honesty.** M5's stance copy gets a caveat: the no-touch guarantee holds *unless you explicitly attach a live Flutter session*.

## Decisions (from brainstorm)

| Topic | Decision |
|---|---|
| App lifecycle | Patchwire **never** owns `flutter run`. Attach to the dev-launched app. |
| URI discovery | Manual paste is the reliable path; convenience detection = clipboard scan + optional `--vmservice-out-file` watch. |
| Transport | **Reverse SSH tunnel** (`ssh -R`), reusing existing SSH creds (`ssh-runner.ts`). |
| Capabilities | Hot reload/restart, screenshot, widget-tree inspect, logs/errors stream. |
| Agent interface | **MCP server** `patchwire-flutter` on the remote; `claude` auto-discovers tools. |
| Session model | **Per-project ephemeral attach** via a Flutter panel; status pill; re-attach on restart. |
| Web target | **Degraded**: hot restart + inspect + logs; **no screenshot** (no fallback). |
| Sim/device target | **Full**: hot reload + screenshot + inspect + logs. |

## Flow

```
dev runs `flutter run` locally (sim/device/web)
        │  prints: "A Dart VM Service ... is available at: http://127.0.0.1:PORT/<token>=/"
        ▼
Desktop Flutter panel: paste/detect URI → Attach
        │  validate: connect VM Service WS, getVM, find Flutter isolate (ext.flutter.* registered)
        ▼
Tunnel manager: ssh -R <remotePort>:127.0.0.1:<localPort>  (remote bound 127.0.0.1)
        │  register session with agent server (new protocol event): tunneled URL + target kind (device|web)
        ▼
ai-runner spawns `claude --mcp-config ...` → patchwire-flutter MCP server
        │  MCP connects WS to http://127.0.0.1:<remotePort>/<token>=/ws
        ▼
agent calls flutter_hot_reload / flutter_screenshot / flutter_inspect / flutter_logs
```

## Architecture

### 1. Pure core — VM Service URI + capability logic (no I/O)

A pure, testable module (CLI lib, e.g. `lib/flutter-vmservice.ts`):

```ts
interface VmServiceUri { host: string; port: number; authPath: string }   // authPath = '/<token>=/'
type Parse<T> = { ok: true; value: T } | { ok: false; error: string }

parseVmServiceUri(raw: string): Parse<VmServiceUri>          // accepts http(s)/ws(s), tolerant of trailing /ws
wsUrlFor(uri: VmServiceUri, host: string, port: number): string   // ws://host:port/<token>=/ws  — token PRESERVED
type TargetKind = 'device' | 'web' | 'desktop'
capabilitiesFor(kind: TargetKind): { hotReload: boolean; screenshot: boolean; inspect: boolean; logs: boolean }
                                                            // web/desktop => screenshot:false
```

The auth token lives in the **URL path**; tunnel is transparent TCP so the path is preserved end-to-end. The MCP server reuses the same token path against `127.0.0.1:<remotePort>`.

### 2. Tunnel manager (CLI lib + desktop wiring)

- Reuses `ssh-runner.ts` config (host/user/sshPort) from `patchwire.yml`.
- Builds `ssh -R 127.0.0.1:<remotePort>:127.0.0.1:<localPort> ...` (loopback bind both sides).
- Pure arg-builder `buildReverseTunnelArgs(...)` for unit testing; the spawn/lifecycle is injected.
- Lifecycle: open on Attach, kill on Detach / WS close / app death. Surfaces tunnel-down as panel `error`.
- Remote port allocation: pick a free remote port (probe via SSH or a fixed range); recorded in the session registration.

### 3. Remote MCP server — `patchwire-flutter`

A small MCP server shipped to / runnable on the remote. Reads the session (tunneled URL + `TargetKind`) from env / a session file written by the agent server. Connects WS to the VM Service. Tools:

- `flutter_hot_reload({ restart?: boolean })` → `reloadSources` on the Flutter isolate (`restart:true` → full restart). Returns success + any reload errors.
- `flutter_screenshot()` → `_flutter.screenshot` → PNG (returned as MCP image). **Disabled when `screenshot:false`** (web/desktop) → returns "unsupported on this target".
- `flutter_inspect({ subtree? })` → `ext.flutter.inspector.getRootWidgetTree` (or summary tree). Requires a debug build.
- `flutter_logs({ sinceMs?, limit? })` → subscribes to `Stdout`/`Stderr`/`Extension`/`Logging` streams, buffers, returns recent entries.
- **No raw `evaluate` tool.** (Threat-model decision above.)

Isolate selection: enumerate isolates via `getVM`, pick the one with `ext.flutter.*` extension RPCs registered.

### 4. Session plumbing (protocol + agent server + ai-runner)

- **Protocol** (`packages/protocol`): new event `flutterSession` — `{ projectId, url, target: TargetKind, action: 'attach'|'detach' }`.
- **Agent server** (`agent/server.ts`): stores the active flutter session per project; on `detach`/disconnect clears it.
- **ai-runner** (`agent/ai-runner.ts`): when a project has an active flutter session, injects the `patchwire-flutter` MCP config (`--mcp-config`) and the session URL/target into the spawned `claude` process env.

### 5. Desktop Flutter panel (per open project)

- URI input + **Detect** button (clipboard scan; optional `--vmservice-out-file` watch).
- **Attach / Detach** button; status pill: `detached → attaching → attached → error`.
- On Attach: validate (WS connect → `getVM` → confirm Flutter isolate + detect `TargetKind`), open tunnel, register session.
- Shows `TargetKind` and which capabilities are live (e.g. web → "screenshot unavailable").
- On WS close / app restart: flip to `detached`, prompt re-attach. No silent stale state.
- Project carries a `flutterEnabled` flag (only persisted state).

## Capability matrix

| Target | Hot reload | Hot restart | Screenshot | Inspect | Logs |
|---|---|---|---|---|---|
| Simulator / device | ✅ | ✅ | ✅ | ✅ | ✅ |
| Web (DDC) | ⚠️ restart-only | ✅ | ❌ unsupported | ✅ | ✅ |
| Desktop | ✅ | ✅ | ❌ unsupported | ✅ | ✅ |

## Known risks / caveats (carry into docs)

- **Web runs on DDC**, not the standard VM Service: `_flutter.screenshot` does not exist; hot reload is restart-only/flaky. Hence the degraded matrix. No headless-browser screenshot fallback in v1.
- **DDS multi-client.** Modern Flutter wraps the VM Service in DDS. Our WS connect must not evict an already-attached IDE/DevTools. DDS multiplexes in current versions — **verify against the targeted Flutter version** during implementation.
- **Ephemeral churn.** Hot-restart/relaunch rotates port+token → tunnel dead. Handled by WS-close detection → re-attach prompt.
- **Detection is best-effort.** Without owning `flutter run`, auto-detect is convenience only; manual paste is the contract.
- **Egress model.** This is reverse *ingress* (remote→local), orthogonal to the M3 egress seatbelt; note it in the threat-model docs so it isn't assumed covered by egress controls.

## Verifiability / honest scope

CI covers the **pure logic** (`parseVmServiceUri`, `wsUrlFor`, `capabilitiesFor`, `buildReverseTunnelArgs`) and the **orchestration with faked deps** (tunnel spawn, session registration, ai-runner MCP injection). The **live loop** (real `flutter run` → attach → remote agent screenshot/hot-reload) can only be verified by the user on a real machine with a real device/sim — stated explicitly, like M4 did. v1 ships the safe, testable plumbing and a documented manual live-verification checklist.

## Out of scope (v1)

- Patchwire launching/owning `flutter run`.
- Headless-browser screenshot fallback for web.
- Raw `evaluate` / arbitrary-eval tool.
- iOS-specific tooling beyond what the standard VM Service already provides.
- Auto-detect-on-open background scanning (manual/clipboard detect only).
- Persisting VM credentials across restarts.

## Build sequence (for the plan)

1. Pure core `lib/flutter-vmservice.ts` + tests (`parseVmServiceUri`, `wsUrlFor`, `capabilitiesFor`).
2. Tunnel manager `buildReverseTunnelArgs` + injectable lifecycle + tests.
3. Protocol `flutterSession` event; agent-server session store; ai-runner MCP injection + tests (faked deps).
4. `patchwire-flutter` MCP server (4 tools, isolate selection, target gating).
5. Desktop Flutter panel (paste/detect, attach/detach, status pill, capability display).
6. Docs: feature page + threat-model note + website stance caveat + manual live-verification checklist.
