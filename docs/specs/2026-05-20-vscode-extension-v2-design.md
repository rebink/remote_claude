# Remote Claude — VS Code Extension v2 Design

> **Status:** Spec, awaiting plan stage.
> **Supersedes:** `2026-05-03-vscode-extension-design.md` (v1). v1 stays in the repo for reference; the worktree scaffolding under `.worktrees/vscode-extension/` is reused where applicable (see Section 6).
> **Driving use case:** Flutter developers who must keep a physical device plugged into their laptop and therefore cannot run their app on the Mac Mini. They need Claude's context-aware help to run remotely while their workspace stays local.

---

## Problem statement

Today, our developers SSH into a shared Mac Mini to use Claude Code over the network. That works for back-end and web work, but breaks for Flutter: physical devices must be USB-attached to the laptop running `flutter run`, which means code must live locally.

The existing `remote-claude` CLI already addresses this technically (laptop is source of truth; remote is a "diff factory"). It is, however, painful to drive from a terminal during day-to-day Flutter work, and lacks two affordances developers ask for:

1. **A conversational chat with Claude** rather than one-shot prompts.
2. **An obvious "out-of-sync" indicator** and an easy preview/accept flow for incoming diffs.

This spec defines a chat-first VS Code extension that wraps the existing CLI and agent, adds password-once onboarding (for developers who have system passwords but no SSH keys), bootstraps both sides from a Git URL, and exposes a live-sync toggle for tight iteration loops.

---

## Goals

- Bring the full ask → review → selective-apply loop into VS Code as a **multi-turn chat** UI.
- Onboarding to first successful chat in **under 3 minutes**, with no terminal use, starting from: SSH username, system password, and a Git URL.
- Make sync state visible and obvious; let the dev opt into continuous live-sync during focused Claude pairing.
- Keep the editor unblocked while a turn is in flight on the remote; survive VS Code reloads.
- Preserve selective per-file apply.
- Reuse VS Code's native diff editor — no custom diff renderer.
- Commit authorship is always the laptop developer; Claude never commits on the remote.

## Non-goals (v1.0)

- Multiple concurrent chat turns in the same chat. One in-flight turn per chat.
- Streaming Claude's intermediate tool output beyond plain text chunks. Tool-use frames are summarized as text in v1.
- Bidirectional sync. The laptop remains the source of truth.
- A re-implemented agent transport. The extension always talks to the local `remote-claude` CLI; the CLI talks to the agent.
- Multi-root workspace support. Single workspace folder with one `remote-claude.yml`.
- Re-running the password flow after key rotation. Manual `ssh-copy-id` is acceptable for v1.

---

## Locked decisions (from brainstorming)

| # | Decision |
|---|---|
| 1 | **Onboarding** uses the SSH system password **exactly once** to install a per-project SSH key via vendored `sshpass` + `ssh-copy-id`. Password is held in memory and zeroed; never persisted. |
| 2 | **Project bootstrap** is by Git URL: extension `git clone`s locally and the agent `git clone`s on the remote into `~/workspace/<project>`. "Open existing folder" is a secondary path that initializes git if needed. |
| 3 | **Multi-dev isolation** relies on per-developer SSH user accounts on the Mac Mini, each with their own `~/workspace`. |
| 4 | **Claude never commits on the remote.** The agent returns unified patches; the developer commits locally with their own git identity. |
| 5 | **Sync is hybrid:** sync-on-ask by default, plus a per-project **live-sync toggle** in the status bar (default OFF, watcher + debounced rsync when ON). |
| 6 | **Conflicts** are deterred by warning at ask time when live-sync is OFF and the working tree is dirty; not blocked. `git apply --3way` is the fallback. |
| 7 | **Chat is multi-turn** via `claude --resume <session-id>` on the remote. Multiple chats per project, with `+ New chat`, switching, and `Delete chat`. |
| 8 | **Vendored `sshpass`** + **per-project SSH keys** at `~/.remote-claude/keys/<host>-<user>`. |

---

## Architecture

```
┌──────────────── Laptop ─────────────────┐         ┌──────────────── Mac Mini ────────────────┐
│                                          │         │                                           │
│  VS Code Extension                       │         │  remote-claude-agent (HTTP, Fastify)      │
│  ┌────────────────────────────────────┐  │ spawn   │  ┌─────────────────────────────────────┐  │
│  │ ChatPanel (webview, sidebar)       │  │ ◄────►  │  │ POST /chat     (streaming JSONL)    │  │
│  │   • prompt input                   │  │  JSONL  │  │ POST /init     (git clone)          │  │
│  │   • turn history                   │  │  over   │  │ DELETE /session/:id                 │  │
│  │   • per-turn diff cards            │  │  stdout │  │ POST /ask, /health (existing)       │  │
│  │   • streaming assistant text       │  │         │  └─────────────────────────────────────┘  │
│  └────────────────────────────────────┘  │         │     ↓                                     │
│  ┌────────────────────────────────────┐  │         │   claude --resume <id> --print            │
│  │ SyncController                     │  │         │     ↓                                     │
│  │   • file watcher (when live-sync)  │  │         │   git diff HEAD  →  unified patch         │
│  │   • debounced rsync                │  │         │     ↓ stream                              │
│  │   • out-of-sync state              │  │         │   { type:"text"|"diff"|"done", ... }      │
│  └────────────────────────────────────┘  │ rsync   │     ↓                                     │
│                                          │ ──────► │   git reset --hard HEAD  (between turns)  │
└──────────────────────────────────────────┘         └───────────────────────────────────────────┘
```

**Three processes, one transport:**

- Extension → CLI sidecar (child process, JSONL over stdout)
- CLI sidecar → Agent (HTTP, streaming) and → remote (rsync over SSH)
- Agent → `claude` CLI (child process, stdin/stdout)

The extension never opens HTTP, SSH, or rsync directly — all transport concerns stay inside the CLI, which keeps secrets, retries, and protocol details in one place.

---

## Onboarding flow

Triggered when `remote-claude.yml` is missing in the workspace. A 4-step webview.

### Step 1 — Pick the Mac Mini
Extension calls `remote-claude setup --list-peers --json` which shells out to `tailscale status --json`. Peers are listed, pre-selecting the most recently active. Manual host entry is the fallback for non-Tailscale users.

### Step 2 — Sign in (password used once)
User enters SSH username + system password. The password lives only in webview memory and the `postMessage` to the extension host. Extension calls:

```
remote-claude setup --password-stdin --host <host> --user <user> --key-path ~/.remote-claude/keys/<host>-<user>
```

The CLI:
1. Generates the per-project key (ed25519) if absent. `0600` perms, no passphrase.
2. Streams the password to vendored `sshpass -d <fd>` which invokes `ssh-copy-id -i <key>.pub <user>@<host>`.
3. Zeroes the password buffer (`Buffer.fill(0)`) on success and failure.
4. Returns a typed result: `ok` | `auth_failed` | `unreachable` | `host_key_mismatch` (with both fingerprints).

The wizard maps each error to a clear message. Host key mismatch shows a modal naming the old and new fingerprints; the user must explicitly choose `Trust new key`.

### Step 3 — Project source
Two options:

- **Clone from Git URL** (recommended): user supplies URL + branch + local path.
  - Extension runs `git clone <url> <local-path>` locally.
  - Extension calls `remote-claude init-remote --git-url <url> --branch <b> --project <name>` which POSTs to `POST /init` on the agent. Agent clones into `RC_PROJECTS_ROOT/<name>` and returns the resulting commit SHA. Both sides must end on the same SHA.
- **Use already-open folder**: extension rsyncs the open workspace to `RC_PROJECTS_ROOT/<name>` on the remote and runs `git init` if no `.git` exists, then `git add -A && git commit -m "remote-claude initial"` to establish HEAD. This path is documented as "for projects not yet in git."

Git credentials on both sides use the developer's existing config (SSH agent, GitHub credential helper). The wizard does not collect Git credentials.

### Step 4 — Verify
Runs `remote-claude doctor`: Tailscale reachable, SSH key works, agent responds, projects directory exists, commit SHAs match. On success, writes `remote-claude.yml` and `.remote-claude/env` (token), then triggers extension activation.

---

## Chat session model

### State partition

| State | Location | Lifetime |
|---|---|---|
| Session list (uuid, title, last activity, agent-side session id) | `.remote-claude/sessions/index.json` (laptop) | Persists across reloads |
| Per-session transcript (turns: prompt, assistant text, diff metadata, applied/rejected state) | `.remote-claude/sessions/<uuid>.jsonl` (laptop) | Same |
| Claude session state (system prompt, context, history) | `~/.claude/projects/...` on the remote, managed by `claude --resume` | Until pruned |
| Pending patch for an unaccepted turn | `.remote-claude/sessions/<uuid>/turn-<n>.patch` (laptop) | Until accepted/rejected/saved |

### Two session IDs

Each chat carries an **extension UUID** (what the UI shows) and a **Claude-side session ID** (consumed by `claude --resume`). The agent records the mapping in `~/.remote-claude/agent-sessions.json` the first time `/chat` is called for a new UUID.

### Turn lifecycle

```
[+ New chat]      → extension mints a UUID, no agent call yet
User types & sends
   ↓
Extension guards (live-sync off + dirty tree) → inline banner if needed (Section "Sync")
   ↓
Extension spawns: remote-claude chat --json --session <uuid> [--no-sync] "<prompt>"
   ↓
CLI:
   1. rsync push (unless --no-sync or live-sync already kept it fresh)
   2. POST /chat { uuid, prompt }  (streaming response)
   ↓
Agent (per turn):
   • Resolve uuid → claude-session-id (mint if new); record turn index
   • Stream events:
       { type:"text", chunk:"..." }   ← assistant tokens
       { type:"diff", patch:"...", files:[...] }   ← if files changed
       { type:"done", tokensIn, tokensOut, durationMs }
   • git reset --hard HEAD && git clean -fd   ← clean the working tree
   ↓
Extension renders events into the chat panel as they arrive.
```

### Working-tree reset between turns

The remote tree is reset to HEAD after each turn so that turn N+1 does not see turn N's changes (the dev may not have applied them locally; we want each diff to be self-contained against the dev's actual state, which is the next rsync push). The Claude *conversation* persists via `--resume`; only the *file edits* are discarded between turns.

### Cancellation

The chat panel's `Stop` button posts `cancel` to the extension host. Extension sends `SIGTERM` to the CLI sidecar. CLI aborts its in-flight HTTP request. Agent detects the dropped connection, kills the `claude` child process, and still runs the cleanup `git reset`. The half-streamed turn is persisted as `interrupted` in the transcript.

### Delete chat

`Delete chat` command (right-click on a chat in the sidebar list, or `Cmd+Shift+P`) deletes the laptop transcript file and calls `DELETE /session/:id` on the agent. The agent removes the uuid → claude-id mapping and the corresponding `~/.claude/projects/<id>` directory (or runs `claude session delete <id>` if the CLI ships that command — fallback to `rm -rf` on the project dir).

### + New chat

`+ New chat` button in the sidebar header. Mints a fresh UUID, no agent state until first send. Optional preset: "Continue from current file" prefixes the first prompt with the focused editor's file path.

---

## Sync engine

### Modes

```
live-sync OFF (default)             live-sync ON
─────────────────────────           ────────────────────────────────
idle → (user hits Send) →           idle → (user saves file) →
  rsync push (one-shot) →             debounced 500ms rsync push →
  send prompt                         idle
```

### `SyncController` responsibilities

- Owns the file watcher (`createFileSystemWatcher('**/*')`) filtered by `sync.exclude` from `remote-claude.yml`.
- 500ms debounce. Coalesces bursts (e.g., a `flutter format` mass-save) into a single rsync.
- Spawns `remote-claude sync --json` for the actual push; consumes JSONL progress events.
- Tracks `lastSyncedAt` per file via a content hash; exposes an `outOfSyncFiles: Set<string>`.
- Suspends the watcher for ~1s when applying a returned patch locally so it does not push our own freshly-applied changes back as if they were dev edits.

### Out-of-sync indicators

1. **Status bar item (left side):**
   - `$(sync) In sync` — clean
   - `$(sync~spin) Syncing…` — rsync in progress
   - `$(warning) N files not synced` — live-sync OFF, edits exist
   - `$(zap) Live sync: ON` — toggle is on (replaces the above; click toggles off)
2. **File decorations in the Explorer:**
   - `●` (orange) = edited locally but not yet pushed to remote
   - `▼` (blue) = remote has a pending diff for this file (turn unaccepted)
   - clean = identical
3. **Chat input banner** (only when relevant):
   - `⚠ 4 files changed since last sync.  [Sync first]  [Turn on live sync]  [Send anyway]`

### Live-sync toggle

Per-project. Persisted in `.remote-claude/state.json` under `liveSync: boolean`. Defaults to `false`. Toggle lives in the status bar; also exposed as command `remoteClaude.toggleLiveSync`.

---

## Diff preview & apply

### Diff card anatomy

Each chat turn that produces a diff renders an inline card below the assistant message:

```
┌─ Changes ─────────────────────────────── 2 files ─┐
│ [✓] M  lib/screens/home_screen.dart   +12 -4      │
│ [✓] M  lib/widgets/overflow_card.dart  +8 -0      │
│ [ ] A  lib/widgets/scrollable_row.dart +24        │
│                                                   │
│ [ Apply selected (2) ]  [ Save patch ]  [ Reject ]│
└───────────────────────────────────────────────────┘
```

- Rows are clickable: open VS Code's native diff editor via `vscode.diff(beforeUri, afterUri, title)`.
- `beforeUri` uses the `remote-claude:` URI scheme, served by `DiffContentProvider` via `git show HEAD:<path>`. Deleted files: empty afterUri. Added files: empty beforeUri.
- Checkboxes use `TreeItem.checkboxState` for keyboard nav + multi-select.

### Card states

`pending` → `applying` → `applied` | `applied with conflicts` | `rejected` | `saved`. Persisted in the transcript so reloads remember.

### Apply path

```
User clicks "Apply selected"
   ↓
Extension extracts per-file hunks from the unified patch for selected files
   ↓
SyncController.suspendWatcherFor(1000ms)
   ↓
git apply --3way <subset.patch>   (run by extension in workspace; not via CLI)
   ↓
Success →  • card → `applied`
           • clear "▼ pending" decorations on those files
           • files are now ahead of remote; next chat turn rsyncs them up
Conflict → • card → `applied with conflicts`
           • files contain conflict markers; SCM view shows them
           • non-modal note: "Resolve conflicts, then commit when ready"
```

### Save / Reject / saved-patch reuse

- **Save patch:** writes `.remote-claude/sessions/<uuid>/turn-<n>.patch`; card collapses to `💾 Saved`. Reusable via `Remote Claude: Apply saved patch…` command.
- **Reject:** card collapses to `✗ Rejected`. No filesystem side effects. Remote tree was already reset.

### Commits

The extension never commits. After apply, changes appear in the SCM view as if the developer typed them. The developer commits when ready, with their local `user.name` and `user.email`. This is what guarantees correct authorship.

---

## Component breakdown

### Repo layout

```
dev_sync_cli/
├── src/                         (CLI — existing, gains new commands)
│   ├── cli.ts                   ← register `chat`, new flags on `setup`
│   ├── commands/
│   │   ├── setup.ts             ← +password-stdin mode, sshpass call
│   │   ├── chat.ts              ← NEW: multi-turn driver
│   │   ├── init-remote.ts       ← NEW: POST /init to agent
│   │   ├── sync.ts              ← +--json flag
│   │   └── …
│   ├── agent/
│   │   ├── server.ts            ← +POST /chat (streaming), +POST /init, +DELETE /session/:id
│   │   ├── chat.ts              ← NEW: claude --resume + git diff per turn
│   │   ├── session-store.ts     ← NEW: uuid → claude-session-id mapping
│   │   └── git.ts               ← +cleanResetAfterTurn()
│   └── lib/
│       ├── client.ts            ← +streamChat()
│       ├── sshpass.ts           ← NEW: vendored binary + ssh-copy-id wrapper
│       └── …
├── extension/                   (VS Code extension — NEW workspace package)
│   ├── package.json             ← contributes commands, views, statusbar
│   ├── src/
│   │   ├── extension.ts         ← activate(): wire everything up
│   │   ├── chat/
│   │   │   ├── ChatPanel.ts     ← webview host (sidebar)
│   │   │   ├── ChatStore.ts     ← session list + transcripts on disk
│   │   │   └── webview/         ← React + tailwind for chat UI
│   │   ├── sync/
│   │   │   ├── SyncController.ts
│   │   │   └── FileDecorationProvider.ts
│   │   ├── cli/
│   │   │   ├── CliClient.ts     ← spawn + JSONL parser
│   │   │   └── events.ts        ← typed event union
│   │   ├── diff/
│   │   │   ├── DiffContentProvider.ts
│   │   │   └── applyPatch.ts
│   │   ├── setup/
│   │   │   └── SetupWizard.ts
│   │   ├── statusbar/StatusBarController.ts
│   │   └── commands.ts
├── docs/                        (existing)
├── scripts/                     (existing + smoke for extension)
├── pnpm-workspace.yaml          ← NEW
└── package.json                 (workspace root)
```

### CLI deltas

| Command | Status | Description |
|---|---|---|
| `remote-claude chat` | NEW | `chat --session <uuid> --json [--no-sync] <prompt>` — streams turn events to stdout |
| `remote-claude setup --password-stdin` | NEW flag | Reads password from stdin, runs `sshpass` + `ssh-copy-id`, zeroes buffer |
| `remote-claude setup --list-peers --json` | NEW flag | Lists Tailscale peers as JSON |
| `remote-claude init-remote` | NEW | `--git-url <url> --branch <b> --project <name>` — calls agent `POST /init` |
| `remote-claude sync --json` | NEW flag | JSONL output for the extension |
| `remote-claude ask` | UNCHANGED | Stays for backwards-compat / scripting |
| `remote-claude apply`, `doctor` | UNCHANGED | |

### Agent deltas

| Endpoint | Status | Description |
|---|---|---|
| `POST /chat` | NEW | Streaming JSONL turn events. Calls `claude --resume <id>` and `git diff HEAD`. Resets tree after. |
| `POST /init` | NEW | `{ gitUrl, branch, projectName }` → clones into `RC_PROJECTS_ROOT/<projectName>`. Returns commit SHA. |
| `DELETE /session/:id` | NEW | Removes mapping and prunes Claude project state. |
| `GET /session/:id/status` | NEW | Lightweight poll endpoint for VS Code reload reconciliation. |
| `POST /ask`, `/health` | UNCHANGED | |

### JSONL event union (CLI ↔ extension contract)

```ts
type CliEvent =
  | { type: 'protocol'; version: string }
  | { type: 'sync_start' }
  | { type: 'sync_progress'; transferred: number; total: number }
  | { type: 'sync_done'; filesChanged: number; durationMs: number }
  | { type: 'chat_turn_start'; sessionId: string; turnIndex: number }
  | { type: 'chat_text'; chunk: string }
  | { type: 'chat_diff'; patch: string; files: ChangedFile[] }
  | { type: 'chat_done'; tokensIn: number; tokensOut: number; durationMs: number }
  | { type: 'error'; code: string; message: string; recoverable: boolean }
  | { type: 'cancelled' };
```

First event of every CLI invocation is `protocol`; extension refuses to talk to an unsupported version.

### Workspace setup

Convert the repo to a pnpm workspace (`pnpm-workspace.yaml` listing `.` and `extension/`). CLI publishes to npm as `remote-claude`. Extension publishes to the VS Code Marketplace as a separate artifact. Versions can diverge; extension `package.json` declares a `minimumCliVersion` and the activation handler refuses to run against an older CLI with a clear error.

---

## Error handling

| Failure | Detected where | User-visible behavior | Recovery |
|---|---|---|---|
| `sshpass` not installed | Setup step 2 | Inline error with brew install command. | Install + retry |
| Wrong SSH password | Setup step 2 | "Authentication failed." Password buffer zeroed regardless. | Re-enter |
| Host unreachable | Setup or any later operation | Inline banner; status bar `$(error) Disconnected`. | `Retry` runs `doctor` |
| Host key mismatch | First `ssh-copy-id` | Modal: old + new fingerprints, `Trust new key` / `Cancel`. | User decision |
| Agent down (post-setup) | CLI HTTP call | Toast: "Agent not responding." Button: `Restart agent` (kicks the launchd job over SSH). | Manual fallback |
| `/init` clone fails | Setup step 3 | Inline error with remote stderr; suggests checking git credentials on the remote. | Wizard returns to step 3 |
| rsync transient failure | `SyncController` | Toast + status bar `$(sync~spin) Retrying…`; exponential backoff ×3. | Auto |
| rsync persistent failure | After backoff exhausted | Modal with stderr; `Open output`, `Disable live-sync`. | Manual |
| `claude` not installed on remote | First `/chat` | System message in chat: "Claude CLI not found. Run `claude /login` on the Mac Mini." | Manual one-time fix |
| `claude` session expired / quota | Agent stderr → error event | System message in chat. Action: `Start new chat`. | User decision |
| `git apply` conflict | `applyPatch.ts` | Card → `applied with conflicts`; conflict markers in file; SCM view shows them. | Standard merge UX |
| Turn timed out | Agent enforces `RC_TIMEOUT_SEC` | Error event `code: 'timeout', recoverable: true`. Retry button on the turn. | Retry |
| VS Code reload mid-turn | Extension activate | Reads `state.json`; for `in_flight` turns, polls `GET /session/:id/status`; reattaches stream or fetches completed result. | Auto |
| Extension crash | n/a | Transcripts already persisted. | Reload restores chats |
| Double-send (race) | `ChatStore` | Send button disabled while turn is in flight; CLI also rejects with `busy`. | Auto |
| `remote-claude.yml` corrupt | Activate or CLI start | Modal: "Config invalid." Buttons: `Open file`, `Re-run setup`. | User decision |

### Security posture

- **Password lifecycle:** webview JS → extension host `postMessage` → CLI stdin → `sshpass -d <fd>` → buffers zeroed. Never written to disk, never logged. Output logs scrub by field name.
- **Agent token:** bearer, 32-byte hex, in `~/.remote-claude/env` on laptop and as a launchd env var on the remote. Constant-time comparison in the agent. Token rotation deferred to v2.
- **Per-project SSH key:** ed25519, no passphrase, `0600` at `~/.remote-claude/keys/<host>-<user>`. Trade-off accepted: a compromised laptop yields remote shell access — but the password we replaced was no stronger, and the agent's privileges are bounded by the per-developer SSH user account.
- **Webview CSP:** strict `script-src 'nonce-...'`, no remote scripts, `sandbox` with `allow-scripts` only.
- **Patch trust:** patches are unified-diff text, never `exec`'d. `git apply` parses and applies declaratively. Claude-suggested shell commands are never executed by the extension or CLI.

---

## Testing strategy

### CLI unit tests (vitest)

- `commands/chat.ts` event emission ordering against a mock agent.
- `lib/sshpass.ts` invokes the binary with correct flags; never logs the password.
- `agent/chat.ts` runs `git reset --hard HEAD && git clean -fd` after every turn, including the error path.
- `agent/session-store.ts` uuid ↔ claude-id mapping is durable across agent restarts.
- JSONL protocol fixtures (frozen) so accidental breaking changes fail loudly.

### Extension integration tests (`@vscode/test-electron`)

- Setup wizard happy path (mock CLI on PATH).
- Chat turn renders text stream + diff card; checkbox apply hits the local file.
- Live-sync ON: editing a file triggers a sync event within 600ms.
- VS Code reload mid-turn restores the chat with the turn marked in-flight; resolves on poll.
- `Stop` button SIGTERMs the CLI mock; `cancelled` event renders correctly.
- `git apply --3way` conflict produces conflict markers and the right card state.

### End-to-end smoke (`scripts/smoke.sh`, gated by `RC_E2E=1`)

- Spins up the agent locally with `RC_PROJECTS_ROOT` pointed at a tmp dir.
- Drives the CLI through `setup --host 127.0.0.1 --token <fixed>` (bypassing `sshpass`).
- Initializes a tiny test repo via `init-remote`.
- Runs `chat "make CHANGES.md say hello"` against a stub `claude` binary that emits canned output.
- Asserts the unified patch round-trips and applies cleanly.

### Not in CI

- Webview rendering beyond smoke (manual PR exercise is acceptable for v1).
- Real Tailscale interactions (the CLI mocks the `tailscale status` JSON in tests).
- Real `claude` CLI calls (stub binary).

---

## Open questions for the plan stage

- **`sshpass` distribution.** Vendor a prebuilt binary per OS/arch inside the npm package, or require `brew install sshpass` and surface a clear error? Vendoring is friendlier; legal/licensing implications (GPL v2) need a quick check.
- **Per-project key location vs. `~/.ssh/config` hygiene.** Should we append a `Host` block to the user's `~/.ssh/config` so `ssh user@host` from a terminal also uses our key? Default: yes, in a clearly-fenced `# BEGIN remote-claude / # END remote-claude` block.
- **Minimum VS Code engine.** v1 suggested `^1.80.0`. Confirm against the APIs we use (checkbox TreeItem, FileDecorationProvider, SecretStorage).
- **`pnpm` workspace migration ergonomics.** The current root `package.json` is the CLI itself; converting requires moving CLI sources under `packages/cli/` or keeping the CLI at the root and only adding `extension/`. Recommend the latter for minimal churn.
- **Reconcile-on-reload polling cadence.** 1-second poll vs. server-sent events from the agent for in-flight turn status. Polling is simpler for v1; SSE is a v2 improvement.

---

## Out of scope (deferred)

- Multi-root workspace support.
- Tool-use frame streaming (only assistant text is streamed; tool calls summarized post-hoc).
- Token rotation UI.
- A second extension for non-Flutter usage (this extension covers both; Flutter is the driving use case, not a separate product).
- Inline auto-apply on the dev's behalf (always explicit accept in v1).
- Cost / token-usage analytics surfaced in the chat.
- Mobile (iOS/Android) editor integration. Out of scope by definition.
