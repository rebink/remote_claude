import * as vscode from 'vscode';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { parse as parseYaml } from 'yaml';
import {
  openSessionTerminal,
  findExistingSessionTerminal,
  type SessionTarget,
} from '../session/sessionTerminal.ts';
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
 * Sidebar panel for the terminal-based Remote Claude session.
 *
 * Phase 2 architecture: bidirectional sync is handled by Mutagen
 * (`MutagenController`). The panel just shows session controls and the
 * current sync state — no more Pull/Apply/Dismiss buttons. Files stay
 * mirrored automatically.
 */
export class ChatPanel implements vscode.WebviewViewProvider {
  static readonly viewId = 'remoteClaude.chatPanel';
  private view?: vscode.WebviewView;
  private mutagen?: MutagenController;
  private syncStatus: MutagenStatus = { kind: 'no_session' };

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly workspaceFolder: string,
    private readonly deps: ChatPanelDeps,
  ) {
    vscode.window.onDidCloseTerminal(() => this.postState());
    vscode.window.onDidOpenTerminal(() => this.postState());
  }

  /** Called from extension.activate after the panel is constructed. */
  async startMutagen(): Promise<void> {
    const cfg = this.loadConfig();
    if (!cfg) return;
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
        localPath: this.workspaceFolder,
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
    if (this.mutagen) await this.mutagen.terminate();
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
        case 'flushSync':       return this.mutagen?.flush();
        case 'pauseSync':       this.mutagen?.pause(); return;
        case 'resumeSync':      this.mutagen?.resume(); return;
        case 'restartSync':     return this.startMutagen();
        case 'viewOutput':      return this.deps.output.show();
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
        }
      : { configured: false, sessionRunning: false, sync };
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
