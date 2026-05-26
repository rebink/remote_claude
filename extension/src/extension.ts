import * as vscode from 'vscode';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { DiffContentProvider, SCHEME } from './diff/DiffContentProvider.ts';
import { ChatPanel } from './chat/ChatPanel.ts';
import { CliClient } from './cli/CliClient.ts';
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

  const diff = new DiffContentProvider();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SCHEME, diff));

  const cli = new CliClient('remote-claude', ws);
  const sync = new SyncController(cli, output);
  const status = new StatusBarController(ws, sync);
  context.subscriptions.push({ dispose: () => status.dispose() });

  const setupWizard = new SetupWizard(context.extensionUri, output);

  const decor = new FileDecorationProvider(sync);
  context.subscriptions.push(vscode.window.registerFileDecorationProvider(decor));
  context.subscriptions.push({ dispose: () => decor.dispose() });

  const panel = new ChatPanel(context.extensionUri, ws, { output, sync, status });
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(ChatPanel.viewId, panel));

  registerCommands(context, { output, sync, status, setupWizard, panel });

  const configPath = join(ws, 'remote-claude.yml');
  if (!existsSync(configPath)) {
    // Defer slightly so the activation hot path doesn't block on opening a tab.
    setTimeout(() => setupWizard.show(), 100);
  }
}

export function deactivate(): void {}
