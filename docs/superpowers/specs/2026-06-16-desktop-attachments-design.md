# Patchwire Desktop — Chat Attachments Design Spec

**Date:** 2026-06-16
**Status:** Design approved (brainstorming), pending implementation plan

## Summary

Add file + clipboard-image attachments to the desktop chat workspace, matching the VS Code extension (`patchwire.attachFile` / `patchwire.attachClipboardImage`). The desktop reuses the CLI `push` command to stage an attachment into the project's `.patchwire-inbox/` (which the running mutagen sync carries to the remote), then references the staged remote path in the next chat prompt so Claude can read it.

The extension types the staged remote path into its Claude **terminal**. The desktop has no terminal (it's a streamed chat), so attachments are shown as **chips** above the composer and their remote paths are **auto-appended to the prompt on Send**.

## Locked decisions (brainstorm, 2026-06-16)

| Decision | Choice |
|---|---|
| Delivery to Claude | **Chips + auto-append on Send** (not inline-in-textarea) |
| Sources | **Both** file picker + clipboard image (full extension parity) |
| Staging mechanism | Reuse CLI `push [<file>|--clip] --stage-only --json` (no Tauri clipboard plugin) |

## How the extension does it (reference)

- `attachFile(localPath|null, deps, {clip})` → runs `push [<file>|--clip] --stage-only --json` → gets `{remotePath}` → `flushSync()` → types `remotePath` into the session terminal (fallback: copy to clipboard).
- CLI `push`: stages the file (or clipboard PNG via `pngpaste`/`osascript`) into `<cwd>/.patchwire-inbox/<name>` (gitignored, 25 MB cap, collision-safe), prints `{"remotePath":"…","remotePaths":[…]}`. `--stage-only` skips rsync (relies on the running sync to transfer).

## Components & flow (desktop)

1. **Rust `push_attachment(project_dir, file_path: Option<String>, use_clipboard: bool)`** — one-shot sidecar (mirror `apply_patch`/`init_remote_copy`): `current_dir = project_dir`, args `["push", <file? >, ["--clip"]?, "--stage-only", "--json"]`, `.output().await`, parse the last non-empty stdout line as JSON, return `remotePath` (string). Validate `project_dir` is a dir; require exactly one of `file_path` / `use_clipboard`.
2. **ipc:** `pickFile()` → Tauri `open({ directory: false, multiple: false })` → path|null. `pushAttachment(projectDir, filePath?, useClipboard)` → `invoke("push_attachment", { projectDir, filePath, useClipboard })` → remote path string.
3. **Pure helper `withAttachments(prompt, paths: string[]): string`** — returns `prompt` unchanged when `paths` is empty; else `${prompt}\n\nAttached:\n- ${p1}\n- ${p2}…`. (TDD.)
4. **Workspace** owns `attachments: { name: string; remotePath: string }[]` (`$state`):
   - `attachFile()` → `pickFile()` → if chosen, `pushAttachment(localPath, file, false)` → push `{ name: basename(file), remotePath }`.
   - `attachClip()` → `pushAttachment(localPath, undefined, true)` → push `{ name: "clipboard image", remotePath }`.
   - `removeAttachment(i)` → drop from the list.
   - `send(text)` → `startChat(localPath, uuid, withAttachments(text, attachments.map(a => a.remotePath)))` → clear `attachments`.
   - Errors (push/pickFile) → the existing workspace error bar.
5. **ChatPane** (presentational): receives `attachments` + `onattachfile`/`onattachclip`/`onremoveattachment`; renders 📎 + 📷 buttons by the composer and a removable chips row (filenames) above it. Send still calls `onsend(text)` (Workspace composes the final prompt).

## Data flow — attach then send

1. User clicks 📎 → file picker → `push_attachment` stages into `.patchwire-inbox/` → returns remote path → chip appears. (Or 📷 → `push --clip` reads the host clipboard PNG → stages → chip.)
2. Mutagen sync (running since workspace open) carries `.patchwire-inbox/<name>` to the remote.
3. User types a prompt + Send → prompt becomes `…\n\nAttached:\n- <remotePath>` → `startChat` → Claude (running on the remote) reads the attached file at that path.
4. Chips clear after send.

## Error handling

| Failure | Behavior |
|---|---|
| File picker cancelled | No-op (no chip) |
| `push` fails (file too big, no clipboard image, stage error) | Show the error in the workspace error bar; no chip added |
| No connection/sync running | The file still stages locally; if sync isn't active the remote copy lags — acceptable (sync starts on workspace open). |

## Out of scope

- Inline image preview / thumbnails (chips show filenames only).
- Drag-and-drop attach (later).
- Inbox cleanup UI (`push --clean`) — later.
- Non-macOS clipboard image (the CLI's `--clip` is macOS pngpaste/osascript; matches the project's mac-first target).

## Testing

- **Pure TS:** `withAttachments` (empty → unchanged; one/many → appended block) — TDD.
- **ipc:** `pickFile`, `pushAttachment` (command name + payload + returned path) — TDD with mocked invoke/dialog.
- **ChatPane:** renders attach buttons + chips; remove fires; send still fires `onsend` — TDD.
- **Workspace:** attach → `push_attachment` called with the project dir; chip added; send composes `withAttachments` into `start_chat`; chips cleared — TDD.
- **Rust:** `push_attachment` (cargo check; behavior verified by the live run).
- **End-to-end (human):** attach a file + a clipboard image in a real project → chips appear → send → Claude sees the files on the remote.

## Open items for the plan

- Confirm the CLI `push` flag spelling (`--stage-only` vs `--stageOnly`) by reading `cli.ts` (the explorer saw `--stage-only`).
- `basename` for chip names: reuse the existing helper (model.ts / wizard) rather than re-inline.
