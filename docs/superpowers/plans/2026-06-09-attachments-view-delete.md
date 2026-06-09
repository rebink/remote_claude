# View / delete staged attachments — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a developer list every file staged in `.patchwire-inbox/`, open any one, and delete individual ones from the Patchwire side panel.

**Architecture:** A small node-fs helper in the extension (`attach/inbox.ts`) lists and removes inbox files (the inbox has a local mirror, so no remote round-trip). `ChatPanel` includes the list in its state, handles `viewAttachment` (open the local file) and `deleteAttachment` (confirm, remove locally, flush Mutagen to clear the remote, re-post state), and watches the inbox to auto-refresh. The webview renders an attachments section. The CLI and `cli/src/lib/attachments.ts` are untouched.

**Tech Stack:** TypeScript, VS Code extension API, vitest (with `src/test/vscode-stub.ts` aliased for `vscode`), webview DOM via `chat/webview/h.ts`.

**Spec:** `docs/superpowers/specs/2026-06-09-attachments-view-delete-design.md`

**Test/build commands (from repo root):**
- Single test file: `pnpm --filter patchwire-vscode exec vitest run <path>`
- All extension tests: `pnpm --filter patchwire-vscode test`
- Typecheck: `pnpm --filter patchwire-vscode typecheck`
- Build: `pnpm --filter patchwire-vscode build`

---

## File structure

- Create: `packages/extension/src/attach/inbox.ts` — `INBOX_DIR`, `InboxEntry`, `listInbox`, `removeAttachment`.
- Create: `packages/extension/src/attach/inbox.test.ts` — helper unit tests.
- Modify: `packages/extension/src/test/vscode-stub.ts` — add `RelativePattern`, `window.onDidCloseTerminal/onDidOpenTerminal/terminals` so `ChatPanel` constructs in tests.
- Modify: `packages/extension/src/chat/ChatPanel.ts` — `attachments` in state, `handleMessage` extraction, view/delete handlers, inbox watcher.
- Create: `packages/extension/src/chat/ChatPanel.test.ts` — host handler tests.
- Modify: `packages/extension/src/chat/webview/main.ts` — `attachments` in `State`, `renderAttachments()`.
- Modify: `packages/extension/src/chat/webview/styles.css` — attachments section styles.

---

## Task 1: Inbox helper (`attach/inbox.ts`)

**Files:**
- Create: `packages/extension/src/attach/inbox.ts`
- Test: `packages/extension/src/attach/inbox.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/extension/src/attach/inbox.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listInbox, removeAttachment, INBOX_DIR } from './inbox.ts';

let dir: string;
const inbox = () => join(dir, INBOX_DIR);

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pw-inbox-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('listInbox', () => {
  it('returns [] when the inbox does not exist', () => {
    expect(listInbox(dir)).toEqual([]);
  });

  it('lists regular files sorted by name, with sizes and rel paths', () => {
    mkdirSync(inbox(), { recursive: true });
    writeFileSync(join(inbox(), 'b.txt'), 'xx');
    writeFileSync(join(inbox(), 'a.png'), 'yyyy');
    mkdirSync(join(inbox(), 'sub'));
    expect(listInbox(dir)).toEqual([
      { name: 'a.png', relPath: `${INBOX_DIR}/a.png`, size: 4 },
      { name: 'b.txt', relPath: `${INBOX_DIR}/b.txt`, size: 2 },
    ]);
  });
});

describe('removeAttachment', () => {
  it('deletes a staged file by name', () => {
    mkdirSync(inbox(), { recursive: true });
    writeFileSync(join(inbox(), 'a.png'), 'y');
    removeAttachment(dir, 'a.png');
    expect(existsSync(join(inbox(), 'a.png'))).toBe(false);
  });

  it('is a no-op for a missing file', () => {
    mkdirSync(inbox(), { recursive: true });
    expect(() => removeAttachment(dir, 'gone.png')).not.toThrow();
  });

  it('rejects path traversal and absolute paths', () => {
    const outside = join(dir, 'secret.txt');
    writeFileSync(outside, 'keep');
    expect(() => removeAttachment(dir, '../secret.txt')).toThrow();
    expect(() => removeAttachment(dir, 'a/b.txt')).toThrow();
    expect(() => removeAttachment(dir, outside)).toThrow();
    expect(() => removeAttachment(dir, '..')).toThrow();
    expect(existsSync(outside)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter patchwire-vscode exec vitest run src/attach/inbox.test.ts`
Expected: FAIL — cannot resolve `./inbox.ts`.

- [ ] **Step 3: Write the implementation**

Create `packages/extension/src/attach/inbox.ts`:

```ts
import { existsSync, readdirSync, lstatSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';

// Wire contract: must match INBOX_DIR in packages/cli/src/lib/attachments.ts.
export const INBOX_DIR = '.patchwire-inbox';

export interface InboxEntry {
  name: string;     // basename, e.g. "mockup.png"
  relPath: string;  // ".patchwire-inbox/mockup.png"
  size: number;     // bytes
}

/** List staged attachments (regular files only), sorted by name. Empty if no inbox. */
export function listInbox(projectDir: string): InboxEntry[] {
  const inbox = join(projectDir, INBOX_DIR);
  if (!existsSync(inbox)) return [];
  const out: InboxEntry[] = [];
  for (const name of readdirSync(inbox)) {
    if (!lstatSync(join(inbox, name)).isFile()) continue;
    out.push({ name, relPath: `${INBOX_DIR}/${name}`, size: lstatSync(join(inbox, name)).size });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Delete one staged attachment by name. The name must already be a bare basename
 * (no separators, not "." / ".."), which guarantees the target stays inside the
 * inbox. No-op if the file is absent. Throws on anything path-like.
 */
export function removeAttachment(projectDir: string, name: string): void {
  if (!name || name === '.' || name === '..' || name !== basename(name)) {
    throw new Error(`Invalid attachment name: ${name}`);
  }
  rmSync(join(projectDir, INBOX_DIR, name), { force: true });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter patchwire-vscode exec vitest run src/attach/inbox.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/attach/inbox.ts packages/extension/src/attach/inbox.test.ts
git commit -m "feat(extension): inbox helper to list and remove staged attachments"
```

---

## Task 2: vscode stub additions (test infra)

**Files:**
- Modify: `packages/extension/src/test/vscode-stub.ts`

These are needed so a `ChatPanel` can be constructed and its inbox watcher created under vitest. No standalone test; verified by Task 3.

- [ ] **Step 1: Add terminal events + RelativePattern to the stub**

In `packages/extension/src/test/vscode-stub.ts`, add `RelativePattern` near `Uri`:

```ts
export class RelativePattern {
  constructor(
    public readonly base: string | { fsPath?: string; path?: string },
    public readonly pattern: string,
  ) {}
}
```

And extend the `window` object with terminal surface (add these properties inside the existing `export const window = { ... }`):

```ts
  terminals: [] as unknown[],
  onDidCloseTerminal: (_cb: unknown) => ({ dispose: () => {} }),
  onDidOpenTerminal: (_cb: unknown) => ({ dispose: () => {} }),
```

- [ ] **Step 2: Typecheck the stub**

Run: `pnpm --filter patchwire-vscode typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add packages/extension/src/test/vscode-stub.ts
git commit -m "test(extension): stub RelativePattern + terminal events for panel tests"
```

---

## Task 3: ChatPanel host wiring

**Files:**
- Modify: `packages/extension/src/chat/ChatPanel.ts`
- Test: `packages/extension/src/chat/ChatPanel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/extension/src/chat/ChatPanel.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { ChatPanel } from './ChatPanel.ts';
import { INBOX_DIR } from '../attach/inbox.ts';

let dir: string;
let panel: ChatPanel;
let posted: Array<{ type: string; state?: any }>;
let handler: (msg: { type: string; [k: string]: unknown }) => unknown;

function fakeView() {
  return {
    webview: {
      options: {} as unknown,
      html: '',
      cspSource: 'self',
      asWebviewUri: (u: unknown) => u,
      postMessage: (m: { type: string; state?: any }) => { posted.push(m); return Promise.resolve(true); },
      onDidReceiveMessage: (cb: typeof handler) => { handler = cb; return { dispose() {} }; },
    },
  } as unknown as vscode.WebviewView;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pw-panel-'));
  // A valid patchwire.yml so postState takes the configured branch.
  writeFileSync(join(dir, 'patchwire.yml'),
    'project: app\nremote:\n  host: h\n  user: u\n  path: /home/u/app\n');
  // dummy webview html so renderHtml() does not read a missing file
  mkdirSync(join(dir, 'dist', 'webview'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'webview', 'index.html'), '<html>${scriptUri}${stylesUri}${nonce}${cspSource}</html>');
  mkdirSync(join(dir, INBOX_DIR), { recursive: true });
  writeFileSync(join(dir, INBOX_DIR, 'mockup.png'), 'pngdata');
  posted = [];
  const output = { appendLine: () => {}, show: () => {} } as unknown as vscode.OutputChannel;
  panel = new ChatPanel(vscode.Uri.file(dir), dir, { output });
  panel.resolveWebviewView(fakeView());
});

afterEach(() => { rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });

describe('ChatPanel attachments', () => {
  it('includes the inbox listing in posted state', async () => {
    await handler({ type: 'ready' });
    const last = posted.at(-1)!;
    expect(last.type).toBe('state');
    expect(last.state.attachments).toEqual([
      { name: 'mockup.png', relPath: `${INBOX_DIR}/mockup.png`, size: 7 },
    ]);
  });

  it('viewAttachment opens the local inbox file', async () => {
    const exec = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined as never);
    await handler({ type: 'viewAttachment', name: 'mockup.png' });
    expect(exec).toHaveBeenCalledTimes(1);
    const [cmd, uri] = exec.mock.calls[0] as [string, { fsPath: string }];
    expect(cmd).toBe('vscode.open');
    expect(uri.fsPath).toBe(join(dir, INBOX_DIR, 'mockup.png'));
  });

  it('deleteAttachment removes the file after confirmation and re-posts state', async () => {
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue('Delete' as never);
    await handler({ type: 'deleteAttachment', name: 'mockup.png' });
    expect(existsSync(join(dir, INBOX_DIR, 'mockup.png'))).toBe(false);
    expect(posted.at(-1)!.state.attachments).toEqual([]);
  });

  it('deleteAttachment does nothing when not confirmed', async () => {
    vi.spyOn(vscode.window, 'showWarningMessage').mockResolvedValue(undefined as never);
    await handler({ type: 'deleteAttachment', name: 'mockup.png' });
    expect(existsSync(join(dir, INBOX_DIR, 'mockup.png'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter patchwire-vscode exec vitest run src/chat/ChatPanel.test.ts`
Expected: FAIL — `state.attachments` undefined and `viewAttachment`/`deleteAttachment` unhandled.

- [ ] **Step 3: Implement the host changes**

In `packages/extension/src/chat/ChatPanel.ts`:

(a) Update imports — add `basename` to the path import and import the inbox helper:

```ts
import { join, basename } from 'node:path';
import { listInbox, removeAttachment, type InboxEntry, INBOX_DIR } from '../attach/inbox.ts';
```

(b) Add `attachments` to `SessionState`:

```ts
interface SessionState {
  configured: boolean;
  project?: string;
  host?: string;
  user?: string;
  sshPort?: number;
  remotePath?: string;
  sessionRunning: boolean;
  sync: SyncUiState;
  attachments?: InboxEntry[];
}
```

(c) Add an instance field for the watcher (next to `private view?`):

```ts
  private inboxWatcher?: vscode.FileSystemWatcher;
```

(d) Replace the inline `onDidReceiveMessage` arrow in `resolveWebviewView` with a call to a method, and create the inbox watcher. Replace the existing `view.webview.onDidReceiveMessage(async (msg ...) => { switch ... });` block with:

```ts
    view.webview.onDidReceiveMessage((msg: { type: string; [k: string]: unknown }) => this.handleMessage(msg));

    this.inboxWatcher?.dispose();
    this.inboxWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.workspaceFolder, `${INBOX_DIR}/*`),
    );
    const refresh = () => this.postState();
    this.inboxWatcher.onDidCreate(refresh);
    this.inboxWatcher.onDidDelete(refresh);
    this.inboxWatcher.onDidChange(refresh);
```

(e) Add the `handleMessage` method (place it just after `resolveWebviewView`):

```ts
  private async handleMessage(msg: { type: string; [k: string]: unknown }): Promise<void> {
    switch (msg.type) {
      case 'ready':           return this.postState();
      case 'openSetup':       return void vscode.commands.executeCommand('patchwire.openSetup');
      case 'openSession':     return this.handleOpenSession();
      case 'flushSync':       return this.mutagen?.flush();
      case 'pauseSync':       this.mutagen?.pause(); return;
      case 'resumeSync':      this.mutagen?.resume(); return;
      case 'restartSync':     return this.startMutagen();
      case 'viewOutput':      return this.deps.output.show();
      case 'attachFile':      return void vscode.commands.executeCommand('patchwire.attachFile');
      case 'viewAttachment':  return this.handleViewAttachment(String(msg.name ?? ''));
      case 'deleteAttachment':return this.handleDeleteAttachment(String(msg.name ?? ''));
      default:
        this.deps.output.appendLine(`ChatPanel: unknown message type "${msg.type}"`);
        return;
    }
  }

  private async handleViewAttachment(name: string): Promise<void> {
    if (!name || name !== basename(name)) return;
    const uri = vscode.Uri.file(join(this.workspaceFolder, INBOX_DIR, name));
    await vscode.commands.executeCommand('vscode.open', uri);
  }

  private async handleDeleteAttachment(name: string): Promise<void> {
    if (!name) return;
    const pick = await vscode.window.showWarningMessage(
      `Delete attachment "${name}"? This also removes it from the remote.`,
      { modal: true },
      'Delete',
    );
    if (pick !== 'Delete') return;
    try {
      removeAttachment(this.workspaceFolder, name);
    } catch (err) {
      this.deps.output.appendLine(`Delete attachment failed: ${(err as Error).message}`);
    }
    await this.flush();      // propagate the removal to the remote
    this.postState();
  }
```

(f) Include attachments in the configured branch of `postState`:

```ts
    const state: SessionState = cfg
      ? {
          configured: true,
          project: cfg.project,
          host: cfg.host,
          user: cfg.user,
          sshPort: cfg.sshPort,
          remotePath: cfg.remotePath,
          sessionRunning: !!findExistingSessionTerminal(cfg.project),
          sync,
          attachments: listInbox(this.workspaceFolder),
        }
      : { configured: false, sessionRunning: false, sync };
```

(g) Dispose the watcher in `dispose()`:

```ts
  async dispose(): Promise<void> {
    this.inboxWatcher?.dispose();
    if (this.mutagen) await this.mutagen.terminate();
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter patchwire-vscode exec vitest run src/chat/ChatPanel.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter patchwire-vscode typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/extension/src/chat/ChatPanel.ts packages/extension/src/chat/ChatPanel.test.ts
git commit -m "feat(extension): panel lists/views/deletes staged attachments"
```

---

## Task 4: Webview attachments section

**Files:**
- Modify: `packages/extension/src/chat/webview/main.ts`
- Modify: `packages/extension/src/chat/webview/styles.css`

No webview unit-test harness exists in this package, so this task is verified by typecheck + build + a manual render note.

- [ ] **Step 1: Add the attachments type to `State` and render it**

In `packages/extension/src/chat/webview/main.ts`, add an `Attachment` interface and extend `State`:

```ts
interface Attachment { name: string; relPath: string; size: number }

interface State {
  configured: boolean;
  project?: string;
  host?: string;
  user?: string;
  remotePath?: string;
  sessionRunning: boolean;
  sync: SyncUiState;
  attachments?: Attachment[];
}
```

Add `renderAttachments()` to the configured render, between `renderSync()` and `renderFooter()`:

```ts
  root.append(renderHeader(), renderActions(), renderSync(), renderAttachments(), renderFooter());
```

Add the functions (place before `renderFooter`):

```ts
function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderAttachments(): HTMLElement {
  const items = currentState.attachments ?? [];
  const wrap = h('div', { className: 'attachments' });
  wrap.append(
    h('div', { className: 'attach-header' },
      h('span', { className: 'attach-title' }, 'Attachments'),
      h('span', { className: 'attach-count' }, String(items.length)),
    ),
  );
  if (items.length === 0) {
    wrap.append(h('p', { className: 'empty' }, 'No attachments staged.'));
    return wrap;
  }
  for (const a of items) {
    wrap.append(
      h('div', { className: 'attach-row' },
        h('span', { className: 'attach-name', title: a.name }, a.name),
        h('span', { className: 'attach-size' }, humanSize(a.size)),
        h('span', { className: 'attach-actions' },
          h('button', {
            className: 'attach-btn', title: 'Open',
            events: { click: () => vscode.postMessage({ type: 'viewAttachment', name: a.name }) },
          }, '👁'),
          h('button', {
            className: 'attach-btn', title: 'Delete',
            events: { click: () => vscode.postMessage({ type: 'deleteAttachment', name: a.name }) },
          }, '🗑'),
        ),
      ),
    );
  }
  return wrap;
}
```

- [ ] **Step 2: Add styles**

Append to `packages/extension/src/chat/webview/styles.css`:

```css
.attachments { margin-bottom: 16px; }
.attach-header { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.attach-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.7; }
.attach-count { font-size: 11px; opacity: 0.5; }
.attach-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
.attach-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.attach-size { font-size: 11px; opacity: 0.55; font-variant-numeric: tabular-nums; }
.attach-actions { display: flex; gap: 2px; }
.attach-btn { padding: 2px 6px; background: transparent; }
.attach-btn:hover { background: var(--vscode-toolbar-hoverBackground, rgba(255,255,255,0.08)); }
```

- [ ] **Step 3: Typecheck + build**

Run: `pnpm --filter patchwire-vscode typecheck && pnpm --filter patchwire-vscode build`
Expected: both PASS; `dist/webview/main.js` rebuilt.

- [ ] **Step 4: Manual render note**

Document in the PR that the attachments section was visually confirmed in the Extension Development Host: with files staged it shows rows with 👁 / 🗑; empty shows "No attachments staged."; delete prompts a modal and the row disappears after confirm.

- [ ] **Step 5: Commit**

```bash
git add packages/extension/src/chat/webview/main.ts packages/extension/src/chat/webview/styles.css
git commit -m "feat(extension): webview attachments list with view + delete"
```

---

## Final verification

- [ ] All extension tests: `pnpm --filter patchwire-vscode test` (existing 19 + new 9 pass).
- [ ] Typecheck clean: `pnpm --filter patchwire-vscode typecheck`.
- [ ] Build clean: `pnpm --filter patchwire-vscode build`.
- [ ] `cli/src/lib/attachments.ts` and the CLI are unchanged (confirm `git diff --stat` touches only extension files + this plan/spec).
