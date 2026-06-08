# Local file attachments for remote Claude

**Date:** 2026-06-08
**Status:** Approved design (interaction + approach confirmed with the user). Ready for implementation plan.

## Problem
`claude` runs on the **remote** Mac Mini. When a developer attaches/drag-drops a local file, the inserted path is a **local** path the remote can't resolve, so claude reports "not found." This breaks two workflows:
1. **Interactive `claude` over SSH** (shared-workstation): dragging a file into the SSH terminal yields a local path.
2. **VS Code extension chat**: a referenced local file (or pasted screenshot) isn't on the remote.

Must support every attachment type Claude Code supports — text, code, PDFs, and **images for vision**.

## Approach (confirmed: "A")
A gitignored **`.patchwire-inbox/`** at the project root is a shared staging area. A file placed there reaches the remote via the **existing sync** (Mutagen in the extension, a direct rsync in the CLI), and the remote `claude` reads it by its in-project path. This works for all file types because Claude reads attachments by path on the machine it runs on, including images for vision.

### Why this is correct (verified against the code)
- **Mutagen does not honor `.gitignore`** — `MutagenController` uses `--ignore-vcs` + an explicit `IGNORE_PATTERNS` list, so a gitignored `.patchwire-inbox/` **still syncs** (as long as we don't add it to `IGNORE_PATTERNS`).
- **`MutagenController.flush()` already exists** (`mutagen sync flush`) — forces an immediate sync and returns on completion, so the extension can guarantee the attachment is on the remote *before* sending the prompt.
- **`captureDiff` uses `git add -A`**, which skips gitignored files — so attachments **never appear in the returned diff** or get committed.
- The CLI `sync`/`ask` rsync **omits `--delete`**, so files `push`ed to the remote inbox persist across later syncs.

## Components

### Shared — `packages/cli/src/lib/attachments.ts`
- `INBOX_DIR = '.patchwire-inbox'`.
- `ensureInbox(projectDir)` — create `.patchwire-inbox/` and append `.patchwire-inbox/` to `.gitignore` if absent. Idempotent.
- `sanitizeName(name)` — strip path separators / unsafe chars to a safe basename.
- `stageAttachment(localPath, projectDir)` — copy the file to `.patchwire-inbox/<sanitized>`, resolving collisions (`name.png`, `name-2.png`), return the **project-relative** path (`.patchwire-inbox/name.png`).
- `remoteAttachmentPath(remoteProjectPath, relPath)` — posix-join the remote project path with the staged relative path → the absolute remote path the developer/REPL references (e.g. `~/workspace/myapp/.patchwire-inbox/name.png`). Used by both surfaces.
- `pruneInbox(projectDir)` — empty `.patchwire-inbox/` (used by cleanup).
- `MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024` (reject larger with a clear error).

### Extension — an "Attach" action that types the path into the session terminal
**Architecture note (verified):** the extension's AI interaction is **not a webview chat input**. `openSessionTerminal` (`session/sessionTerminal.ts`) opens a VS Code **terminal** that SSHes to the Mac Mini and runs the interactive `claude` REPL; the `ChatPanel` webview is only a sync-status + controls panel. So there is no outgoing prompt string to inject into — the developer types into a terminal. The attach flow integrates with that terminal instead.

- New `packages/extension/src/attach/attachFile.ts` (host-side): given a local file path (or pasted image bytes) + the workspace folder + the session terminal:
  1. `ensureInbox` + `stageAttachment` (reused from the CLI `lib/attachments.ts` — bundled into the extension the same way the CLI already is).
  2. `await mutagen.flush()` so the file is on the remote before referencing it.
  3. Insert the **remote path** into the active `claude` REPL via `terminal.sendText('<remote.path>/.patchwire-inbox/<name>', false)` (no newline — it appears in the prompt for the developer to send). If no session terminal is open, fall back to `vscode.env.clipboard.writeText(remotePath)` and show "remote path copied — paste it into your session."
- Wiring: a command `patchwire.attachFile` (file picker → `attachFile`) registered in `commands.ts`, surfaced as an **"📎 Attach file"** button in the `ChatPanel` webview (`postMessage({ type: 'attachFile' })` → host runs the command) and in the command palette. A second command `patchwire.attachClipboardImage` grabs a pasted screenshot (macOS `pngpaste`/`osascript`) → same flow.
- The remote path is computed from `patchwire.yml`'s `remote.path` (already read by `ChatPanel.loadConfig()` → `SessionTarget.remotePath`).
- No change to the terminal/session transport — the bytes ride Mutagen, and the path is typed into the REPL.

### CLI — `patchwire push`
- `packages/cli/src/commands/push.ts` + registration in `cli.ts`.
- `patchwire push <file>...` → `ensureInbox`, copy locally into `.patchwire-inbox/` (collision-safe), rsync **just that file** to `<remote.path>/.patchwire-inbox/<name>`, print the remote path to paste into the SSH `claude` session. Always copies — no "translate, it's already synced" optimization, because the SSH user may not be running Patchwire's rsync sync at all, so we can't assume the project is mirrored.
- `patchwire push --clip` → read the clipboard image (`pngpaste` if present, else `osascript` fallback), write to a temp file, push it.
- `patchwire push --clean` → `pruneInbox` locally and `rm -rf` the remote inbox.

## Data flow (extension happy path)
`Attach action (picker / clipboard) → host stageAttachment into .patchwire-inbox/ → mutagen.flush() → terminal.sendText(remotePath) → developer's claude REPL prompt now holds the remote path → they hit enter → remote claude reads the file`

## Error handling
- **Sync not running / Mutagen not installed** (extension) → show a clear notification ("start the session/sync first"); do **not** type a path the remote doesn't have yet.
- **No session terminal open** → clipboard fallback: copy the remote path and notify "paste it into your session."
- **Flush timeout** → notify "still syncing attachment…"; don't insert the path until the flush resolves.
- **File too large / unreadable** → reject with a clear message; nothing staged.
- **CLI `push` with no config/key/remote** → the same clear errors the other CLI commands already emit.
- **Name collision** → auto-suffix; never overwrite an existing attachment.

## Cleanup
- Extension: `pruneInbox` **on chat-session start** (not mid-session — avoids surprising deletes), plus a "Clear attachments" action.
- CLI: `patchwire push --clean`.
- Rationale: attachments are ephemeral context, not project data; pruning at session boundaries keeps the inbox bounded without disrupting an active conversation.

## Testing
**In-repo (TDD):**
- `ensureInbox` idempotent (dir + single `.gitignore` line); `sanitizeName` strips separators; `stageAttachment` collision suffixing + returns project-relative path; `remoteAttachmentPath` posix-joins correctly; `pruneInbox` empties; size-cap rejection.
- CLI `push`: rsync argv construction for a single file into the remote inbox; remote-path output formatting; `--clip`/`--clean` flag plumbing.
- Extension host: `attachFile(localPath, target, deps)` stages → flushes → calls `terminal.sendText(remotePath)`; with no terminal it writes the path to the clipboard instead. Unit-tested with stubbed Mutagen + vscode terminal/clipboard (the webview button + command registration stay thin).

**Manual, on the box (can't automate here):**
- Real Mutagen carry of a dropped file; remote `claude` actually reading an attached **image for vision**; the SSH `push` round-trip.

## Out of scope (follow-ups)
- A "watch a local folder, auto-sync" mode.
- Inlining bytes into the chat protocol (Approach C) as a fallback for non-Mutagen setups.
- Non-macOS clipboard image capture.

## Success criteria
- Extension: click "📎 Attach file" (or attach-clipboard-image) → the file syncs → the remote `.patchwire-inbox/<name>` path is typed into the active `claude` session terminal → the developer sends it → remote `claude` reads it (incl. vision). No open terminal → path copied to clipboard.
- CLI: `patchwire push <file>` (and `--clip`) prints a working remote path; `--clean` clears the inbox.
- `.patchwire-inbox/` is gitignored and never appears in a returned diff.
- Default behavior with no attachment is unchanged (no regression).
