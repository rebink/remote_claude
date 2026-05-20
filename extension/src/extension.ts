import * as vscode from 'vscode';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { DiffContentProvider, SCHEME } from './diff/DiffContentProvider.ts';
import { ChatStore } from './chat/ChatStore.ts';
import { ChatPanel } from './chat/ChatPanel.ts';
import { CliClient } from './cli/CliClient.ts';
import { deleteRemoteSession } from './cli/agent-rest.ts';
import { ChatController } from './chat/ChatController.ts';
import { registerCommands } from './commands.ts';
import { SyncController } from './sync/SyncController.ts';
import { StatusBarController } from './statusbar/StatusBarController.ts';
import { FileDecorationProvider } from './sync/FileDecorationProvider.ts';
import { SetupWizard } from './setup/SetupWizard.ts';

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Remote Claude');
  context.subscriptions.push(output);
  output.appendLine('Remote Claude activated.');

  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) { output.appendLine('No workspace open — Remote Claude is idle.'); return; }

  const chatStore = new ChatStore(join(ws, '.remote-claude', 'sessions'));
  const diff = new DiffContentProvider();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SCHEME, diff));

  const cli = new CliClient('remote-claude', ws);
  const sync = new SyncController(cli, output);
  const status = new StatusBarController(ws, sync);
  context.subscriptions.push({ dispose: () => status.dispose() });

  const setupWizard = new SetupWizard(context.extensionUri, output);

  registerCommands(context, { output, chatStore, sync, status, setupWizard });

  const decor = new FileDecorationProvider(sync, chatStore);
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(decor));
  context.subscriptions.push({ dispose: () => decor.dispose() });

  const controller = new ChatController(cli, chatStore, output, sync, status);
  controller.onPendingDiffFiles = (paths) => decor.setPendingDiffFiles(paths);

  const chatPanel = new ChatPanel(context.extensionUri, chatStore, {
    output,
    onSend: (id, p) => controller.send(id, p),
    onDiffAction: (a) => controller.handleDiffAction(a),
    onOpenDiff: (a) => controller.handleOpenDiff(a),
    onCancel: (id) => controller.cancel(id),
    onDeleteRemote: async (id) => {
      try { await deleteRemoteSession(cli, id); }
      catch (e) { output.appendLine(`Failed to delete remote session: ${(e as Error).message}`); }
    },
  });
  controller.panel = chatPanel;
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(ChatPanel.viewId, chatPanel));

  const configPath = join(ws, 'remote-claude.yml');
  if (!existsSync(configPath)) {
    // Defer slightly so the activation hot path doesn't block on opening a tab.
    setTimeout(() => setupWizard.show(), 100);
  }
}

export function deactivate(): void {}
