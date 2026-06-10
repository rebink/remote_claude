import * as vscode from 'vscode';
import { readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { listInbox, removeAttachment, type InboxEntry, INBOX_DIR } from '../attach/inbox.ts';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import {
  openSessionTerminal,
  findExistingSessionTerminal,
  type SessionTarget,
} from '../session/sessionTerminal.ts';
import { resolveCli } from '../cli/resolveCli.ts';
import { MutagenController, type MutagenStatus } from '../sync/MutagenController.ts';

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

interface SyncUiState {
  kind: MutagenStatus['kind'];
  conflicts?: string[];
  message?: string;
}

export interface ChatPanelDeps {
  output: vscode.OutputChannel;
}

/**
 * Sidebar panel for the terminal-based Patchwire session.
 *
 * Phase 2 architecture: bidirectional sync is handled by Mutagen
 * (`MutagenController`). The panel just shows session controls and the
 * current sync state — no more Pull/Apply/Dismiss buttons. Files stay
 * mirrored automatically.
 */
export class ChatPanel implements vscode.WebviewViewProvider {
  static readonly viewId = 'patchwire.chatPanel';
  private view?: vscode.WebviewView;
  private inboxWatcher?: vscode.FileSystemWatcher;
  private mutagen?: MutagenController;
  private syncStatus: MutagenStatus = { kind: 'no_session' };

  constructor(
    private readonly extensionUri: vscode.Uri,
    private workspaceFolder: string | undefined,
    private readonly deps: ChatPanelDeps,
  ) {
    vscode.window.onDidCloseTerminal(() => this.postState());
    vscode.window.onDidOpenTerminal(() => this.postState());
  }

  /** Update the active workspace folder, e.g. when one is opened after startup. */
  setWorkspaceFolder(ws: string | undefined): void {
    if (ws === this.workspaceFolder) return;
    this.workspaceFolder = ws;
    this.setupInboxWatcher();
    this.postState();
  }

  /** Called from extension.activate, and again whenever a folder is opened. */
  async startMutagen(): Promise<void> {
    if (this.mutagen) {
      await this.mutagen.terminate();
      this.mutagen = undefined;
    }
    const ws = this.workspaceFolder;
    const cfg = this.loadConfig();
    if (!cfg || !ws) return;
    if (!MutagenController.isInstalled()) {
      this.syncStatus = { kind: 'not_installed' };
      this.postState();
      return;
    }
    this.mutagen = new MutagenController(
      {
        project: cfg.project,
        host: cfg.host,
        user: cfg.user,
        sshPort: cfg.sshPort,
        localPath: ws,
        remotePath: cfg.remotePath,
      },
      this.deps.output,
    );
    this.mutagen.onStatusChange((s) => {
      this.syncStatus = s;
      this.postState();
    });
    await this.mutagen.ensureSession();
  }

  /** Called on extension deactivation. */
  async dispose(): Promise<void> {
    this.inboxWatcher?.dispose();
    if (this.mutagen) await this.mutagen.terminate();
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };
    view.webview.html = this.renderHtml(view.webview);

    view.webview.onDidReceiveMessage((msg: { type: string; [k: string]: unknown }) =>
      this.handleMessage(msg).catch((err) =>
        this.deps.output.appendLine(`ChatPanel: message handler error: ${(err as Error).message}`),
      ),
    );

    this.setupInboxWatcher();
  }

  /** Watch the inbox for live refresh. No-op until both the view and a folder exist. */
  private setupInboxWatcher(): void {
    this.inboxWatcher?.dispose();
    this.inboxWatcher = undefined;
    if (!this.view || !this.workspaceFolder) return;
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(this.workspaceFolder, `${INBOX_DIR}/*`),
    );
    const refresh = () => this.postState();
    watcher.onDidCreate(refresh);
    watcher.onDidDelete(refresh);
    watcher.onDidChange(refresh);
    this.inboxWatcher = watcher;
  }

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
      case 'insertAttachmentPath': return this.handleInsertAttachment(String(msg.name ?? ''));
      case 'deleteAttachment':return this.handleDeleteAttachment(String(msg.name ?? ''));
      default:
        this.deps.output.appendLine(`ChatPanel: unknown message type "${msg.type}"`);
        return;
    }
  }

  private async handleViewAttachment(name: string): Promise<void> {
    if (!this.workspaceFolder || !name || name !== basename(name)) return;
    const uri = vscode.Uri.file(join(this.workspaceFolder, INBOX_DIR, name));
    await vscode.commands.executeCommand('vscode.open', uri);
  }

  /**
   * Type a staged attachment's remote path into the active Claude session
   * terminal (so the developer can reference an already-synced file again).
   * Mirrors the attach-file flow: session terminal, else the active terminal,
   * else copy the path to the clipboard.
   */
  private async handleInsertAttachment(name: string): Promise<void> {
    if (!name || name !== basename(name)) return;
    const cfg = this.loadConfig();
    if (!cfg) return;
    const remotePath = `${cfg.remotePath.replace(/\/+$/, '')}/${INBOX_DIR}/${name}`;
    const term = findExistingSessionTerminal(cfg.project) ?? vscode.window.activeTerminal;
    if (term) {
      term.show();
      term.sendText(remotePath, false); // insert without executing; the developer hits enter
      return;
    }
    await vscode.env.clipboard.writeText(remotePath);
    vscode.window.showInformationMessage(`No Claude session open. Remote path copied: ${remotePath}`);
  }

  private async handleDeleteAttachment(name: string): Promise<void> {
    const ws = this.workspaceFolder;
    if (!ws || !name || name !== basename(name)) return;
    const pick = await vscode.window.showWarningMessage(
      `Delete attachment "${name}"? This also removes it from the remote.`,
      { modal: true },
      'Delete',
    );
    if (pick !== 'Delete') return;
    try {
      removeAttachment(ws, name);
    } catch (err) {
      this.deps.output.appendLine(`Delete attachment failed: ${(err as Error).message}`);
    }
    await this.flush();      // propagate the removal to the remote
    this.postState();
  }

  refresh(): void {
    this.postState();
  }

  /**
   * Force a Mutagen sync flush so staged files reach the remote immediately.
   * Used by the attach-file command (there is no `patchwire.flushSync` command;
   * the flush lives on the live Mutagen session this panel owns).
   */
  async flush(): Promise<void> {
    await this.mutagen?.flush();
  }

  /** The configured project name from patchwire.yml, or undefined if unconfigured. */
  getProject(): string | undefined {
    return this.loadConfig()?.project;
  }

  private loadConfig(): SessionTarget | null {
    if (!this.workspaceFolder) return null;
    const yamlPath = join(this.workspaceFolder, 'patchwire.yml');
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
      this.deps.output.appendLine(`Failed to read patchwire.yml: ${(err as Error).message}`);
      return null;
    }
  }

  postState(): void {
    if (!this.view) return;
    const cfg = this.loadConfig();
    const sync: SyncUiState = toUiSync(this.syncStatus);
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
          attachments: this.workspaceFolder ? listInbox(this.workspaceFolder) : [],
        }
      : { configured: false, sessionRunning: false, sync };
    this.view.webview.postMessage({ type: 'state', state });
  }

  private handleOpenSession(): void {
    const cfg = this.loadConfig();
    if (!cfg) {
      vscode.window.showErrorMessage('No patchwire.yml found — run Patchwire: Setup first.');
      return;
    }
    // Best-effort, non-blocking: prune the local attachment inbox so old
    // attachments don't accumulate. Mutagen propagates the deletion to the
    // remote. Never block (or fail) opening the session on this.
    void this.pruneInbox().catch(() => {});
    openSessionTerminal(cfg);
    this.postState();
  }

  /**
   * Fire-and-forget prune of the local `.patchwire-inbox/`. Spawns the bundled
   * CLI `patchwire push --clean --stage-only --json` in the workspace folder.
   * Any failure is swallowed (logged if possible); it never throws and never
   * blocks the session from opening.
   */
  private pruneInbox(): Promise<void> {
    return new Promise<void>((resolve) => {
      try {
        const inv = resolveCli(this.extensionUri.fsPath);
        const child = spawn(
          inv.command,
          [...inv.baseArgs, 'push', '--clean', '--stage-only', '--json'],
          { cwd: this.workspaceFolder, env: inv.env, stdio: ['ignore', 'ignore', 'pipe'] },
        );
        let err = '';
        child.stderr.on('data', (b) => (err += b.toString()));
        child.on('error', (e) => {
          this.deps.output.appendLine(`Inbox prune failed: ${(e as Error).message}`);
          resolve();
        });
        child.on('close', (code) => {
          if (code !== 0) {
            this.deps.output.appendLine(
              `Inbox prune exited ${code ?? 'null'}: ${err.trim()}`,
            );
          }
          resolve();
        });
      } catch (e) {
        this.deps.output.appendLine(`Inbox prune failed: ${(e as Error).message}`);
        resolve();
      }
    });
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

function toUiSync(s: MutagenStatus): SyncUiState {
  if (s.kind === 'conflict') return { kind: s.kind, conflicts: s.files };
  if (s.kind === 'error') return { kind: s.kind, message: s.message };
  return { kind: s.kind };
}
