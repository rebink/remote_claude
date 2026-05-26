import * as vscode from 'vscode';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import {
  openSessionTerminal,
  findExistingSessionTerminal,
  type SessionTarget,
} from '../session/sessionTerminal.ts';
import { pullRemoteDiff, type ChangedFile } from '../session/pullChanges.ts';
import { applyPatch } from '../diff/applyPatch.ts';
import { filterPatchByPaths } from '../diff/filterPatch.ts';

interface SessionState {
  configured: boolean;
  project?: string;
  host?: string;
  user?: string;
  sshPort?: number;
  remotePath?: string;
  sessionRunning: boolean;
  pulling: boolean;
  applying: boolean;
  pendingFiles: ChangedFile[];
  lastError?: string;
}

export interface ChatPanelDeps {
  output: vscode.OutputChannel;
}

/**
 * Sidebar panel for the terminal-based Remote Claude session. Replaces the
 * previous chat-bubble UI. Surfaces two primary actions:
 *   1. Open Claude session — spawns a VS Code terminal SSH'd to the Mac Mini
 *      in the synced project dir, running the real `claude` REPL.
 *   2. Pull remote changes — fetches `git diff HEAD` from the Mini, shows
 *      changed files with checkboxes, applies selected ones to the laptop.
 * Internal name kept as ChatPanel for now to avoid touching the registration
 * id and the file decoration provider that imports the type.
 */
export class ChatPanel implements vscode.WebviewViewProvider {
  static readonly viewId = 'remoteClaude.chatPanel';
  private view?: vscode.WebviewView;
  private pendingFiles: ChangedFile[] = [];
  private pendingPatch = '';
  private pulling = false;
  private applying = false;
  private lastError?: string;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly workspaceFolder: string,
    private readonly deps: ChatPanelDeps,
  ) {
    // Refresh on terminal close/open so the "Focus session" / "Open session"
    // label tracks reality.
    vscode.window.onDidCloseTerminal(() => this.postState());
    vscode.window.onDidOpenTerminal(() => this.postState());
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };
    view.webview.html = this.renderHtml(view.webview);

    view.webview.onDidReceiveMessage(async (msg: { type: string; [k: string]: unknown }) => {
      switch (msg.type) {
        case 'ready':           return this.postState();
        case 'openSetup':       return vscode.commands.executeCommand('remoteClaude.openSetup');
        case 'openSession':     return this.handleOpenSession();
        case 'pullChanges':     return this.handlePullChanges();
        case 'openDiff':        return this.handleOpenDiff(msg.path as string);
        case 'applySelected':   return this.handleApplySelected(msg.paths as string[]);
        case 'savePatch':       return this.handleSavePatch();
        case 'dismissPending':  return this.dismissPending();
        default:
          this.deps.output.appendLine(`ChatPanel: unknown message type "${(msg as { type?: string }).type}"`);
          return;
      }
    });
  }

  refresh(): void {
    this.postState();
  }

  private loadConfig(): SessionTarget | null {
    const yamlPath = join(this.workspaceFolder, 'remote-claude.yml');
    if (!existsSync(yamlPath)) return null;
    try {
      const raw = readFileSync(yamlPath, 'utf8');
      const parsed = parseYaml(raw) as Record<string, unknown>;
      const project = parsed.project as string | undefined;
      const remote = parsed.remote as Record<string, unknown> | undefined;
      if (!project || !remote || !remote.host || !remote.user || !remote.path) return null;
      return {
        project,
        host: remote.host as string,
        user: remote.user as string,
        sshPort: remote.sshPort as number | undefined,
        remotePath: remote.path as string,
      };
    } catch (err) {
      this.deps.output.appendLine(`Failed to read remote-claude.yml: ${(err as Error).message}`);
      return null;
    }
  }

  postState(): void {
    if (!this.view) return;
    const cfg = this.loadConfig();
    const state: SessionState = cfg
      ? {
          configured: true,
          project: cfg.project,
          host: cfg.host,
          user: cfg.user,
          sshPort: cfg.sshPort,
          remotePath: cfg.remotePath,
          sessionRunning: !!findExistingSessionTerminal(cfg.project),
          pulling: this.pulling,
          applying: this.applying,
          pendingFiles: this.pendingFiles,
          lastError: this.lastError,
        }
      : {
          configured: false,
          sessionRunning: false,
          pulling: false,
          applying: false,
          pendingFiles: [],
        };
    this.view.webview.postMessage({ type: 'state', state });
  }

  private handleOpenSession(): void {
    const cfg = this.loadConfig();
    if (!cfg) {
      vscode.window.showErrorMessage('No remote-claude.yml found — run Remote Claude: Setup first.');
      return;
    }
    openSessionTerminal(cfg);
    this.postState();
  }

  private async handlePullChanges(): Promise<void> {
    const cfg = this.loadConfig();
    if (!cfg) return;
    this.pulling = true;
    this.lastError = undefined;
    this.postState();
    const r = pullRemoteDiff(cfg);
    this.pulling = false;
    if (!r.ok) {
      this.lastError = r.error;
      this.deps.output.appendLine(`[pull-changes] ${r.error}`);
      this.postState();
      return;
    }
    this.pendingFiles = r.result.files;
    this.pendingPatch = r.result.patch;
    if (!this.pendingFiles.length) {
      vscode.window.showInformationMessage('No changes on the remote.');
    } else {
      this.deps.output.appendLine(`[pull-changes] ${this.pendingFiles.length} file(s) changed`);
    }
    this.postState();
  }

  private async handleOpenDiff(filePath: string): Promise<void> {
    // Save the full patch to a temp file then open VS Code's native diff editor
    // between the local file and a synthetic "remote" version constructed by
    // applying just this file's hunks. For v1 simplicity, just open the local
    // file alongside the patch text. (Native scoped diff is a v1.1 polish.)
    const local = vscode.Uri.file(join(this.workspaceFolder, filePath));
    try {
      const doc = await vscode.workspace.openTextDocument(local);
      await vscode.window.showTextDocument(doc, { preview: true });
    } catch {
      vscode.window.showWarningMessage(`Could not open ${filePath} (file may not exist locally yet).`);
    }
  }

  private async handleApplySelected(paths: string[]): Promise<void> {
    if (!paths.length || !this.pendingPatch) return;
    this.applying = true;
    this.lastError = undefined;
    this.postState();
    const filtered = filterPatchByPaths(this.pendingPatch, paths);
    if (!filtered) {
      this.applying = false;
      this.lastError = 'No patch sections matched the selected files (the diff format may differ from `git diff --git` shape).';
      this.postState();
      return;
    }
    const result = await applyPatch(filtered, this.workspaceFolder);
    this.applying = false;
    if (result.ok) {
      vscode.window.showInformationMessage(`Applied ${paths.length} file(s).`);
      // Drop the applied files from the pending list; keep the rest so the
      // user can iterate. Patch is regenerated from remaining files.
      const appliedSet = new Set(paths);
      this.pendingFiles = this.pendingFiles.filter((f) => !appliedSet.has(f.path));
      if (this.pendingFiles.length === 0) {
        this.pendingPatch = '';
      } else {
        const remaining = this.pendingFiles.map((f) => f.path);
        this.pendingPatch = filterPatchByPaths(this.pendingPatch, remaining);
      }
    } else {
      const conflicts = result.conflicted.length ? ` (conflicts: ${result.conflicted.join(', ')})` : '';
      this.lastError = `Apply failed: ${result.stderr}${conflicts}`;
      this.deps.output.appendLine(`[apply] ${result.stderr}`);
    }
    this.postState();
  }

  private handleSavePatch(): void {
    if (!this.pendingPatch) return;
    const target = join(this.workspaceFolder, '.remote-claude', `pull-${Date.now()}.patch`);
    try {
      writeFileSync(target, this.pendingPatch, 'utf8');
      vscode.window.showInformationMessage(`Patch saved: ${target}`);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to save patch: ${(err as Error).message}`);
    }
  }

  private dismissPending(): void {
    this.pendingFiles = [];
    this.pendingPatch = '';
    this.lastError = undefined;
    this.postState();
  }

  private renderHtml(webview: vscode.Webview): string {
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'main.js'));
    const stylesUri = webview.asWebviewUri(vscode.Uri.joinPath(dist, 'styles.css'));
    const nonce = randomBytes(16).toString('base64');
    const html = readFileSync(join(this.extensionUri.fsPath, 'dist', 'webview', 'index.html'), 'utf8');
    return html
      .replace(/\$\{cspSource\}/g, webview.cspSource)
      .replace(/\$\{nonce\}/g, nonce)
      .replace(/\$\{scriptUri\}/g, scriptUri.toString())
      .replace(/\$\{stylesUri\}/g, stylesUri.toString());
  }
}
