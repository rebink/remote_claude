import * as vscode from 'vscode';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type MutagenStatus =
  | { kind: 'not_installed' }
  | { kind: 'connecting' }
  | { kind: 'watching' }
  | { kind: 'syncing'; transferring?: number }
  | { kind: 'conflict'; files: string[] }
  | { kind: 'paused' }
  | { kind: 'error'; message: string }
  | { kind: 'no_session' };

export interface MutagenTarget {
  project: string;
  host: string;
  user: string;
  sshPort?: number;
  localPath: string;
  remotePath: string;
  ignore?: string[]; // project sync.exclude, merged with IGNORE_PATTERNS baseline
}

const IGNORE_PATTERNS = [
  // Common build / dependency directories
  'node_modules',
  '.next',
  'dist',
  'build',
  '.dart_tool',
  'ios/Pods',
  // Lock files we don't care about syncing live
  '.DS_Store',
  // Our own scratch
  '.patchwire',
  '.devbridge',
];

/** Merge the safety baseline with the project's excludes, deduped, order-stable. */
export function mergeIgnores(baseline: string[], exclude: string[]): string[] {
  return Array.from(new Set([...baseline, ...exclude]));
}

const POLL_INTERVAL_MS = 2000;

/**
 * Wraps the `mutagen` CLI for a bidirectional sync session between the laptop
 * and the Mac Mini. Replaces the old rsync-based one-way SyncController.
 *
 * Lifecycle:
 *   ensureInstalled() → ensureSession() → status events → terminate()
 *
 * On conflict, "alpha wins" — our --mode is `two-way-resolved` and the laptop
 * is alpha. The Mini's losing version is preserved with a `.conflict-N`
 * suffix in the same directory so nothing is permanently lost.
 */
export class MutagenController {
  private statusEmitter = new vscode.EventEmitter<MutagenStatus>();
  readonly onStatusChange = this.statusEmitter.event;
  private last: MutagenStatus = { kind: 'no_session' };
  private timer?: NodeJS.Timeout;
  private terminated = false;

  constructor(
    private readonly target: MutagenTarget,
    private readonly output: vscode.OutputChannel,
  ) {}

  /**
   * Stable session name. Mutagen names must match `[a-z0-9](-?[a-z0-9])*` —
   * lowercase alphanumeric with single dashes. No underscores, dots,
   * uppercase, or consecutive dashes allowed.
   */
  private get sessionName(): string {
    const raw = `rc-${this.target.project}-${this.target.host}`.toLowerCase();
    return raw
      .replace(/[^a-z0-9-]/g, '-')   // anything else → dash
      .replace(/-+/g, '-')           // collapse consecutive dashes
      .replace(/^-+|-+$/g, '');      // trim leading/trailing dashes
  }

  /**
   * Ensure ~/.ssh/config has a Host stanza for our target so SSH (and any
   * tool that shells out to ssh, including mutagen's daemon) uses our
   * per-project key automatically. This is more robust than MUTAGEN_SSH_PATH
   * which only affects the CLI, not the long-running mutagen daemon.
   *
   * The stanza is delimited by markers so we can update it idempotently
   * without disturbing the user's other SSH config.
   */
  private ensureSshConfigStanza(): void {
    const sshDir = join(homedir(), '.ssh');
    const cfgPath = join(sshDir, 'config');
    mkdirSync(sshDir, { recursive: true });
    chmodSync(sshDir, 0o700);
    const keyPath = join(homedir(), '.patchwire', 'keys', `${this.target.host}-${this.target.user}`);
    if (!existsSync(keyPath)) return;

    const marker = `# === Patchwire managed: ${this.target.host} ===`;
    const endMarker = `# === Patchwire managed: ${this.target.host} end ===`;
    const block = [
      marker,
      `Host ${this.target.host}`,
      `  HostName ${this.target.host}`,
      `  User ${this.target.user}`,
      `  IdentityFile ${keyPath}`,
      `  IdentitiesOnly yes`,
      // Offer ONLY our per-project key: keep ssh-agent keys out so they can't be
      // tried first and trip the remote's MaxAuthTries ("Too many authentication
      // failures") before our key is reached.
      `  IdentityAgent none`,
      `  StrictHostKeyChecking accept-new`,
      ...(this.target.sshPort && this.target.sshPort !== 22 ? [`  Port ${this.target.sshPort}`] : []),
      endMarker,
      '',
    ].join('\n');

    let existing = '';
    try { existing = readFileSync(cfgPath, 'utf8'); } catch { /* not present yet */ }

    const stanzaRe = new RegExp(
      `\\n*${escapeRegex(marker)}[\\s\\S]*?${escapeRegex(endMarker)}\\n?`,
      'g',
    );
    const cleaned = existing.replace(stanzaRe, '');
    // PREPEND the managed block. ssh applies the first matching value for each
    // option and offers IdentityFile keys in file order, so putting our stanza
    // first guarantees our key is tried before any keys a broad `Host *` block
    // would otherwise offer.
    const next = `${block}\n${cleaned.replace(/^\n+/, '')}`;
    writeFileSync(cfgPath, next, 'utf8');
    chmodSync(cfgPath, 0o600);
  }

  /** True if `mutagen` is on PATH. */
  static isInstalled(): boolean {
    const r = spawnSync('mutagen', ['version'], { encoding: 'utf8', timeout: 5000 });
    return r.status === 0;
  }

  /** True if a session with our name currently exists in the mutagen daemon. */
  private sessionExists(): boolean {
    // `mutagen sync list <name>` returns the matching session if found, or
    // exits non-zero with "did not match any sessions" if not. Template uses
    // `range` because list returns an array even when filtered to one name.
    const r = spawnSync('mutagen', ['sync', 'list', this.sessionName, '--template', '{{ range . }}{{ .Name }}{{ end }}'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    return r.status === 0 && r.stdout.trim() === this.sessionName;
  }

  /** Create the bidirectional sync session if it doesn't exist yet. */
  async ensureSession(): Promise<{ ok: true } | { ok: false; error: string }> {
    if (!MutagenController.isInstalled()) {
      this.emit({ kind: 'not_installed' });
      return { ok: false, error: 'mutagen not installed' };
    }

    if (this.sessionExists()) {
      // Check the existing session's status. If it's healthy (watching/syncing)
      // reattach. If it's in an error state (failed SSH, bad config, etc.)
      // terminate + recreate so we don't perpetuate the bad state.
      const r = spawnSync('mutagen', ['sync', 'list', this.sessionName, '--template', '{{ range . }}{{ .Status }}{{ end }}'], {
        encoding: 'utf8',
        timeout: 10000,
        env: this.mutagenEnv(),
      });
      const status = (r.stdout || '').trim().toLowerCase();
      const healthy = status.includes('watching') || status.includes('ready') || status.includes('scanning') || status.includes('staging') || status.includes('reconcil');
      if (healthy) {
        this.output.appendLine(`[mutagen] reattaching to existing session "${this.sessionName}" (status: ${status})`);
        this.startPolling();
        return { ok: true };
      }
      this.output.appendLine(`[mutagen] existing session is in bad state (${status}); terminating + recreating`);
      spawnSync('mutagen', ['sync', 'terminate', this.sessionName], { encoding: 'utf8', timeout: 10000, env: this.mutagenEnv() });
    }

    this.emit({ kind: 'connecting' });

    this.ensureSshConfigStanza();
    const beta = `${this.target.user}@${this.target.host}:${this.target.remotePath}`;
    const args = [
      'sync', 'create',
      '--name', this.sessionName,
      '--mode', 'two-way-resolved',          // alpha (laptop) wins conflicts
      '--symlink-mode', 'posix-raw',         // preserve symlinks as-is
      '--ignore-vcs',                        // skip .git/, .hg/, etc.
      ...mergeIgnores(IGNORE_PATTERNS, this.target.ignore ?? []).flatMap((p) => ['--ignore', p]),
      '--default-file-mode', '0644',
      '--default-directory-mode', '0755',
      this.target.localPath,
      beta,
    ];
    // No env override needed — ensureSshConfigStanza() above wrote a Host
    // stanza into ~/.ssh/config so plain `ssh admin@host` finds our key.
    // Works for the mutagen daemon too (which can't see CLI-process env vars).
    const env = { ...process.env };

    this.output.appendLine(`[mutagen] creating session "${this.sessionName}" → ${beta}`);
    const r = spawnSync('mutagen', args, { encoding: 'utf8', timeout: 60000, env });
    if (r.status !== 0) {
      const err = (r.stderr || r.stdout || `exit ${r.status}`).trim();
      this.output.appendLine(`[mutagen] create failed: ${err}`);
      this.emit({ kind: 'error', message: err });
      return { ok: false, error: err };
    }
    this.output.appendLine(`[mutagen] session created`);
    this.startPolling();
    return { ok: true };
  }

  /** Force an immediate sync flush. Returns when the flush completes. */
  /** Env for every mutagen invocation. SSH config stanza is set up at session create time. */
  private mutagenEnv(): NodeJS.ProcessEnv {
    return process.env;
  }

  async flush(): Promise<void> {
    spawnSync('mutagen', ['sync', 'flush', this.sessionName], { encoding: 'utf8', timeout: 60000, env: this.mutagenEnv() });
    this.poll();
  }

  pause(): void {
    spawnSync('mutagen', ['sync', 'pause', this.sessionName], { encoding: 'utf8', timeout: 10000, env: this.mutagenEnv() });
    this.poll();
  }

  resume(): void {
    spawnSync('mutagen', ['sync', 'resume', this.sessionName], { encoding: 'utf8', timeout: 10000, env: this.mutagenEnv() });
    this.poll();
  }

  /** Terminate the session and stop polling. Called on extension deactivation. */
  async terminate(): Promise<void> {
    this.terminated = true;
    if (this.timer) clearInterval(this.timer);
    spawnSync('mutagen', ['sync', 'terminate', this.sessionName], { encoding: 'utf8', timeout: 10000, env: this.mutagenEnv() });
    this.statusEmitter.dispose();
  }

  /** Current cached status (last poll). */
  status(): MutagenStatus {
    return this.last;
  }

  private startPolling(): void {
    if (this.timer) return;
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  /**
   * Parse `mutagen sync list <name>` long output and derive a MutagenStatus.
   * We use a template that captures the fields we care about so parsing is
   * stable across mutagen versions.
   */
  private poll(): void {
    if (this.terminated) return;
    // Template: status word + paused flag + conflict count. Wrapped in `range`
    // because `mutagen sync list` returns an array (even for a single session).
    const tpl = `{{ range . }}{{ .Status }}|{{ .Paused }}|{{ len .Conflicts }}{{ end }}`;
    const r = spawnSync('mutagen', ['sync', 'list', this.sessionName, '--template', tpl], {
      encoding: 'utf8',
      timeout: 10000,
    });
    if (r.status !== 0) {
      // Session might have been terminated externally; report no_session
      this.emit({ kind: 'no_session' });
      return;
    }
    const out = r.stdout.trim();
    const parts = out.split('|');
    const statusWord = parts[0] ?? '';
    const paused = (parts[1] ?? '').toLowerCase() === 'true';
    const conflictCount = Number(parts[2] ?? '0');

    if (paused) {
      this.emit({ kind: 'paused' });
      return;
    }
    if (conflictCount > 0) {
      // Get conflict file paths via a more specific template
      const cr = spawnSync(
        'mutagen',
        ['sync', 'list', this.sessionName, '--long'],
        { encoding: 'utf8', timeout: 10000, env: this.mutagenEnv() },
      );
      const files = extractConflictPaths(cr.stdout || '');
      this.emit({ kind: 'conflict', files: files.slice(0, 10) });
      return;
    }
    // Status word values seen: "Watching", "Scanning", "Staging files...", "Connecting",
    // "Waiting for rescan", "Reconciling", "Ready"
    const s = statusWord.toLowerCase();
    if (s.includes('watching') || s.includes('ready') || s === '') {
      this.emit({ kind: 'watching' });
    } else if (s.includes('connect')) {
      this.emit({ kind: 'connecting' });
    } else {
      // Anything else (scanning, staging, reconciling) → syncing
      this.emit({ kind: 'syncing' });
    }
  }

  private emit(s: MutagenStatus): void {
    // Coalesce identical consecutive statuses
    if (statusEq(s, this.last)) return;
    this.last = s;
    this.statusEmitter.fire(s);
  }
}

function statusEq(a: MutagenStatus, b: MutagenStatus): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'conflict' && b.kind === 'conflict') {
    return a.files.join('') === b.files.join('');
  }
  if (a.kind === 'error' && b.kind === 'error') {
    return a.message === b.message;
  }
  return true;
}

/**
 * Pull conflicting file paths out of `mutagen sync list --long` output.
 * The long output includes a Conflicts section listing them; we grep for
 * lines that look like file paths. Best-effort — if mutagen's output
 * format drifts, we just return an empty list and the UI shows count only.
 */
function extractConflictPaths(longOut: string): string[] {
  const lines = longOut.split('\n');
  const out: string[] = [];
  let inConflicts = false;
  for (const line of lines) {
    if (/^Conflicts:/i.test(line.trim())) {
      inConflicts = true;
      continue;
    }
    if (inConflicts) {
      if (!line.trim()) {
        inConflicts = false;
        continue;
      }
      const m = line.match(/(?:α|β)\s*\(([^)]+)\)/) || line.match(/^\s*[α|β]?\s*"?([^"\s][^"\n]+)"?\s*$/);
      if (m && m[1]) out.push(m[1]);
    }
  }
  return out;
}
