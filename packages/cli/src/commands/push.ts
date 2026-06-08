import { existsSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { loadConfig, type Config } from '../lib/config.ts';
import { stageAttachment, remoteAttachmentPath, pruneInbox, INBOX_DIR } from '../lib/attachments.ts';
import { runSsh } from '../lib/ssh-runner.ts';
import { log } from '../lib/log.ts';

export interface PushPlan {
  remotePath: string;
  sshArg: string;
  mkdirTarget: string;
  rsyncArgs: string[];
}

/** Pure: build the remote path + ssh/rsync argv for a single staged file. */
export function buildPushPlan(cfg: Config, relPath: string, keyPath: string): PushPlan {
  const remotePath = remoteAttachmentPath(cfg.remote.path, relPath);
  const mkdirTarget = remoteAttachmentPath(cfg.remote.path, INBOX_DIR);
  const sshParts = ['ssh', '-i', keyPath];
  if (cfg.remote.sshPort) sshParts.push('-p', String(cfg.remote.sshPort));
  const sshArg = sshParts.join(' ');
  const localStaged = relPath; // resolved against cwd by the caller
  const rsyncArgs = [
    '-az', '-e', sshArg, localStaged,
    `${cfg.remote.user}@${cfg.remote.host}:${remoteAttachmentPath(cfg.remote.path, INBOX_DIR)}/`,
  ];
  return { remotePath, sshArg, mkdirTarget, rsyncArgs };
}

export interface PushOpts { stageOnly?: boolean; json?: boolean; clip?: boolean; clean?: boolean }

function clipboardImageToTemp(): string {
  const out = join(tmpdir(), `pw-clip-${process.pid}.png`);
  // Prefer pngpaste; fall back to osascript clipboard export.
  if (spawnSync('pngpaste', [out]).status === 0 && existsSync(out)) return out;
  const script = `set p to (POSIX file "${out}")
set d to the clipboard as «class PNGf»
set f to open for access p with write permission
write d to f
close access f`;
  const r = spawnSync('osascript', ['-e', script]);
  if (r.status !== 0 || !existsSync(out)) throw new Error('No image in the clipboard (need a copied screenshot).');
  return out;
}

export async function runPush(cwd: string, files: string[], opts: PushOpts = {}): Promise<void> {
  const cfg = await loadConfig(cwd);

  if (opts.clean) {
    pruneInbox(cwd);
    if (!opts.stageOnly) {
      const keyPath = join(homedir(), '.patchwire', 'keys', `${cfg.remote.host}-${cfg.remote.user}`);
      await runSsh({ host: cfg.remote.host, user: cfg.remote.user, port: cfg.remote.sshPort ?? 22, keyPath,
        command: `rm -rf ${remoteAttachmentPath(cfg.remote.path, INBOX_DIR)}` });
    }
    if (!opts.json) log.ok('Cleared attachments inbox.');
    return;
  }

  const sources = opts.clip ? [clipboardImageToTemp()] : files;
  if (sources.length === 0) { log.err('No file to push. Pass a path or --clip.'); process.exitCode = 1; return; }

  const keyPath = join(homedir(), '.patchwire', 'keys', `${cfg.remote.host}-${cfg.remote.user}`);
  const results: string[] = [];
  for (const src of sources) {
    const rel = stageAttachment(resolve(cwd, src), cwd);
    const plan = buildPushPlan(cfg, rel, keyPath);
    if (!opts.stageOnly) {
      await runSsh({ host: cfg.remote.host, user: cfg.remote.user, port: cfg.remote.sshPort ?? 22, keyPath,
        command: `mkdir -p ${plan.mkdirTarget}` });
      await new Promise<void>((res, rej) => {
        const child = spawn('rsync', [plan.rsyncArgs[0]!, ...plan.rsyncArgs.slice(1, -2), join(cwd, rel), plan.rsyncArgs[plan.rsyncArgs.length - 1]!], { stdio: 'inherit' });
        child.on('error', rej);
        child.on('close', (c) => (c === 0 ? res() : rej(new Error(`rsync exited ${c}`))));
      });
    }
    results.push(plan.remotePath);
  }

  if (opts.json) { process.stdout.write(JSON.stringify({ remotePath: results[0], remotePaths: results }) + '\n'); return; }
  for (const r of results) log.ok(`Attachment ready on remote: ${r}`);
  log.dim('Paste that path into your claude session.');
}
