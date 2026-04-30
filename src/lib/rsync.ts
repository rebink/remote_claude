import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Config } from './config.ts';
import { log } from './log.ts';

export interface SyncResult {
  durationMs: number;
  bytesSent?: number;
}

export async function rsyncPush(cfg: Config, cwd: string): Promise<SyncResult> {
  const tempDir = await mkdtemp(join(tmpdir(), 'devbridge-'));
  const excludeFile = join(tempDir, 'exclude.txt');
  try {
    const excludes = ['.git/', '.devbridge/', ...cfg.sync.exclude];
    await writeFile(excludeFile, excludes.join('\n') + '\n', 'utf8');

    const remoteTarget = `${cfg.remote.user}@${cfg.remote.host}:${cfg.remote.path}/`;
    const sshArg = cfg.remote.sshPort ? `ssh -p ${cfg.remote.sshPort}` : 'ssh';

    const args = [
      '-az',
      '--delete',
      '--exclude-from', excludeFile,
      '-e', sshArg,
      `${cwd.replace(/\/?$/, '/')}`,
      remoteTarget,
    ];

    log.debug(`rsync ${args.join(' ')}`);
    const start = Date.now();
    await runCommand('rsync', args);
    return { durationMs: Date.now() - start };
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
