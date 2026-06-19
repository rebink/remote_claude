# Service Projection — Phase 2 (Desktop UI) Design Spec

**Date:** 2026-06-19
**Status:** Approved for implementation
**Topic:** A desktop "Services" panel that drives the P1 service-projection engine — discover local Docker/Dart services, bind them onto the remote agent's loopback, and show live status — plus the manager hardening (backoff, failed/stale) that the UI needs.

**Depends on:** Phase 1 (`feat/service-projection-p1`, PR #74). P2 builds on that engine; its implementation branch should be based on the P1 branch until P1 merges.

**P1 spec:** `docs/superpowers/specs/2026-06-19-service-projection-design.md`

## Problem

P1 shipped the projection engine and a one-shot CLI (`patchwire services discover|bind`). The CLI `bind` is fire-and-hold: usable from a terminal but with no unified status, no rich lifecycle, and no GUI. Developers using the desktop app cannot discover or bind their local services, and the manager only reports `active`/`reconnecting` (the `failed`/`stale` statuses and exponential backoff were explicitly deferred to P2).

P2 delivers the desktop "Services" panel: open a project → see local Docker DBs and Flutter/Dart servers → toggle each onto the remote agent's loopback → watch live status. It also hardens the manager so the panel can show honest state.

## Goals

- Harden the manager: exponential backoff, give-up (`failed`) after N attempts, and `stale` detection when a bound service vanishes; plus `retry(id)` and `refresh()`.
- Add a long-lived streaming CLI session (`patchwire services serve --stream`) that owns the manager and bridges to the desktop over NDJSON stdin/stdout.
- Add desktop Tauri commands + state to run one session per workspace, forward commands, and relay status events.
- Add a `ServicesPanel` (Svelte) in the Workspace screen: candidate/projection rows, bind toggle, status pill, connection-hint copy, retry.
- Persist bound service ids per project and auto-rebind them on workspace reopen.

## Non-Goals

- No VS Code extension (that is P3).
- No new transport (still Approach A `ssh -R` from P1; the manager interface is unchanged at the transport seam).
- No tailnet exposure, no forward tunneling — P1 security invariants hold unchanged.
- The desktop never opens tunnels itself; it only drives the CLI session.

## Approved Decisions

| Decision | Choice |
|----------|--------|
| Panel on workspace open | Auto-discover + auto-rebind previously-bound services; show the rest as available |
| Manager hardening | Full: exponential backoff + `failed` (give-up) + `stale` (vanished) |
| Desktop↔CLI bridge | Approach A — one long-lived `services serve --stream` process per workspace, NDJSON over stdin/stdout |
| Confirm-before-bind | The panel toggle IS the confirm (no separate prompt in the GUI) |
| Dart discovery in desktop | Reuse the existing `detect_vm_uri` command; pass the URI into the session as a discover hint |

## Architecture

```
 DESKTOP (Tauri + Svelte)                              CLI (one process per workspace)
 ┌────────────────────────────┐                        ┌─────────────────────────────────┐
 │ ServicesPanel.svelte        │  invoke               │  patchwire services serve --stream│
 │   rows, toggle, pills, copy │  services_send(json)  │   owns ServiceProjectionManager   │
 │        │ reducer            │ ────────stdin NDJSON──▶│   {discover|bind|unbind|retry}    │
 │ services-session.ts (pure)  │                        │                                   │
 │        ▲ pw://services       │ ◀──────stdout NDJSON──│   emits {candidates|status|error} │
 │        │ Tauri event         │                        │   writes .patchwire/services.json │
 │ lib.rs: start/stop/send      │                        │        │ ssh -R (loopback)        │
 │   ServicesSessionState(child)│                        └────────┼──────────────────────────┘
 └────────────────────────────┘                                  ▼ remote 127.0.0.1:port
```

## Components

### A. Manager hardening — `packages/cli/src/services/manager.ts`

Extend `makeManager(transport, deps)` without breaking its P1 interface:

- **Backoff:** replace the flat `delay()` with an attempt-indexed schedule. `deps.backoff?(attempt: number): number` returns ms; default `Math.min(1000 * 2 ** attempt, 30_000)`. `deps.delay?` (P1) stays supported as an injectable sleeper for tests (`(ms) => Promise`).
- **`failed`:** track per-entry `attempts`. After `deps.maxAttempts ?? 6` consecutive failed reconnects, stop retrying and set status `failed`. A successful reopen resets `attempts` to 0.
- **`stale`:** new `refresh(present: DiscoveredService[])` — for each bound entry whose `id` is absent from `present`, tear down its tunnel and set status `stale`. (The session calls this after each discovery tick.)
- **`retry(id)`:** re-arm a `failed` or `stale` entry — reset `attempts`, set `reconnecting`, attempt a fresh bind via `firstStablePort` (re-mirror), emit.
- Status union already includes `binding|active|reconnecting|failed|stale`; this task makes all of them reachable. Remove the P1 "reserved for P2" comment.

### B. Streaming session — `packages/cli/src/services/session.ts` + `serve --stream` subcommand

`runServicesSession(io)` where `io` abstracts the NDJSON line source/sink (injectable for tests; defaults to `process.stdin`/`process.stdout`):

- **stdin commands (one JSON object per line):**
  - `{ "cmd": "discover", "dartVmUri"?: string }` — run Docker discoverer + Dart discoverer (the latter seeded from `dartVmUri` if provided, else `PW_DART_OUTPUT`); emit `candidates`; then call `manager.refresh(candidates)` to reconcile staleness.
  - `{ "cmd": "bind", "id": string }` — find candidate by id, `manager.bind(svc)`.
  - `{ "cmd": "unbind", "id": string }` — `manager.unbind(id)`.
  - `{ "cmd": "retry", "id": string }` — `manager.retry(id)`.
- **stdout events (one JSON object per line):**
  - `{ "type": "candidates", "services": DiscoveredService[] }`
  - `{ "type": "status", "projections": Projection[] }` — emitted on every manager `change`.
  - `{ "type": "error", "message": string }` — malformed command or bind failure (does not crash the session).
- Subscribes `manager.on('change', …)` → writes the manifest (P1 behavior) AND emits a `status` event.
- On stdin EOF / SIGTERM → `manager.stopAll()` and exit.
- Wired as `patchwire services serve --stream` in `commands/services.ts` (the existing `discover`/`bind` one-shots stay).

### C. Desktop Tauri — `packages/desktop/src-tauri/src/lib.rs`

`ServicesSessionState` (managed state, like `SyncWatchState`): holds the spawned child process + its stdin writer behind a mutex.

- `start_services(project_dir, dart_vm_uri?)` — spawn `patchwire services serve --stream` (resolve the CLI the same way existing commands do), store child + stdin, and stream each stdout line to the frontend as a `pw://services` event. Idempotent per workspace (stop any prior child first).
- `services_send(json: String)` — write `json + "\n"` to the child's stdin. Used for discover/bind/unbind/retry.
- `stop_services()` — kill the child (drops all tunnels), clear state.

Security: validate `project_dir` like other commands; never log the manifest contents or connection strings.

### D. Desktop frontend

- `packages/desktop/src/lib/services-session.ts` — pure `reduceServices(state, event)` over parsed `pw://services` events → `{ candidates: DiscoveredService[], projections: Projection[], error?: string }`. Mirrors `flutter-attach.ts`. Includes a parser `parseServicesLine(raw): ServicesEvent | null`.
- `packages/desktop/src/lib/ipc.ts` — `startServices(projectDir, dartVmUri?)`, `servicesSend(cmd)`, `stopServices()`, `onServicesEvent(handler)`.
- `packages/desktop/src/components/ServicesPanel.svelte` — slots into `Workspace.svelte`'s right column after `FlutterPanel`. On mount: `startServices` (passing `detect_vm_uri` result), subscribe, send `{cmd:"discover"}`, then auto-send `{cmd:"bind"}` for each persisted id. On unmount: `stopServices`. Renders one row per candidate/projection:
  - label + kind, a **bind toggle** (toggle on → `bind`, off → `unbind`),
  - a status pill (`available | binding | active | reconnecting | failed | stale`),
  - the remote `127.0.0.1:<remotePort>` hint with a **copy** button,
  - a **Retry** button shown on `failed`/`stale`.
- Wire into `Workspace.svelte`; persist the bound id set via `save_project` whenever it changes.

### E. Persistence — project record

Add a `boundServiceIds: string[]` field to the project record (read/written through the existing `list_projects`/`save_project` path). The panel maintains it; it is the source for auto-rebind on reopen.

## Data Flow

1. Workspace mounts → `detect_vm_uri` → `start_services(projectDir, vmUri)` → child spawns, manager idle.
2. Panel sends `{cmd:"discover"}` → session emits `candidates` → reducer fills the list.
3. Panel auto-sends `{cmd:"bind", id}` for each persisted id → session binds → `status` events → pills go `binding`→`active`.
4. Dev toggles a row → `bind`/`unbind` → status updates; bound id set persisted via `save_project`.
5. A bound container stops → next `discover` tick → `refresh` marks it `stale` → pill updates; dev clicks Retry once it's back.
6. Workspace unmounts → `stop_services` → child killed → all tunnels dropped.

## Error Handling

| Condition | Behavior |
|-----------|----------|
| ssh tunnel drops | Manager backs off exponentially; pill `reconnecting`; recovers to `active` |
| Reconnect attempts exhausted (N) | Status `failed`; Retry button re-arms |
| Bound service vanishes | `refresh` → `stale`; tunnel town down; Retry once present again |
| Malformed stdin command | Session emits `{type:"error"}`, keeps running |
| Session process dies unexpectedly | Desktop surfaces an error in the panel; dev can reopen the workspace to restart it |
| Docker down at discover | Empty Docker candidates (P1 behavior); Dart candidates still listed |

## Testing

**CLI:**
- Manager: backoff schedule (attempt→ms), `failed` after N, `attempts` reset on success, `stale` via `refresh`, `retry` re-arm — fake spawn + injected `backoff`/`delay`.
- Session: drive `runServicesSession` with a scripted line source; assert emitted events for discover/bind/unbind/retry/malformed; assert manifest written on change; assert clean shutdown on EOF.

**Desktop:**
- `reduceServices` / `parseServicesLine`: event stream → view state, bad lines ignored.
- `ServicesPanel.svelte`: renders rows, toggle sends the right command, pills reflect status, copy button copies the hint, Retry shows only on failed/stale (Vitest + Testing Library, mirroring `FlutterPanel.test.ts`).
- Rust: `start/stop/send` happy path + kill-on-stop (mirror the `sync_watch` command tests).

## Build Order (single phase, two sub-units)

1. **CLI:** manager hardening → session + `serve --stream`. Fully unit-testable headless; validates the protocol before any desktop work.
2. **Desktop:** Tauri commands + state → IPC + reducer → `ServicesPanel` → wire into `Workspace` + persistence.

## Roadmap

- **P3** — VS Code extension port-forwarding panel, a thin client over the same session protocol.
