import * as vscode from 'vscode';
import { join } from 'node:path';
import { DiffContentProvider, SCHEME } from './diff/DiffContentProvider.ts';
import { ChatStore } from './chat/ChatStore.ts';
import { ChatPanel } from './chat/ChatPanel.ts';
import { registerCommands } from './commands.ts';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Remote Claude');
  context.subscriptions.push(output);
  output.appendLine('Remote Claude activated.');

  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) { output.appendLine('No workspace open — Remote Claude is idle.'); return; }

  const chatStore = new ChatStore(join(ws, '.remote-claude', 'sessions'));
  const diff = new DiffContentProvider();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SCHEME, diff));

  registerCommands(context, { output, chatStore });

  const chatPanel = new ChatPanel(context.extensionUri, chatStore, {
    output,
    onSend: (id, p) => output.appendLine(`[stub] send ${id}: ${p}`),
    onDiffAction: (a) => output.appendLine(`[stub] diff: ${JSON.stringify(a)}`),
    onOpenDiff: (a) => output.appendLine(`[stub] open: ${JSON.stringify(a)}`),
    onCancel: (id) => output.appendLine(`[stub] cancel ${id}`),
    onDeleteRemote: async (id) => output.appendLine(`[stub] delete remote ${id}`),
  });
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(ChatPanel.viewId, chatPanel));
}

export function deactivate(): void {}
