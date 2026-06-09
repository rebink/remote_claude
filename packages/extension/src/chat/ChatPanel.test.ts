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

  it('ignores path-like attachment names without prompting or opening', async () => {
    const warn = vi.spyOn(vscode.window, 'showWarningMessage');
    const exec = vi.spyOn(vscode.commands, 'executeCommand').mockResolvedValue(undefined as never);
    await handler({ type: 'deleteAttachment', name: '../mockup.png' });
    await handler({ type: 'viewAttachment', name: '../mockup.png' });
    expect(warn).not.toHaveBeenCalled();
    expect(exec).not.toHaveBeenCalled();
    expect(existsSync(join(dir, INBOX_DIR, 'mockup.png'))).toBe(true);
  });
});
