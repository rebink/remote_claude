import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { loadConfig, type Config } from '../lib/config.ts';
import { stageAttachment, remoteAttachmentPath, pruneInbox, INBOX_DIR } from '../lib/attachments.ts';
import { runSsh, quoteForShell } from '../lib/ssh-runner.ts';
import { log } from '../lib/log.ts';

export interface PushPlan {
  remotePath: string;
  sshArg: string;
  mkdirTarget: string;
  rsyncArgs: string[];
}

/** Pure: build the remote path + ssh/rsync argv for a single staged file. */
export function buildPushPlan(cfg: Config, absLocalPath: string, relPath: string, keyPath: string): PushPlan {
  const remotePath = remoteAttachmentPath(cfg.remote.path, relPath);
  const mkdirTarget = remoteAttachmentPath(cfg.remote.path, INBOX_DIR);
  const sshParts = ['ssh', '-i', keyPath];
  if (cfg.remote.sshPort) sshParts.push('-p', String(cfg.remote.sshPort));
  const sshArg = sshParts.join(' ');
  const rsyncArgs = [
    '-az', '-e', sshArg, absLocalPath,
    `${cfg.remote.user}@${cfg.remote.host}:${remoteAttachmentPath(cfg.remote.path, INBOX_DIR)}/`,
  ];
  return { remotePath, sshArg, mkdirTarget, rsyncArgs };
}

export interface PushOpts { stageOnly?: boolean; json?: boolean; clip?: boolean; clean?: boolean }

function clipboardImageToTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pw-clip-'));
  const out = join(dir, 'clip.png');
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
        command: `rm -rf ${quoteForShell(remoteAttachmentPath(cfg.remote.path, INBOX_DIR))}` });
    }
    if (!opts.json) log.ok('Cleared attachments inbox.');
    return;
  }

  const clipSource = opts.clip ? clipboardImageToTemp() : null;
  const sources = clipSource ? [clipSource] : files;
  if (sources.length === 0) { log.err('No file to push. Pass a path or --clip.'); process.exitCode = 1; return; }

  const keyPath = join(homedir(), '.patchwire', 'keys', `${cfg.remote.host}-${cfg.remote.user}`);
  const results: string[] = [];
  try {
    for (const src of sources) {
      const rel = stageAttachment(resolve(cwd, src), cwd);
      const plan = buildPushPlan(cfg, join(cwd, rel), rel, keyPath);
      if (!opts.stageOnly) {
        const m = await runSsh({ host: cfg.remote.host, user: cfg.remote.user, port: cfg.remote.sshPort ?? 22, keyPath,
          command: `mkdir -p ${quoteForShell(plan.mkdirTarget)}` });
        if (m.code !== 0) throw new Error(`failed to create remote inbox: ${m.stderr.trim()}`);
        await new Promise<void>((res, rej) => {
          const child = spawn('rsync', plan.rsyncArgs, { stdio: 'inherit' });
          child.on('error', rej);
          child.on('close', (c) => (c === 0 ? res() : rej(new Error(`rsync exited ${c}`))));
        });
      }
      results.push(plan.remotePath);
    }
  } finally {
    // The clip source lives in a one-off temp dir we created; remove it once staged/pushed.
    if (clipSource) rmSync(resolve(clipSource, '..'), { recursive: true, force: true });
  }

  if (opts.json) { process.stdout.write(JSON.stringify({ remotePath: results[0], remotePaths: results }) + '\n'); return; }
  for (const r of results) log.ok(`Attachment ready on remote: ${r}`);
  log.dim('Paste that path into your claude session.');
}
