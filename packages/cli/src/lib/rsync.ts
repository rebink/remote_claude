import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from './config.ts';
import { log } from './log.ts';

export interface SyncResult {
  durationMs: number;
  filesChanged: number;
  bytesSent?: number;
}

export interface RsyncProgress {
  transferred: number;
  total: number;
}

export async function rsyncPush(
  cfg: Config,
  cwd: string,
  onProgress?: (p: RsyncProgress) => void,
): Promise<SyncResult> {
  const tempDir = await mkdtemp(join(tmpdir(), 'devbridge-'));
  const excludeFile = join(tempDir, 'exclude.txt');
  try {
    const excludes = ['.git/', '.devbridge/', ...cfg.sync.exclude];
    await writeFile(excludeFile, excludes.join('\n') + '\n', 'utf8');

    const remoteTarget = `${cfg.remote.user}@${cfg.remote.host}:${cfg.remote.path}/`;
    // Use the per-project SSH key if it exists (matches the bootstrap flow). Without -i,
    // ssh tries default keys (~/.ssh/id_*) which our setup never installs on the Mini.
    const keyPath = join(homedir(), '.patchwire', 'keys', `${cfg.remote.host}-${cfg.remote.user}`);
    const sshParts: string[] = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=accept-new'];
    if (existsSync(keyPath)) sshParts.push('-i', keyPath);
    if (cfg.remote.sshPort) sshParts.push('-p', String(cfg.remote.sshPort));
    const sshArg = sshParts.join(' ');

    // --update: skip destination files whose mtime is NEWER than the source.
    // Without this, live-sync would clobber edits Claude makes on the Mini —
    // the laptop's stale local file would overwrite the Mini's fresh one.
    //
    // --delete intentionally OMITTED: it would remove files that exist on
    // the Mini but not on the laptop, which includes any new files Claude
    // created during a session. The trade-off is that file deletions on the
    // laptop no longer propagate automatically — user must clean up via
    // SSH or via the Claude session. Phase 2: track per-file send history
    // so we only delete what we previously sent.
    const args = [
      '-az',
      '--update',
      '--exclude-from', excludeFile,
      '-e', sshArg,
      `${cwd.replace(/\/?$/, '/')}`,
      remoteTarget,
    ];

    log.debug(`rsync ${args.join(' ')}`);
    const start = Date.now();
    await runCommand('rsync', args);
    const durationMs = Date.now() - start;
    // Best-effort single progress event when no streaming parser is wired.
    // Real callers receive zero ticks here; the extension relies on the
    // sync_start / sync_done bookends emitted by runSync.
    onProgress?.({ transferred: 1, total: 1 });
    return { durationMs, filesChanged: 0 };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
  });
}
