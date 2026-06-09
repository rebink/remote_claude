# View / delete staged attachments — design

**Date:** 2026-06-09
**Status:** approved (brainstorming) → ready for implementation plan
**Surface:** VS Code extension panel only (CLI deferred; shared core stays reusable)

## Goal

Let a developer see every file currently staged for the remote `claude` session,
open any one of them, and delete individual ones — from the Patchwire side panel.
Today the only control is all-or-nothing (`patchwire push --clean` and a prune on
session start). There is no list, no per-file view, no per-file delete.

## Context (what already exists)

The file-attachments feature (spec `2026-06-08-file-attachments-design.md`) stages
each attachment into a gitignored **`.patchwire-inbox/`** at the project root:

- `stageAttachment(localPath, projectDir)` copies the file into the **local**
  `.patchwire-inbox/<name>` (collision-safe) and returns the project-relative path.
- Sync mirrors that directory to the remote (Mutagen two-way in the extension;
  rsync in the CLI). Mutagen does not honor `.gitignore`, so the inbox still syncs.
- `pruneInbox(projectDir)` empties the inbox; the extension prunes on session start
  and relies on Mutagen to propagate the deletion to the remote.

**Key insight that makes "view" cheap:** the asset is **not remote-only**. The local
`.patchwire-inbox/` is the source of truth that sync mirrors. Listing is a local
directory read; viewing is opening the local file; deleting is a local `rm` that
Mutagen carries to the remote. No remote fetch is needed.

**How the extension touches the inbox today (verified):** it does **not** import the
CLI's `attachments.ts`. It spawns the bundled CLI (`resolveCli` + `spawn`) — prune on
session start is `patchwire push --clean --stage-only --json`. For list/view/delete we
do **not** add CLI flags or a cross-package import. The extension host is Node and the
inbox has a local mirror, so we add a small node-fs inbox helper inside the extension.
This keeps the change extension-only and matches "list/view/delete is a local op."

## Architecture

Three layers, smallest blast radius first.

### 1. Extension inbox helper — new `packages/extension/src/attach/inbox.ts`

Two small, unit-testable node-fs functions. No cross-package import; `INBOX_DIR` is
defined locally as the fixed wire contract (`'.patchwire-inbox'`), with a comment
pointing at the CLI's `attachments.ts` as the source of truth for the value.

```ts
export const INBOX_DIR = '.patchwire-inbox'; // contract: matches cli/src/lib/attachments.ts

export interface InboxEntry {
  name: string;     // basename, e.g. "mockup.png"
  relPath: string;  // ".patchwire-inbox/mockup.png"
  size: number;     // bytes
}

/** List staged attachments (regular files only), sorted by name. Empty if no inbox. */
export function listInbox(projectDir: string): InboxEntry[];

/**
 * Delete one staged attachment by name. `name` is reduced to a basename and the
 * resolved path MUST stay inside the inbox (reject traversal). No-op if absent.
 */
export function removeAttachment(projectDir: string, name: string): void;
```

- `listInbox`: if `<projectDir>/.patchwire-inbox` is missing, return `[]`. Otherwise
  `readdirSync`, keep regular files (skip subdirs / non-files via `lstatSync`),
  map to `{name, relPath: \`${INBOX_DIR}/${name}\`, size}`, sort by `name`.
- `removeAttachment`: reduce `name` to a `basename` and strip unsafe chars; resolve
  `join(projectDir, INBOX_DIR, safe)`; verify the resolved path is inside the resolved
  inbox dir (defense in depth against `..` / symlink escape); `rmSync(..., {force:true})`.

The CLI's `attachments.ts` is **left untouched**; no new CLI flags.

### 2. Extension host — `packages/extension/src/chat/ChatPanel.ts`

- **State:** extend `postState()` to include `attachments: InboxEntry[]` from
  `listInbox(this.workspaceFolder)`. The webview renders it under the sync card.
- **Messages** (added to the existing `onDidReceiveMessage` switch):
  - `viewAttachment` `{ name }` → resolve the local inbox file and
    `vscode.commands.executeCommand('vscode.open', vscode.Uri.file(absPath))`.
    Images open in VS Code's native image preview; text/code/PDF open in their
    default viewers. Guard: file must exist and resolve inside the inbox.
  - `deleteAttachment` `{ name }` → confirm via
    `vscode.window.showWarningMessage(\`Delete attachment "${name}"? This also
    removes it from the remote.\`, { modal: true }, 'Delete')`; on confirm call
    `removeAttachment(this.workspaceFolder, name)`, then best-effort
    `await this.mutagen?.flush()` (propagate the delete), then `postState()`.
- **Auto-refresh:** a `vscode.FileSystemWatcher` on
  `new vscode.RelativePattern(this.workspaceFolder, '.patchwire-inbox/*')`
  calls `postState()` on create/delete/change so the list stays current when the
  developer attaches a file, deletes one, or sync brings changes. Disposed with the panel.

No new VS Code commands are required; the panel owns the Mutagen session and the
workspace folder, the same way `flush()` / `attachFile` already work.

### 3. Webview — `packages/extension/src/chat/webview/main.ts`

A new section rendered from `state.attachments`, placed under the existing sync card:

```
ATTACHMENTS (3)
  ▣  mockup.png    412 KB   👁   🗑
  ▣  error.txt       2 KB   👁   🗑
  ▣  schema.sql      8 KB   👁   🗑
```

- One row per entry: a file glyph, the name (ellipsized if long), a human size
  (`KB`/`MB`), a view button (posts `viewAttachment {name}`), a delete button
  (posts `deleteAttachment {name}`).
- **Empty state:** when `attachments` is empty, show a single quiet line
  "No attachments staged" (no row chrome). The section header count reflects length.
- Built with the same safe DOM construction the webview already uses (no innerHTML
  of file names). Styled with the existing panel CSS variables.

## Data flow

```
attach a file (existing) ─┐
delete a row ─────────────┤→ .patchwire-inbox/ changes
sync brings a change ─────┘            │
                          FileSystemWatcher → ChatPanel.postState()
                                       │
                          listInbox(workspaceFolder) → state.attachments
                                       │  postMessage({type:'state', state})
                          webview renders the ATTACHMENTS section

view  → webview posts viewAttachment{name} → host vscode.open(local file)
delete→ webview posts deleteAttachment{name} → host confirm → removeAttachment()
        → mutagen.flush() (remote copy clears) → postState()
```

## Delete semantics (explicit)

- Delete removes the **local** inbox file; Mutagen propagates the removal to the
  remote, exactly like the existing session-start prune.
- If sync is **paused**, the remote copy clears when sync resumes/flushes. The
  confirm dialog wording stays accurate ("also removes it from the remote") because
  the steady-state outcome is removal on both ends.
- A delete during an active `claude` turn only affects future reads; it does not
  interrupt the REPL.

## Error / edge handling

- `viewAttachment` / `deleteAttachment` for a name that no longer exists: re-post
  state (the row vanishes); no error toast for a benign race.
- Path traversal in `name`: `removeAttachment` and the host guards reject anything
  that resolves outside the inbox.
- No workspace folder / no inbox dir: `listInbox` returns `[]`, section shows empty.

## Testing

- **Inbox helper (extension vitest, `attach/inbox.test.ts`):** `listInbox` returns
  `[]` with no dir, lists + sorts files, skips subdirectories, reports sizes;
  `removeAttachment` deletes by name, is a no-op for a missing file, and rejects
  `../escape` and absolute paths (resolved path stays inside the inbox).
- **Host (extension vitest):** `deleteAttachment` handler calls `removeAttachment`
  then `mutagen.flush()` then re-posts state (stubbed fs + Mutagen + vscode window
  confirm); `viewAttachment` calls `vscode.open` with the resolved inbox uri;
  `postState` includes `attachments`. Webview render stays thin (manual check).

## Out of scope (v1)

- Inline image thumbnails in the panel (click-to-view opens the real preview).
- CLI `attachments list/view/rm` (extension-only by choice). The new helper lives in
  the extension; `cli/src/lib/attachments.ts` is untouched. A CLI surface, if ever
  wanted, would grow its own equivalents.
- Renaming attachments; bulk multi-select delete (single 🗑 per row; the existing
  `--clean` / session prune still clears all).

## Success criteria

- The panel shows every file in `.patchwire-inbox/` with name + size, live-updating
  as files are added, deleted, or synced.
- Clicking 👁 opens the file locally (image preview for images).
- Clicking 🗑, confirming, removes it locally and from the remote, and the row
  disappears.
- `.patchwire-inbox/` stays gitignored and never appears in a returned diff.
