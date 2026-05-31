import * as vscode from 'vscode';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { DiffContentProvider, SCHEME } from './diff/DiffContentProvider.ts';
import { ChatPanel } from './chat/ChatPanel.ts';
import { registerCommands } from './commands.ts';
import { SetupWizard } from './setup/SetupWizard.ts';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Remote Claude');
  context.subscriptions.push(output);
  output.appendLine('Remote Claude activated.');

  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!ws) { output.appendLine('No workspace open — Remote Claude is idle.'); return; }

  const diff = new DiffContentProvider();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SCHEME, diff));

  const setupWizard = new SetupWizard(context.extensionUri, output);

  const panel = new ChatPanel(context.extensionUri, ws, { output });
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(ChatPanel.viewId, panel));
  context.subscriptions.push({ dispose: () => panel.dispose() });

  registerCommands(context, { output, setupWizard, panel });

  const configPath = join(ws, 'remote-claude.yml');
  if (!existsSync(configPath)) {
    // Defer slightly so the activation hot path doesn't block on opening a tab.
    setTimeout(() => setupWizard.show(), 100);
  } else {
    // Start the bidirectional sync session in the background. Failure is
    // surfaced in the panel UI (e.g., "Mutagen not installed" message).
    panel.startMutagen().catch((e) => output.appendLine(`mutagen start failed: ${(e as Error).message}`));
  }
}

export function deactivate(): void {}
