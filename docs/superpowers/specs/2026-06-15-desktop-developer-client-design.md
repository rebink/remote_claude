# Patchwire Desktop — Developer Client (Redesign Spec)

**Date:** 2026-06-15
**Status:** Design approved (brainstorming), pending implementation plan
**Supersedes:** the desktop app's current identity as an ops/provisioning console

## Summary

Repurpose `packages/desktop` from an **ops/provisioning console** into an
**editor-agnostic developer client** — a third UI shell over Patchwire Core,
peer to the VS Code extension and the CLI.

The app gives a developer the full Patchwire loop without an IDE plugin:
connect to your own remote machine once, manage many project folders, chat with
Claude (which executes remotely), review the returned diffs, and apply them.
Files are still edited locally in whatever editor the developer prefers; the
desktop app is a **control surface**, not an editor.

Multi-host fleet administration (provisioning and babysitting many machines for
an org) is explicitly **out of scope** and remains in the CLI.

## Audience & core job

- **Persona:** an individual developer who owns/controls one remote machine (Mac
  mini, Mac, Linux box) and wants the Patchwire AI loop outside VS Code.
- **Primary daily job:** open a project → ask Claude for a change → review the
  diff → apply. Watch sync stay healthy. Switch between projects.
- **Occasional job:** connect a new machine (light setup), add a new project
  folder, adjust settings.

## Locked decisions

| Decision | Choice |
|---|---|
| App identity | Developer client (pivot from ops console) |
| Information architecture | Connect → Projects landing → Project workspace |
| Connection model | **Single** connection (one remote agent) for all projects |
| Project model | **Multiple** projects; each = a distinct local folder ↔ remote folder, synced independently |
| Projects landing | Codex-style list, connection bar pinned on top |
| Workspace layout | **Split** — chat (left) + Changes/diff panel (right) |
| Visual style | **Dark + Indigo** (brand `#646cff` family); green/amber/red reserved for status only |
| Frontend stack | **Svelte** (replaces vanilla-TS `h()` helper) |
| Backend integration | UI shell over the existing CLI sidecar via Tauri/Rust; remote agent unchanged |

## Architecture

The desktop app re-implements **no** protocol, auth, or sync logic. It drives the
existing `patchwire` CLI as its engine.

```
Frontend (Svelte, Tauri webview)
   ↕  Tauri commands  +  pw://… events
Rust core  (spawns & supervises the CLI sidecar, persists local state)
   ↕  patchwire CLI sidecar   (setup · sync · ask/chat · apply · health · doctor)
   ↕  HTTP + NDJSON over the Tailscale tailnet
Remote agent  (Fastify HTTP server — UNCHANGED)
```

### Layers

1. **Frontend (Svelte).** Screens + components. Reactive stores for connection
   state, projects, the active session stream, and pending diffs. Subscribes to
   `pw://…` Tauri events for streaming updates.
2. **Rust core (Tauri commands).** Thin. Responsibilities:
   - Spawn `patchwire <subcommand>` as a sidecar; stream its NDJSON stdout back
     to the frontend as Tauri events (`pw://session`, `pw://sync`, `pw://setup`).
   - Supervise long-lived processes (per-project `patchwire sync`); restart on
     crash and emit a toast event.
   - Persist local state under `~/.config/patchwire/`:
     - `connection.json` — remote host, tailnet address, token ref, agent port/version.
     - `projects.json` — array of `{ id, name, branch, localPath, remotePath, lastStatus, syncPaused }`.
     (Reuses the existing `hosts.json` persistence pattern.)
3. **CLI sidecar (`patchwire`).** Already bundled as `binaries/patchwire`
   (`tauri.conf.json` `externalBin`). Does setup, sync, ask, chat, apply, health.
4. **Remote agent.** Unchanged. Endpoints consumed: `GET /health`, `GET /me`,
   `POST /ask`, `POST /chat`, `GET /session/:id/status`, `DELETE /session/:id`,
   `GET /queue`.

### Why shell-over-CLI (not direct HTTP from Rust)

The CLI already encapsulates auth, the NDJSON protocol, sync engine selection
(mutagen/rsync), diff capture, and apply. Talking HTTP directly from Rust would
duplicate that and drift. The CLI is the single source of truth; the desktop is
one more consumer of it, exactly as the v2 architecture strategy envisions.

## Screens

### 1. Connect (first run / no connection)
- If `connection.json` exists and `/health` passes → skip to Projects landing.
- Else run setup: invoke `patchwire setup` via sidecar (Tailscale detection,
  per-project key generation, agent install on the user's machine). Stream
  `pw://setup` progress events with step states (pending/active/done/failed).
- On success: persist `connection.json`, verify `/me` + `/health`, advance.

### 2. Projects landing (Codex-style)
- **Connection bar** (pinned top): remote identity (`user@host`), tailnet
  address, agent version, live health dot (green/healthy).
- **Project rows:** icon, name + branch, `localPath ⇄ remotePath` mapping,
  status pill (Claude working / In sync / Sync paused), last-activity line
  (e.g. "2 files pending review", "applied · 18m ago").
- **New project:** pick a local folder → map to a remote path → init + first sync.
- **Search** for when the list grows.
- Click a row → that project's workspace.

### 3. Project workspace (split)
- **Header:** project name + branch, sync pill, pause/resume.
- **Left — Chat:** multi-turn conversation via `/chat`, streamed token-by-token.
  Prompt composer at the bottom; attach file/clipboard image (parity with the
  extension's `attachFile`/`attachClipboardImage`).
- **Right — Changes panel:** when Claude finishes, the diff lands here. File list
  (`+adds −dels` per file) + per-file unified diff. **Apply** / **Reject** (calls
  `patchwire apply`). Apply-all and per-file apply.
- Conflicts from sync surface here as reviewable diffs — never silent overwrite.

### 4. Settings
- Connection management (re-connect, rotate token, view agent health/version).
- Egress sandbox toggle (macOS seatbelt), AI binary (`PW_AI_BIN`), sync engine.
- App preferences (theme is dark-indigo; light is a future option).

## Data flow — "ask Claude"

1. User types a prompt in the workspace composer.
2. Frontend `invoke('chat', { projectId, prompt })`.
3. Rust spawns `patchwire chat --project <remotePath> ...` against the connection.
4. Sidecar streams NDJSON: `plan` → `output` tokens → `diff-ready`.
5. Rust forwards each as a `pw://session` Tauri event.
6. Frontend renders the streaming reply (left) and, on `diff-ready`, populates
   the Changes panel (right).
7. User clicks **Apply** → `invoke('apply_diff', { sessionId, files })` →
   sidecar `patchwire apply` → `applied` event → row status updates.

## Sync

- Each project runs a supervised `patchwire sync` (continuous, bidirectional).
- Rust emits `pw://sync` status events → drives the per-project pill and the
  workspace header.
- Pause/resume per project (`syncPaused` persisted).
- Conflicts → surfaced as reviewable diffs in the Changes panel.

## Error handling

| Failure | Behavior |
|---|---|
| Agent unreachable | Top banner on landing + workspace; auto-retry `/health` with backoff; offer reconnect. |
| Session/ask fails | Error bubble in chat with the sidecar's stderr; retry affordance. |
| Sidecar process crash | Rust restarts it; emits a toast; preserves any captured diff. |
| Sync conflict | Surfaced as a reviewable diff; never auto-overwritten. |
| Setup step fails | `pw://setup` marks the step failed with the error; user can retry that step. |

## Visual system (dark + indigo)

- **Surface:** `#0b0b12` base, `#11111c` panels, `#16161f` borders.
- **Text:** `#e8e8f0` primary, `#6c6c82` muted.
- **Brand accent (indigo):** `#a5a3ff` on dark; primary actions use the
  `#646cff` family.
- **Status (reserved):** green `#7dd3a8` healthy/in-sync, amber `#fbbf24`
  working/warn, red `#f87171` failed/down.
- **Type:** Inter; `ui-monospace` for paths, diffs, logs.
- Defined as design tokens (CSS custom properties) — no inlined values, unlike
  the current `styles.css`.

## Phasing

- **P1 — Foundations & landing:** Svelte scaffold, design tokens, connection
  state, Projects landing (read existing `connection.json`/`projects.json`,
  health, list, switch, add folder). Connect screen for the already-provisioned
  case.
- **P2 — Workspace loop:** split layout, chat streaming via `/chat`, diff render
  in Changes panel, apply/reject.
- **P3 — Sync:** supervised per-project sync, status pills, pause/resume,
  conflict surfacing.
- **P4 — Onboarding & settings:** full `patchwire setup` wizard (provision your
  own machine), Settings screen.
- **P5 — Polish:** motion, empty/loading/error states, accessibility,
  keyboard navigation.

## Out of scope

- Multi-host fleet administration / babysitting many machines (stays in CLI).
- Acting as a code editor (developer edits locally in their own editor).
- A light theme (dark-indigo only for v1; light is a future option).
- Mobile/iOS.

## Testing

- **Frontend (Svelte):** unit tests for stores (connection, session stream
  reducer, diff model) and NDJSON event parsing.
- **Rust:** tests for sidecar argument construction and event forwarding;
  supervisor restart logic.
- **End-to-end:** drive the app against a **mock agent** (a stub Fastify server
  implementing the consumed endpoints + canned NDJSON) to exercise
  connect → ask → diff → apply and sync status transitions.

## Open items for the implementation plan

- Exact CLI subcommand/flag surface for `chat` streaming and `apply` from the
  desktop (confirm against current `packages/cli/src/cli.ts`).
- Migration/removal plan for the existing ops-console views
  (`provision`/`hosts`/`logs`) — delete vs. archive.
- Token storage: keychain vs. file reference in `connection.json`.
