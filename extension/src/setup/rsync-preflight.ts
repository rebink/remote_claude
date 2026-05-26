import * as vscode from 'vscode';
import { spawn, spawnSync } from 'node:child_process';

const MIN_RSYNC = { major: 3, minor: 1, patch: 0 };

export interface RsyncVersion {
  major: number;
  minor: number;
  patch: number;
}

export function parseRsyncVersion(stdout: string): RsyncVersion | null {
  const m = stdout.match(/rsync\s+version\s+(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: m[3] ? Number(m[3]) : 0 };
}

export function isSupported(v: RsyncVersion): boolean {
  if (v.major !== MIN_RSYNC.major) return v.major > MIN_RSYNC.major;
  if (v.minor !== MIN_RSYNC.minor) return v.minor > MIN_RSYNC.minor;
  return v.patch >= MIN_RSYNC.patch;
}

export type RsyncStatus =
  | { state: 'ok'; version: RsyncVersion }
  | { state: 'missing' }
  | { state: 'too_old'; version: RsyncVersion }
  | { state: 'openrsync' }; // Apple's BSD reimplementation — wire-compatible but rejects --info=

/** True if `--version` output is openrsync (Apple's reimplementation) rather than GNU rsync. */
export function isOpenrsync(stdout: string): boolean {
  return /openrsync/i.test(stdout);
}

export function checkRsync(): RsyncStatus {
  const probe = spawnSync('rsync', ['--version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) return { state: 'missing' };
  // openrsync masquerades as `rsync` on $PATH but doesn't support --info= flags.
  if (isOpenrsync(probe.stdout)) return { state: 'openrsync' };
  const v = parseRsyncVersion(probe.stdout);
  if (!v) return { state: 'missing' };
  return isSupported(v) ? { state: 'ok', version: v } : { state: 'too_old', version: v };
}

export function checkBrew(): { installed: boolean; path?: string } {
  const probe = spawnSync('which', ['brew'], { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout.trim()) {
    return { installed: true, path: probe.stdout.trim() };
  }
  return { installed: false };
}

/**
 * Run `brew install rsync` and stream output to the OutputChannel. Resolves
 * with the exit code; never rejects.
 */
export function installRsyncViaBrew(
  output: vscode.OutputChannel,
  onLine?: (line: string) => void,
): Promise<{ ok: boolean; stderr: string }> {
  return new Promise((resolve) => {
    output.appendLine('[rsync-preflight] running: brew install rsync');
    const child = spawn('brew', ['install', 'rsync'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let lineBuf = '';
    const handleChunk = (c: Buffer): void => {
      const text = c.toString();
      output.append(text);
      lineBuf += text;
      let nl: number;
      while ((nl = lineBuf.indexOf('\n')) !== -1) {
        const line = lineBuf.slice(0, nl).trim();
        lineBuf = lineBuf.slice(nl + 1);
        if (line) onLine?.(line);
      }
    };
    child.stdout.on('data', handleChunk);
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
      handleChunk(c);
    });
    child.on('error', (err) => {
      output.appendLine(`[rsync-preflight] spawn error: ${err.message}`);
      resolve({ ok: false, stderr: `spawn error: ${err.message}` });
    });
    child.on('close', (code) => resolve({ ok: code === 0, stderr }));
  });
}

export type EnsureRsyncResult =
  | { ok: true }
  | { ok: false; reason: 'cancelled' | 'brew_missing' | 'install_failed' | 'still_too_old' | 'openrsync_conflict'; detail?: string };

/**
 * Verify rsync >= 3.1 is present. If missing/old, prompt the user via a modal,
 * optionally run `brew install rsync`, and re-check. Returns when it's safe to
 * proceed (or with a typed failure to surface to the user).
 */
export async function ensureRsync(
  output: vscode.OutputChannel,
  onProgress?: (line: string) => void,
): Promise<EnsureRsyncResult> {
  const initial = checkRsync();
  if (initial.state === 'ok') return { ok: true };

  // openrsync (Apple's BSD reimplementation) masquerades as `rsync` on PATH but
  // rejects --info= flags. brew install rsync won't help if openrsync owns the
  // symlink — user must remove it explicitly.
  if (initial.state === 'openrsync') {
    await vscode.window.showErrorMessage(
      'The `rsync` on your PATH is `openrsync` (Apple\'s BSD reimplementation), which is missing the `--info=` flags we need. ' +
        'Replace it with GNU rsync:\n\n' +
        '  brew uninstall openrsync 2>/dev/null\n' +
        '  brew install rsync\n' +
        '  brew link --overwrite rsync\n' +
        '  rsync --version  # must say "rsync version 3.x.x"\n\n' +
        'Then quit VS Code and relaunch from a terminal so it picks up the new PATH.',
      { modal: true },
      'OK',
    );
    return { ok: false, reason: 'openrsync_conflict' };
  }

  const brew = checkBrew();
  const foundVersion = initial.state === 'too_old'
    ? `${initial.version.major}.${initial.version.minor}.${initial.version.patch}`
    : 'not installed';

  if (!brew.installed) {
    await vscode.window.showErrorMessage(
      `rsync ${MIN_RSYNC.major}.${MIN_RSYNC.minor}+ is required (found: ${foundVersion}). ` +
        `Homebrew is not installed; install it from https://brew.sh and run \`brew install rsync\`, then retry setup.`,
      { modal: true },
      'OK',
    );
    return { ok: false, reason: 'brew_missing', detail: foundVersion };
  }

  const choice = await vscode.window.showWarningMessage(
    `rsync ${MIN_RSYNC.major}.${MIN_RSYNC.minor}+ is required for Remote Claude sync (found: ${foundVersion}).\n\nInstall it now via Homebrew? This runs: brew install rsync`,
    { modal: true },
    'Install rsync',
  );
  if (choice !== 'Install rsync') {
    return { ok: false, reason: 'cancelled' };
  }

  output.appendLine('[rsync-preflight] user accepted brew install');
  const result = await installRsyncViaBrew(output, onProgress);
  if (!result.ok) {
    return { ok: false, reason: 'install_failed', detail: result.stderr.slice(0, 500) };
  }

  const after = checkRsync();
  if (after.state === 'ok') {
    output.appendLine(`[rsync-preflight] rsync now ${after.version.major}.${after.version.minor}.${after.version.patch}; continuing`);
    return { ok: true };
  }
  if (after.state === 'openrsync') {
    return {
      ok: false,
      reason: 'openrsync_conflict',
      detail: 'brew install rsync succeeded but openrsync still owns the `rsync` symlink. Run: brew link --overwrite rsync',
    };
  }
  const detailAfter = after.state === 'too_old'
    ? `${after.version.major}.${after.version.minor}.${after.version.patch}`
    : 'still missing from PATH (brew may have installed it somewhere not on $PATH)';
  return { ok: false, reason: 'still_too_old', detail: detailAfter };
}
