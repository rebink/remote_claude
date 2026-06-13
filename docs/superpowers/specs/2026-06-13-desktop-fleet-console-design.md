# Patchwire Desktop — Provisioning & Fleet Console (v1 design)

| | |
|---|---|
| **Status** | Approved (brainstorm) — ready for implementation plan |
| **Date** | 2026-06-13 |
| **Parent** | `docs/patchwire-v2-product-architecture-strategy.md` (this is the downstream *Patchwire Desktop Architecture Specification*, scoped to v1) |
| **Related** | `docs/superpowers/specs/2026-06-13-remote-ssh-provisioning-design.md`; `docs/superpowers/validation/TEAM-real-host-test-checklist.md` |

## 1. Summary & locked decisions

The desktop app's **v1 job is a provisioning + fleet console**: a GUI to provision remote
machines and manage a small fleet of agents (health, logs, uninstall/re-run). It deliberately
defers AI session/chat UI to a later version.

Locked decisions (from brainstorm):

- **Foundation: GUI over the CLI.** The app spawns the existing `patchwire` CLI as a subprocess
  and renders its structured events. No business logic is reimplemented in the desktop app. This
  honors the v2 principle that the CLI is "the substrate the others reuse," and avoids forking
  the extension's logic before `@patchwire/core` is extracted.
- **Stack: Tauri** (Rust shell + system webview) with the **bun-compiled CLI bundled as a sidecar**.
  Chosen for a small, secure binary fitting a security product; in-process Node is unnecessary
  because we shell out to the CLI binary.
- **UI: match the extension** — vanilla TypeScript + the extension's `h()` hyperscript helper +
  plain CSS, bundled with **tsup/esbuild**. No UI framework. VS Code `postMessage` is replaced by
  **Tauri IPC** (`invoke` + event channel).
- **v1 scope:** provisioning **wizard** + persisted **host inventory**. Host list is client-side
  (no control plane — consistent with "a single workspace works without a control plane").
- **Platforms:** macOS-first for development; build for mac/linux/windows for the internal team.
  **Code signing / notarization deferred** (internal testers use ad-hoc/unsigned builds).

## 2. The CLI seam (Phase 0 — prerequisite)

The current `setup --provision-remote --json` is **single-shot**: it suppresses per-step events
(`onEvent` returns early when `!human`) and emits only a final JSON blob, and its consent gate
returns `false` in `--json` mode (cannot prompt). A GUI wizard needs **live streamed progress**
and **GUI-driven consent**, so the CLI must gain a machine event-stream mode. This is pure CLI
work, fully unit-testable, and is the contract the desktop app binds to.

**`patchwire setup --provision-remote --stream [flags]`:**

- Emits **one NDJSON object per line** to stdout for every orchestrator event:
  `{"type":"preview","plan":…,"elevation":…}`, `{"type":"step","step":…,"status":"start|ok|degraded|failed","detail":…}`,
  `{"type":"rollback","step":…}`, and a terminal `{"type":"done","status":"completed|rolled-back|cancelled","outcome":…,"health":…}`.
  Event shapes reuse the existing `ProvisionEvent`/`PreviewEvent`/`HealthReport` types from the
  provisioning module (and, where applicable, `@patchwire/protocol`).
- **Consent over stdin:** after emitting the `preview` line, the process reads **one line of stdin**
  and expects `{"consent":true}` or `{"consent":false}`. `true` proceeds to execute; `false`
  cancels (emits a `done` with `status:"cancelled"`). EOF/invalid → treated as `false`.
- stderr carries human/log noise only; stdout is pure NDJSON so the GUI can parse line-by-line.

**`patchwire doctor --json`** — add structured output (agent reachable/health/version) so the
inventory can refresh per-host status. `agent-log --json` and `usage --json` already exist and are
reused for the logs view.

> Alternative considered: two separate CLI calls (plan-only, then `execute --yes`). Rejected for
> v1 — a single long-running streamed process gives continuous progress and a clean consent point,
> and avoids re-running detection.

## 3. Architecture

```
  ┌──────────────────────── Tauri app (packages/desktop) ────────────────────────┐
  │  Web UI (vanilla TS + h() + CSS, tsup-bundled)                                 │
  │    • Wizard view        • Inventory view        • Logs view                    │
  │            │  Tauri IPC (invoke + event channel)  ▲                            │
  │            ▼                                       │ NDJSON lines               │
  │  Rust shell (thin):                                                            │
  │    • spawn bundled CLI sidecar   • pipe stdout(NDJSON)→UI   • UI→stdin(consent)│
  │    • read/write hosts.json (app-data dir)   • OS keychain for tokens           │
  └───────────────────────────────┬───────────────────────────────────────────────┘
                                   │ spawns
                       bun-compiled `patchwire` binary (sidecar, per-OS)
                                   │ SSH
                              remote agent(s)
```

### Components (each: purpose / interface / depends-on)

1. **CLI stream mode** (`packages/cli`, Phase 0). *Purpose:* machine-readable streamed provisioning
   + stdin consent + `doctor --json`. *Interface:* NDJSON stdout / JSON-line stdin (§2).
   *Depends on:* existing `provisionRemote` orchestrator (unchanged logic).
2. **Rust shell** (`packages/desktop/src-tauri`). *Purpose:* window, sidecar process management,
   stdout→event / stdin←consent piping, host-store + secret persistence. *Interface:* Tauri
   commands (`start_provision`, `send_consent`, `list_hosts`, `host_health`, `host_logs`,
   `uninstall_host`) + an event channel for NDJSON lines. *Depends on:* the bundled CLI binary,
   Tauri sidecar API, OS keychain plugin.
3. **Web UI** (`packages/desktop/src`). *Purpose:* render wizard/inventory/logs; collect inputs;
   show live progress; gate consent. *Interface:* Tauri IPC only. *Depends on:* `h()` helper
   (copied/shared from extension), `@patchwire/protocol` types (compile-time), CSS.
4. **Host store** (`hosts.json` in app-data). *Purpose:* persist the fleet. *Schema:*
   `{ id, label, host, user, port, keyPath, agentPort, lastStatus, lastHealth, lastProvisionedAt }`.
   **Secrets (agent token) are NOT stored here** — kept in the OS keychain via the Tauri secret
   plugin, referenced by host `id`.

## 4. Data flows

**Provision (wizard):** form (label, host, user, port, SSH key path, agent port) → UI calls
`start_provision` → Rust spawns `patchwire setup --provision-remote --stream …` (token generated
securely, stored in keychain) → NDJSON events stream over the event channel → UI renders detect →
**preview (plan + elevation) with Approve/Cancel** → on Approve, UI calls `send_consent(true)` →
Rust writes `{"consent":true}` to the CLI's stdin → step events render live → terminal `done`+`health`
→ host upserted into `hosts.json`.

**Inventory health:** on view load / refresh, Rust runs `patchwire doctor --json` (per host, with
that host's connection) → UI shows health badges (healthy / unhealthy / unknown).

**Logs:** `host_logs` → `patchwire agent-log --json …` → streamed/paged into the logs view.

**Uninstall / re-run:** `uninstall_host` → CLI uninstall path; re-run replays the wizard with the
host's saved fields prefilled.

## 5. Monorepo, build & packaging

- New workspace package **`packages/desktop`** (`patchwire-desktop`, private). Web UI bundled with
  **tsup** (mirroring the extension); Rust shell under `src-tauri/`.
- **CLI sidecar:** the per-OS **bun-compiled `patchwire` binary** (from `scripts/build-agent-binaries.mjs`
  / release pipeline) is bundled via Tauri's `externalBin` sidecar mechanism, named per Tauri's
  target-triple convention.
- **Versioning:** joins the synced product version (currently 0.3.18).
- **Distribution:** `tauri build` per OS. Internal builds **unsigned/ad-hoc** (mac: ad-hoc sign +
  right-click-open; windows: SmartScreen "run anyway"; linux: AppImage/deb). Signing/notarization
  is a later, separate concern.

## 6. Testing

- **CLI seam (Phase 0):** vitest in `packages/cli` — NDJSON framing per event, stdin-consent
  true/false/EOF paths, `doctor --json` shape. (No Tauri needed; highest-value tests.)
- **Web UI:** component/unit tests for the wizard state machine (event → view transitions) and the
  inventory store, using a faked IPC layer.
- **Rust shell:** kept thin; smoke-tested manually (spawn → stream → consent → done) on macOS first,
  then by the team per the real-host checklist.

## 7. Build sequence (each → its own plan step)

- **Phase 0 — CLI stream seam.** `--stream` NDJSON + stdin consent + `doctor --json` + tests. *Ships
  independently; unblocks the app and is useful on its own.*
- **Phase 1 — Tauri skeleton.** `packages/desktop`, sidecar bundling, IPC plumbing; a minimal screen
  that runs a real `--stream` provision end-to-end and prints raw events.
- **Phase 2 — Wizard UI.** Form → live progress → preview/consent → health result; persist host.
- **Phase 3 — Inventory.** Host list, health badges, logs view, uninstall/re-run.

## 8. Out of scope for v1 (YAGNI)

AI session/chat/diff UI; sync controls; multi-host bulk operations; a control plane; auto-update;
code signing/notarization; in-process `@patchwire/core` embedding (the app stays a GUI-over-CLI
until Core is extracted — a deliberate future migration, not v1).

## 9. Open questions / risks

- **Tauri Linux webview (WebKitGTK):** occasional rendering/IPC quirks; validate early on a Linux
  build (the team's first Linux smoke test).
- **Sidecar binary naming:** Tauri requires target-triple-suffixed sidecar names; the build must map
  our bun targets (darwin/linux/windows × x64/arm64) to Tauri's convention. windows-arm64 isn't
  built (documented gap).
- **Consent-over-stdin robustness:** define timeout behavior if the GUI never answers (CLI should
  not hang forever — pick a sane timeout → cancel).
- **Token secret storage:** confirm the Tauri OS-keychain plugin covers mac/linux/windows; fall back
  to an encrypted local store if a platform lacks keychain support.
- **`h()` sharing:** copy into `packages/desktop` for v1, or promote the extension's `h.ts` to a tiny
  shared package? Copy for v1 (avoid premature coupling); revisit if it drifts.
