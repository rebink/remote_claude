# Desktop pivot: control plane + external claude session (drop bespoke chat)

**Date:** 2026-06-17
**Status:** Approved design, ready for plan
**Supersedes:** the desktop bespoke chat (ChatPane + `/chat` NDJSON + diff/apply). Relates to `packages/extension/src/session/sessionTerminal.ts` (the terminal-session model being mirrored).

---

## Why

The desktop's bespoke chat (one-shot `/chat` stream → diff → apply) cannot represent Claude Code's interactivity (questions, options, tool approvals, plan mode, /resume), and it failed silently on a 401. Chasing parity would mean rebuilding an IDE terminal in Tauri — worse than VS Code, which gives the extension a terminal for free.

**Decision (user):** the desktop is a **control plane**, not a coding client. It owns what the extension does badly — provisioning, connections, projects, sync — and launches the user's **own** terminal running the real `claude` REPL on the remote. Coding happens in the user's real tools. This removes the entire fragile chat protocol.

claude edits the synced copy on the remote; **mutagen's bidirectional sync** brings edits back to local (local Flutter hot-reload etc. keep working). No diff/apply step.

## Decisions (from brainstorm)

| Topic | Decision |
|---|---|
| Coding surface | The user's **own terminal**, launched by the desktop, running `ssh` → `claude` on the remote. No embedded terminal. |
| OS support | **All OS** — per-OS terminal launcher (macOS / Linux / Windows). |
| Attachments | Keep: upload to remote inbox (existing `push_attachment`) → **copy the returned remote path to the clipboard** (paste into claude). External terminals can't be injected into. |
| Changes view | Right pane shows a **read-only git-status list** of files changed by the session (arriving via sync). |
| Chat | **Removed** — ChatPane, chat-session streaming/apply, `start_chat`/`cancel_chat`/`apply_patch` (desktop side). |

## Architecture

### A. Shared session command (`@patchwire/core`)

Move the extension's `buildRemoteCommand` + `SessionTarget` into core (mirroring the `sync-templates` share) and add a pure full-command builder:
- `packages/core/src/session-command.ts`: `SessionTarget`, `buildRemoteCommand(target, skipPermissions)` (verbatim move: `cd <remotePath> && <banner> && exec zsh -lic 'claude'`), and new `buildSessionShellCommand(target, keyPath, skipPermissions)` → the full `ssh -tt -i <keyPath> -p <port> -o StrictHostKeyChecking=accept-new <user>@<host> '<remoteCommand>'` string.
- Core subpath export `"./session-command"`.
- Extension's `sessionTerminal.ts` imports `buildRemoteCommand`/`SessionTarget` from core (keeps its VS Code `openSessionTerminal`).
- Pure + unit-tested (move the extension's existing `buildRemoteCommand` tests to core; add `buildSessionShellCommand` tests: ssh flags, `-i` keyPath, `-p` port, remotePath unquoted-via-remote-command, single-quoted claude).

**Security:** `host`/`user` are already token-validated upstream (provisioning), `remotePath`/`project` regex-validated. The command contains single quotes only (no double quotes/newlines) so it passes the launcher guard.

### B. Cross-OS terminal launcher (Rust)

Generalize `open_terminal(command)` to run on all platforms (keep the name + signature so existing SetupWizard `openTerminal` callers are unaffected). A pure helper builds the spawn spec; `#[cfg]` per OS:
- **macOS:** `osascript -e 'tell application "Terminal" to do script "<command>"'` (existing).
- **Linux:** try terminals in order until one spawns: `x-terminal-emulator`, `gnome-terminal`, `konsole`, `xterm`, each invoked as `<term> -e bash -lc "<command>; exec bash"` (keep the window open after claude exits).
- **Windows:** `wt.exe` if present (`wt new-tab cmd /k "<command>"`), else `cmd /c start cmd /k "<command>"`.
- Keep the guard: reject `\n`/`\r` (and `"`), so the single-quoted ssh command is accepted. The pure `terminalLaunchSpec(os, command) -> { program, args }` is unit-testable per-OS; the actual spawn + terminal availability is live-verify.

### C. Desktop ipc + helpers

- `lib/session.ts` (pure): `buildLaunchCommand(connection, project, skipPermissions)` — assembles `SessionTarget` from a `Connection` + `Project` and calls `buildSessionShellCommand` from core. Tested.
- `lib/ipc.ts`: reuse `openTerminal(command)`. Add `copyToClipboard(text)` (via `@tauri-apps/plugin-clipboard-manager` `writeText`, cross-OS) and `gitStatus(projectDir): Promise<ChangedFile[]>` → `invoke("git_status", { projectDir })` then `parseGitStatus`.
- `lib/git-status.ts` (pure): `parseGitStatus(porcelain: string): { path: string; status: string }[]`. Tested.

### D. Rust additions

- `git_status(project_dir) -> Result<String,String>`: run `git -C <dir> status --porcelain` (guard: dir exists), return stdout. (Parser is TS-side.)
- Register `git_status`. Remove `start_chat`, `cancel_chat`, `apply_patch` commands + `ChatState` + their handler entries. (`push_attachment` stays.)

### E. Components + Workspace re-layout

- **Delete:** `components/ChatPane.svelte` (+ test), `lib/chat-session.ts` (+ test), `lib/chat-events.ts` (+ test), `components/ChangesPanel.svelte` (+ test, the diff/apply one).
- **New `components/SessionLauncher.svelte`** (left pane): a short explainer + **"Open claude session"** button → `openTerminal(buildLaunchCommand(...))`; optional `--dangerously-skip-permissions` checkbox (mirrors the extension's toggle). Shows the launch command on hover/expand for transparency.
- **New `components/ChangesList.svelte`** (right pane): renders `gitStatus` results (path + status badge), a Refresh button; auto-refreshes on sync `status` events.
- **New `components/AttachPanel.svelte`** (right pane): attach file / clipboard image → `pushAttachment` → `copyToClipboard(remotePath)` → toast/inline "copied: <path>"; list of staged attachments with remove.
- **`Workspace.svelte`:** remove all chat/diff/apply state + handlers; left = `SessionLauncher`; right = `AttachPanel` + `ChangesList` + `FlutterPanel` (unchanged); keep header, `SyncPill`, sync watch.

### New deps
- Frontend: `@tauri-apps/plugin-clipboard-manager`.
- Rust: `tauri-plugin-clipboard-manager` (register the plugin). No `portable-pty` / `xterm` (embedded terminal explicitly rejected).

## Data flow

```
Open claude session → buildLaunchCommand(connection, project) → openTerminal(cmd)
   → OS terminal runs: ssh -tt -i key -p port user@host 'cd remotePath && banner && exec zsh -lic claude'
   → user works in the real claude REPL on the remote
   → claude edits remote files → mutagen syncs → local files update → ChangesList (git status) reflects them
Attach → pushAttachment (upload to inbox) → copyToClipboard(remotePath) → user pastes into claude
```

## Testing

- **core:** `buildRemoteCommand` (moved tests), `buildSessionShellCommand` (ssh flags/key/port/quoting).
- **desktop pure:** `buildLaunchCommand` (assembles from Connection+Project), `parseGitStatus` (porcelain → entries, incl. renames `R`, untracked `??`, empty), `terminalLaunchSpec` if mirrored in TS (else Rust-only/live-verify).
- **desktop components:** `SessionLauncher.test` (button calls openTerminal with the built command; skip-permissions toggles the flag), `AttachPanel.test` (attach → pushAttachment → copyToClipboard called with remote path), `ChangesList.test` (renders parsed entries, Refresh calls gitStatus). Mock tauri invoke/clipboard as existing tests do.
- **extension:** still green after importing `buildRemoteCommand` from core (re-export parity).
- **Rust** (`git_status`, cross-OS `open_terminal` branches) + real terminal launch: **live-verify** (no Rust tests). Manual: Open session on macOS → Terminal.app opens, claude runs; attach → path on clipboard; edit via claude → ChangesList shows the file.

## Out of scope

- Embedded in-app terminal (xterm/pty) — explicitly rejected.
- Wiring the terminal claude to the patchwire-flutter MCP (separate; FlutterPanel stays as-is).
- Removing the CLI/agent `/chat` endpoint (the extension/agent own that; desktop just stops calling it).
- Windows/Linux terminal polish beyond a best-effort launcher (live-verify; macOS is the proven path).

## Build sequence (for the plan)

1. core `session-command.ts` (move `buildRemoteCommand`+`SessionTarget`, add `buildSessionShellCommand`) + subpath export + tests; extension re-imports; extension tests green.
2. desktop pure: `lib/git-status.ts` parser + `lib/session.ts buildLaunchCommand` + tests.
3. Rust: `git_status` command (+register); cross-OS `open_terminal`; remove `start_chat`/`cancel_chat`/`apply_patch` + `ChatState`; register clipboard plugin; `cargo build`.
4. ipc: `copyToClipboard`, `gitStatus`; remove chat ipc (`startChat`/`cancelChat`/`applyPatch`/`onChatEvent`/`onChatEnd`); add core dep already present.
5. Components: `SessionLauncher`, `AttachPanel`, `ChangesList` (+ tests); delete ChatPane/ChangesPanel/chat-session/chat-events (+ tests).
6. `Workspace.svelte` re-layout + remove chat state; update `Workspace.test.ts`.
