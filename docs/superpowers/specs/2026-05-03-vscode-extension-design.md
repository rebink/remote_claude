# Remote Claude — VS Code Extension Design

**Date:** 2026-05-03
**Status:** Spec — awaiting plan
**Owner:** rebin
**Related:** [`2026-04-30-devbridge-design.md`](2026-04-30-devbridge-design.md) (the underlying CLI/agent)

## Summary

A VS Code extension that wraps the existing `remote-claude` CLI so users can run Claude on a remote Mac Mini and review/apply the resulting diff entirely from VS Code. The extension is a thin UI layer: it spawns the CLI as a child process and consumes a new `--json` output mode. No new transport, no duplicated SSH/rsync logic.

The user-facing flow is asynchronous: enter a prompt → the job runs in the background → a status-bar item shows progress → a toast notifies on completion → a "Sync" badge appears in the sidebar → clicking it opens a tree of changed files with checkboxes; selected files apply via `git apply` using the existing patch.

## Goals

- Bring `remote-claude`'s ask → review → selective-apply loop into VS Code with no behavioural divergence from the CLI.
- Keep the editor unblocked while Claude is running on the remote.
- Preserve selective per-file apply, which is the CLI's distinguishing feature.
- Reuse VS Code's native diff editor for actual file viewing — no custom diff renderer.
- Survive VS Code reloads while a sync is pending.

## Non-goals (v1)

- Multiple concurrent asks. One job at a time.
- Streaming Claude's intermediate output. Current agent returns one HTTP response with the final diff; we show a spinner + final stdout link.
- Bidirectional sync. The local laptop remains the source of truth, exactly as in the CLI.
- A re-implemented agent transport. Extension talks to the local CLI; the CLI talks to the agent.
- Multi-root workspace support. Single workspace folder with one `remote-claude.yml` for v1.

## Approach

**Wrapper, not rewrite.** The extension `child_process.spawn`s `remote-claude` for every operation (`ask`, `apply`, `doctor`, `setup`). All SSH, rsync, agent HTTP, git apply, and patch capture stay in the CLI.

To make the CLI machine-parseable, we add a `--json` flag that emits line-delimited JSON events on stdout. The extension parses these events to drive its UI. The flag is additive — terminal users see no behaviour change.

We add `apply --files a,b,c` for non-interactive selective apply (the existing interactive picker stays for terminal use). We add `setup --non-interactive --host --user --path --token` so the wizard can drive setup. We write a sidecar `.remote-claude/last.meta.json` next to `last.patch` describing changed files, hunks, prompt, and stdout path; this lets the extension restore state after a VS Code reload.

The diff editor is VS Code's native one. A `TextDocumentContentProvider` registered for scheme `remote-claude:` returns "before" content via `git show HEAD:<path>` (empty for added files; the on-disk file for deleted ones). VS Code handles the rest.

## Architecture

```
┌─────────────────────────────────────────────┐        ┌─────────────────────────────┐
│              VS Code (laptop)               │        │      Mac Mini (remote)      │
│                                             │        │                             │
│  ┌──────────────────────────────────────┐   │        │  ┌───────────────────────┐  │
│  │  remote-claude VS Code extension     │   │        │  │  remote-claude-agent  │  │
│  │  ─────────────────────────────────   │   │        │  │  (HTTP, bearer token) │  │
│  │  ▸ Sidebar (Tree view)               │   │        │  └──────────▲────────────┘  │
│  │  ▸ Status bar item                   │   │        │             │ spawns       │
│  │  ▸ Webview (setup form)              │   │        │             ▼              │
│  │  ▸ DiffContentProvider               │   │        │      claude --print        │
│  │  ▸ FileDecorationProvider            │   │        │      (clean checkout)      │
│  └────────────────┬─────────────────────┘   │        │                             │
│                   │ child_process.spawn      │        └─────────────────────────────┘
│                   ▼                         │                  ▲
│        remote-claude (CLI)                  │                  │ rsync push (SSH key)
│        ▸ ask --json (new flag)              │ ─────────────────┘ HTTP /ask
│        ▸ apply --files=…                    │
│        ▸ doctor --json                      │
│        ▸ setup --non-interactive            │
└─────────────────────────────────────────────┘
```

**Repository layout.** A new top-level folder `extension/` in the existing monorepo, with its own `package.json` (VS Code engines, contribution points). The CLI remains at the repo root; the extension lists `remote-claude` as a peer dependency in documentation and verifies it's on `$PATH` at activation.

## Components

| Component | Purpose | Depends on |
|---|---|---|
| `CliClient` | Spawn `remote-claude` with `--json`; parse JSONL events; emit typed results. | `child_process` |
| `JobManager` | Owns the one-at-a-time job state machine. | `CliClient` |
| `HistoryStore` | Persist completed jobs to `.remote-claude/history/<timestamp>.json`; load most recent N on startup. | `fs` |
| `AskTreeProvider` | Renders the sidebar tree: prompt input, current job, pending-sync file tree with checkboxes, history. | `JobManager`, `HistoryStore` |
| `DiffContentProvider` | Serves "before" content for scheme `remote-claude:` via `git show HEAD:<path>`; handles added/deleted files. | `git` CLI |
| `FileDecorationProvider` | Colors sidebar file rows by status (M/A/D) and adds badges. | nothing |
| `StatusBarController` | Renders right-side status bar item; click to cancel running job or jump to Sync view. | `JobManager` |
| `SetupWizard` | Webview form on first run when `remote-claude.yml` missing. Validates input, calls `remote-claude setup --non-interactive`. | `CliClient` |
| `Commands` | Registers VS Code commands (`remoteClaude.ask`, `.sync`, `.cancel`, `.openSetup`, `.viewOutput`). | all of the above |

Each component has one purpose, no shared mutable state, and a small interface. `JobManager` is the only piece holding live state; everything else either reads from it or is stateless.

## State machine

```
idle ──ask──▶ running ──cancel──▶ idle
              │
              ├── patch-ready ──▶ awaitingSync ──apply──▶ applying ──▶ applied
              │                       │                                  │
              │                       └─reject/save────▶ idle ◀──────────┘
              └── error ───▶ failed ──▶ idle (after dismiss)
```

## Upstream CLI changes

These ship in `remote-claude` itself, not the extension. They are additive — terminal users notice nothing.

- `--json` flag on `ask`, `doctor`, `sync`, and `apply`. Emits JSONL on stdout. Event types:
  - `{type: "syncing"}`
  - `{type: "claude-running"}`
  - `{type: "patch-ready", files: [{path, status, hunks}], metaPath, stdoutPath}`
  - `{type: "applied", files: [...]}`
  - `{type: "error", code, message}`
- `apply --files a,b,c`: non-interactive selective apply.
- `setup --non-interactive --host --user --path --agent-url --token`: scriptable setup.
- New sidecar `.remote-claude/last.meta.json` written alongside `last.patch`:
  ```json
  {
    "prompt": "refactor login_bloc to use freezed",
    "files": [{ "path": "lib/login_bloc.ts", "status": "M", "hunks": 3 }],
    "stdoutPath": ".remote-claude/last.stdout",
    "ranAt": "2026-05-03T10:42:11Z",
    "durationMs": 42193
  }
  ```

## Sidebar UX

The sidebar (a custom view container `remoteClaude`) shows:

1. **Prompt input row** — multiline text + an "Ask" button. Disabled while a job is running.
2. **Current** — the running or awaiting-sync job, with elapsed time, a Cancel button when running, and the file tree when awaiting sync.
3. **History** (collapsible) — the most recent N completed jobs (default N = 20), each with prompt snippet, result icon (✓ applied / ⊘ rejected / ✗ failed), and timestamp.

When in `awaitingSync`, the file tree shows one row per changed file with a checkbox, the git status letter (U/M/D), and the file path. A button row at the bottom: "Apply N selected", "Save patch", "Reject". Clicking a file row opens the native diff editor.

The status bar item lives in the right group: `$(remote-claude-icon) Claude: idle`, `$(sync~spin) Claude: running 0:43`, or `$(check) Claude: 7 files pending`. Click jumps to the sidebar view.

## Data flow — ask

```
user types prompt → "Ask" → Commands.ask
   → JobManager.start(prompt)        // state: idle → running
       → CliClient.spawn(['ask', '--json', prompt])
           ← {type:"syncing"}        → status bar: "↑ syncing files"
           ← {type:"claude-running"} → status bar: "⏳ claude running 0:43"
           ← {type:"patch-ready", files, metaPath, stdoutPath}
   → JobManager state: running → awaitingSync
   → Sidebar refreshes: shows file tree + Apply/Save/Reject
   → Toast: "Claude finished — N files changed"
```

## Data flow — sync

```
user checks files → "Apply N selected" → Commands.sync(files)
   → JobManager.apply(files)         // state: awaitingSync → applying
       → CliClient.spawn(['apply', '--files', files.join(','), '--json'])
           ← {type:"applied", files}  or  {type:"error", message}
   → JobManager state: applying → applied (or failed)
   → HistoryStore.write(job)
   → Sidebar moves entry to History; clears Pending Sync
```

## First-run flow

```
extension activates on workspace open
   │
   ├── workspace has remote-claude.yml ?
   │       ├── yes ──▶ run `remote-claude doctor --json`
   │       │             ├── ok ──▶ ready
   │       │             └── fail ▶ banner: "Doctor failed: <reason>" + [Fix] [Re-run]
   │       │
   │       └── no  ──▶ Welcome view in sidebar:
   │                   "No remote-claude.yml in this workspace.
   │                    [Run setup wizard]   [Open existing]   [Docs]"
```

The setup wizard is a webview with five fields (host, SSH user, remote path, agent URL, agent token). It detects `~/.ssh/id_ed25519.pub` and warns if missing. "Test connection" runs `remote-claude doctor --json` with the form values and shows pass/fail per check. "Save & finish" calls `remote-claude setup --non-interactive …` which writes `remote-claude.yml` and `~/.remote-claude/env` (chmod 600).

SSH password authentication is not supported. The wizard surfaces this clearly and offers a "Copy public key to remote" helper that runs `ssh-copy-id`.

## Error handling

| Failure mode | Surface | Recovery |
|---|---|---|
| CLI not on `$PATH` | Sidebar banner with install instructions | Link to docs; extension stays inert until installed |
| No `remote-claude.yml` | Welcome view | Setup wizard |
| SSH key missing or not authorized | Setup-wizard "Test connection" failure card | "Copy public key" helper |
| Agent unreachable | Toast on ask + sidebar banner | "Re-run doctor" button |
| Bad token (HTTP 401) | Toast: "Token rejected" | Open setup wizard, focus token field |
| Claude / agent timeout | Job state → failed | "Retry" button; stdout still saved |
| `git apply` fails (dirty tree, conflicts) | Toast + diagnostic in sidebar | "Save patch" stays available; user resolves and re-applies |
| Cancel mid-run | Sidebar transitions running → idle | SIGTERM the spawned CLI; CLI propagates to agent if mid-HTTP |
| VS Code reload while awaiting sync | On activate, read `last.meta.json` | If patch exists & unapplied, restore awaitingSync from disk |

Principle: every error has one named recovery action.

## Reload safety

On activate, after the doctor check passes, the extension reads `.remote-claude/last.meta.json` if present. If it exists and the patch hasn't been applied (no `last.applied` marker), the extension restores `awaitingSync` state — sidebar shows the file tree, the user can review and apply or reject. Reload during a running job is treated as a cancel: the spawned CLI is gone, so we transition to `failed` with a "the previous run was interrupted" message.

## Cancellation

Cancel sends `SIGTERM` to the spawned `remote-claude` process. The CLI handles SIGTERM by aborting any in-flight HTTP request to the agent (using `AbortController` on `undici`). The agent already supports request cancellation per its design spec. After the CLI exits, the extension transitions `running → idle`.

## Testing

**Layer 1 — Unit (vitest, no VS Code APIs):** `CliClient` JSONL parsing, `JobManager` state transitions, `HistoryStore` round-trip + capacity, `DiffContentProvider` git invocation, `SetupWizard` validators.

**Layer 2 — Integration (vitest):** A fake `remote-claude` shell script in `extension/test/fixtures/fake-cli.sh` emits scripted JSONL. Tests cover happy path, cancel, error, and reload restoration.

**Layer 3 — Extension host smoke (`@vscode/test-electron`):** One test that boots the actual extension host with a fixture workspace and a fake CLI on `$PATH`. Asserts the sidebar tree renders, commands are registered, and the diff URI scheme is requested. No full UI driving; that stays in unit/integration.

**Layer 4 — Upstream CLI tests:** Snapshot the `--json` output of each new subcommand. The extension depends on this contract; snapshot drift = failing test.

**Layer 5 — Manual checklist (pre-release):** fresh setup, ask + sync, cancel mid-run, network drop, reload while awaitingSync, apply onto dirty tree, reject, save patch.

CI runs layers 1/2/4 on every PR (extending the existing GitHub Actions workflow). Layer 3 runs in a Linux job with `xvfb`.

## Out of scope (deferred)

- Multiple concurrent asks / job queue.
- Streaming Claude intermediate output (requires agent SSE support).
- Multi-root workspaces with per-folder `remote-claude.yml`.
- A "re-ask" command that uses prior context.
- Inline-diff overlay in the editor (we rely on the native diff editor).
- Marketplace publishing automation (manual `vsce publish` for v1).

## Open questions for plan stage

- Should the extension live in `extension/` inside this repo or a sibling repo? Monorepo is simpler; sibling makes versioning independent.
- Minimum VS Code engine version. Suggest `^1.80.0` — required for `TreeItem` checkbox API.
- Is `pnpm` the package manager for the extension subproject, matching the CLI? Probably yes.
