import * as vscode from 'vscode';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { DiffContentProvider, SCHEME } from './diff/DiffContentProvider.ts';
import { ChatPanel } from './chat/ChatPanel.ts';
import { registerCommands } from './commands.ts';
import { SetupWizard } from './setup/SetupWizard.ts';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Patchwire');
  context.subscriptions.push(output);
  output.appendLine('Patchwire activated.');

  const diff = new DiffContentProvider();
  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(SCHEME, diff));

  const setupWizard = new SetupWizard(context.extensionUri, output);

  const currentWs = (): string | undefined => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

  const panel = new ChatPanel(context.extensionUri, currentWs(), { output });
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(ChatPanel.viewId, panel));
  context.subscriptions.push({ dispose: () => panel.dispose() });

  // Register commands unconditionally so they always exist. Previously activate
  // returned early when no folder was open, leaving every command unregistered
  // ("command 'patchwire.openSetup' not found"), and it never recovered when a
  // folder was opened later. The commands that need a folder guard for it.
  registerCommands(context, { output, setupWizard, panel });

  // Workspace-dependent startup. Re-run when the user opens or switches a folder,
  // so a session can start even if VS Code launched with no folder open.
  const initWorkspace = (): void => {
    const ws = currentWs();
    panel.setWorkspaceFolder(ws);
    if (!ws) {
      output.appendLine('No workspace folder open — Patchwire is idle until you open one.');
      return;
    }
    if (!existsSync(join(ws, 'patchwire.yml'))) {
      // Defer slightly so the activation hot path doesn't block on opening a tab.
      setTimeout(() => setupWizard.show(), 100);
    } else {
      panel.startMutagen().catch((e) => output.appendLine(`mutagen start failed: ${(e as Error).message}`));
    }
  };
  initWorkspace();
  context.subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(() => initWorkspace()));
}

export function deactivate(): void {}
