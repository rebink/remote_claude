import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import type { SetupWizard } from './setup/SetupWizard.ts';
import type { ChatPanel } from './chat/ChatPanel.ts';
import { attachFile, type AttachDeps } from './attach/attachFile.ts';
import { resolveCli } from './cli/resolveCli.ts';
import { findExistingSessionTerminal } from './session/sessionTerminal.ts';

export interface ExtensionDeps {
  output: vscode.OutputChannel;
  setupWizard: SetupWizard;
  panel: ChatPanel;
}

/**
 * Build the real, vscode-backed `AttachDeps` for `attachFile`.
 *
 * Note on `flushSync`: there is no `patchwire.flushSync` command — the flush
 * lives on the live Mutagen session the ChatPanel owns, so we call
 * `panel.flush()` (which awaits `this.mutagen?.flush()`) directly.
 */
function makeAttachDeps(
  context: vscode.ExtensionContext,
  panel: ChatPanel,
  cwd: string,
  project: string,
): AttachDeps {
  const inv = resolveCli(context.extensionUri.fsPath);
  return {
    runCliJson: (args) =>
      new Promise((resolve, reject) => {
        let settled = false;
        const child = spawn(inv.command, [...inv.baseArgs, ...args], { cwd, env: inv.env });
        let out = '';
        let err = '';
        child.stdout.on('data', (b) => (out += b.toString()));
        child.stderr.on('data', (b) => (err += b.toString()));
        child.on('error', (e) => {
          settled = true;
          reject(e);
        });
        child.on('close', (code) => {
          if (settled) return;
          if (code !== 0) {
            reject(new Error(err.trim() || `patchwire push exited ${code ?? 'null'}`));
            return;
          }
          const lastLine = out.trim().split('\n').filter(Boolean).pop() ?? '';
          try {
            resolve(JSON.parse(lastLine) as { remotePath: string });
          } catch {
            reject(new Error(`Unexpected CLI output: ${out.trim()}`));
          }
        });
      }),
    flushSync: () => panel.flush(),
    sendToTerminal: (text) => {
      const term = findExistingSessionTerminal(project) ?? vscode.window.activeTerminal;
      if (!term) return false;
      term.show();
      term.sendText(text, false);
      return true;
    },
    copyToClipboard: (text) => Promise.resolve(vscode.env.clipboard.writeText(text)),
    notify: (m) => vscode.window.showInformationMessage(m),
  };
}

export function registerCommands(context: vscode.ExtensionContext, deps: ExtensionDeps): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('patchwire.viewOutput', () => deps.output.show()),
    vscode.commands.registerCommand('patchwire.openSetup', () => {
      if (!vscode.workspace.workspaceFolders?.[0]) {
        vscode.window.showErrorMessage('Patchwire: open a workspace folder first, then run Setup.');
        return;
      }
      deps.setupWizard.show();
    }),
    // Kept for any user keybindings that still reference these — both now
    // just refresh the panel since live-sync is automatic via Mutagen.
    vscode.commands.registerCommand('patchwire.toggleLiveSync', () => deps.panel.refresh()),
    vscode.commands.registerCommand('patchwire.newChat', () => deps.panel.refresh()),
    vscode.commands.registerCommand('patchwire.attachFile', async () => {
      const ws = vscode.workspace.workspaceFolders?.[0];
      if (!ws) {
        vscode.window.showErrorMessage('Patchwire: open a workspace folder first.');
        return;
      }
      const project = deps.panel.getProject();
      if (!project) {
        vscode.window.showErrorMessage('No patchwire.yml found — run Patchwire: Setup first.');
        return;
      }
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Attach to claude',
      });
      if (!picked?.[0]) return;
      await attachFile(picked[0].fsPath, makeAttachDeps(context, deps.panel, ws.uri.fsPath, project));
    }),
    vscode.commands.registerCommand('patchwire.attachClipboardImage', async () => {
      const ws = vscode.workspace.workspaceFolders?.[0];
      if (!ws) {
        vscode.window.showErrorMessage('Patchwire: open a workspace folder first.');
        return;
      }
      const project = deps.panel.getProject();
      if (!project) {
        vscode.window.showErrorMessage('No patchwire.yml found — run Patchwire: Setup first.');
        return;
      }
      await attachFile(null, makeAttachDeps(context, deps.panel, ws.uri.fsPath, project), { clip: true });
    }),
  );
}
