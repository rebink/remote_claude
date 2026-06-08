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
- `formatAttachmentRef(relPaths)` — render the prompt suffix, e.g. `\n\n[Attached file(s): .patchwire-inbox/shot.png]`.
- `pruneInbox(projectDir)` — empty `.patchwire-inbox/` (used by cleanup).
- `MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024` (reject larger with a clear error).

### Extension — drag/paste in the chat input
- `packages/extension/src/chat/webview/main.ts`: add `dragover`/`drop` and `paste` handlers on the input. `paste` captures clipboard images (the dominant screenshot case); `drop` captures Finder files. The webview reads the bytes and `postMessage({ type: 'attach', name, bytes })` to the host.
- `packages/extension/src/chat/ChatPanel.ts`: on `attach` → write bytes to `.patchwire-inbox/<name>` via `stageAttachment` → `await mutagen.flush()` → post back `{ type: 'attached', relPath }`. The webview shows an attachment **chip** ("📎 shot.png ✓") and, on send, appends `formatAttachmentRef([...])` to the prompt text the existing send path already uses.
- No change to the chat transport — only the prompt string gains a reference, and the bytes ride Mutagen.

### CLI — `patchwire push`
- `packages/cli/src/commands/push.ts` + registration in `cli.ts`.
- `patchwire push <file>...` → `ensureInbox`, copy locally into `.patchwire-inbox/` (collision-safe), rsync **just that file** to `<remote.path>/.patchwire-inbox/<name>`, print the remote path to paste into the SSH `claude` session. Always copies — no "translate, it's already synced" optimization, because the SSH user may not be running Patchwire's rsync sync at all, so we can't assume the project is mirrored.
- `patchwire push --clip` → read the clipboard image (`pngpaste` if present, else `osascript` fallback), write to a temp file, push it.
- `patchwire push --clean` → `pruneInbox` locally and `rm -rf` the remote inbox.

## Data flow (extension happy path)
`drag/paste → webview reads bytes → host stageAttachment → mutagen.flush() → chip shows ✓ → on send, prompt += "[Attached: …]" → existing /chat send → remote claude reads the file`

## Error handling
- **Sync not running / Mutagen not installed** (extension) → chip shows "needs sync running"; the reference is not appended (no dangling path).
- **Flush timeout** → "still syncing attachment…"; block send until confirmed or user removes the chip.
- **File too large / unreadable** → reject with a clear message; nothing staged.
- **CLI `push` with no config/key/remote** → the same clear errors the other CLI commands already emit.
- **Name collision** → auto-suffix; never overwrite an existing attachment.

## Cleanup
- Extension: `pruneInbox` **on chat-session start** (not mid-session — avoids surprising deletes), plus a "Clear attachments" action.
- CLI: `patchwire push --clean`.
- Rationale: attachments are ephemeral context, not project data; pruning at session boundaries keeps the inbox bounded without disrupting an active conversation.

## Testing
**In-repo (TDD):**
- `ensureInbox` idempotent (dir + single `.gitignore` line); `sanitizeName` strips separators; `stageAttachment` collision suffixing + returns project-relative path; `formatAttachmentRef` formatting; `pruneInbox` empties; size-cap rejection.
- CLI `push`: rsync argv construction for a single file into the remote inbox; remote-path output formatting; `--clip`/`--clean` flag plumbing.
- Extension host: an `attach` message maps to stage → flush → `attached` reply (host logic unit-tested with a stubbed Mutagen + vscode; the webview DOM wiring stays thin).

**Manual, on the box (can't automate here):**
- Real Mutagen carry of a dropped file; remote `claude` actually reading an attached **image for vision**; the SSH `push` round-trip.

## Out of scope (follow-ups)
- A "watch a local folder, auto-sync" mode.
- Inlining bytes into the chat protocol (Approach C) as a fallback for non-Mutagen setups.
- Non-macOS clipboard image capture.

## Success criteria
- Extension: drag a Finder file or paste a screenshot onto the chat input → it appears as a synced chip → sending references it → remote `claude` reads it (incl. vision).
- CLI: `patchwire push <file>` (and `--clip`) prints a working remote path; `--clean` clears the inbox.
- `.patchwire-inbox/` is gitignored and never appears in a returned diff.
- Default behavior with no attachment is unchanged (no regression).
