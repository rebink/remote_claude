import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { quoteForShell, runSsh, type SshOpts } from './ssh-runner.ts';

export interface BootstrapOpts {
  host: string;
  user: string;
  port: number;
  keyPath: string;
  project: string;
  localPath: string;
  /**
   * Override the remote project path. Defaults to `~/workspace/<project>`.
   * The wizard sets this to `~/workspace/<localUser>/<project>` so multiple
   * developers sharing one SSH account on the Mini don't collide.
   */
  remotePath?: string;
  overwrite?: boolean;
  useExisting?: boolean;
}

export type BootstrapEvent =
  | { type: 'step'; name: StepName; status: 'start' }
  | { type: 'step'; name: StepName; status: 'ok'; durationMs?: number }
  | { type: 'step'; name: StepName; status: 'fail'; code: FailureCode; stderr?: string; exit?: number | null }
  | { type: 'progress'; stage: 'rsync'; files: number; bytes: number; pct: number; current?: string }
  | { type: 'done'; ok: boolean; projectName?: string; remotePath?: string };

export type StepName = 'validate' | 'key' | 'probe' | 'wipe' | 'mkdir' | 'rsync' | 'git_init' | 'safety';

export type FailureCode =
  | 'invalid_project_name'
  | 'missing_key'
  | 'target_exists'
  | 'wipe_failed'
  | 'mkdir_failed'
  | 'rsync_failed'
  | 'git_init_failed'
  | 'unsafe_state'
  | 'ssh_unreachable'
  | 'ssh_auth_failed'
  | 'ssh_error';

export interface RsyncProgress {
  type: 'progress';
  stage: 'rsync';
  files: number;
  bytes: number;
  pct: number;
  current?: string;
}

export type RsyncRunner = (args: {
  src: string;
  dest: string;
  port: number;
  keyPath: string;
}) => AsyncGenerator<RsyncProgress, { code: number | null; stderr: string }, void>;

export interface BootstrapDeps {
  runSsh: (opts: Omit<SshOpts, 'command'>, command: string) => Promise<{ code: number | null; stdout: string; stderr: string }>;
  runRsync: RsyncRunner;
  existsKey: (path: string) => boolean;
}

const REMOTE_BASE = '~/workspace';
const SANDBOX_EMAIL = 'patchwire@local';
const SANDBOX_NAME = 'Patchwire (sandbox)';

export const gitInitScript = (project: string, remotePath?: string): string => {
  const remote = remotePath ?? `${REMOTE_BASE}/${project}`;
  return [
    `cd ${remote}`,
    `git init -q`,
    `git config --local user.email ${quoteForShell(SANDBOX_EMAIL)}`,
    `git config --local user.name ${quoteForShell(SANDBOX_NAME)}`,
    `git add -A`,
    `git -c commit.gpgsign=false commit -q --allow-empty -m 'snapshot from laptop'`,
  ].join(' && ');
};

function classifySshError(stderr: string): FailureCode | null {
  if (/Connection refused|No route to host|Connection timed out|ssh: connect to host/i.test(stderr)) {
    return 'ssh_unreachable';
  }
  if (/Permission denied \(publickey\)/i.test(stderr)) return 'ssh_auth_failed';
  return null;
}

export async function* bootstrapSnapshot(
  opts: BootstrapOpts,
  deps: BootstrapDeps,
): AsyncGenerator<BootstrapEvent, void, void> {
  const sshBase = {
    host: opts.host,
    user: opts.user,
    port: opts.port,
    keyPath: opts.keyPath,
  } satisfies Omit<SshOpts, 'command'>;
  const remotePath = opts.remotePath ?? `${REMOTE_BASE}/${opts.project}`;

  // Step 0: validate project name
  yield { type: 'step', name: 'validate', status: 'start' };
  if (!/^[a-zA-Z0-9._-]+$/.test(opts.project) || /^\.+$/.test(opts.project)) {
    yield {
      type: 'step',
      name: 'validate',
      status: 'fail',
      code: 'invalid_project_name',
      stderr: `Project name must match [a-zA-Z0-9._-]+ and cannot be "." or "..": got "${opts.project}"`,
    };
    yield { type: 'done', ok: false };
    return;
  }
  yield { type: 'step', name: 'validate', status: 'ok' };

  // Step 1: key file present
  yield { type: 'step', name: 'key', status: 'start' };
  if (!deps.existsKey(opts.keyPath)) {
    yield { type: 'step', name: 'key', status: 'fail', code: 'missing_key' };
    yield { type: 'done', ok: false };
    return;
  }
  yield { type: 'step', name: 'key', status: 'ok' };

  // Step 2: probe remote dir
  yield { type: 'step', name: 'probe', status: 'start' };
  const probe = await deps.runSsh(sshBase, `test -d ${remotePath}`);
  if (probe.code === null) {
    const cls = classifySshError(probe.stderr) ?? 'ssh_error';
    yield { type: 'step', name: 'probe', status: 'fail', code: cls, stderr: probe.stderr };
    yield { type: 'done', ok: false };
    return;
  }
  const exists = probe.code === 0;
  if (exists && !opts.overwrite && !opts.useExisting) {
    yield {
      type: 'step',
      name: 'probe',
      status: 'fail',
      code: 'target_exists',
      stderr: `${remotePath} already exists on the remote`,
    };
    yield { type: 'done', ok: false };
    return;
  }
  yield { type: 'step', name: 'probe', status: 'ok' };

  // Step 3 (optional): wipe
  if (exists && opts.overwrite) {
    yield { type: 'step', name: 'wipe', status: 'start' };
    const wipe = await deps.runSsh(sshBase, `rm -rf ${remotePath}`);
    if (wipe.code !== 0) {
      yield { type: 'step', name: 'wipe', status: 'fail', code: 'wipe_failed', stderr: wipe.stderr, exit: wipe.code };
      yield { type: 'done', ok: false };
      return;
    }
    yield { type: 'step', name: 'wipe', status: 'ok' };
  }

  // Step 4 + 5: mkdir + rsync (skipped under --use-existing)
  if (!opts.useExisting) {
    yield { type: 'step', name: 'mkdir', status: 'start' };
    const mk = await deps.runSsh(sshBase, `mkdir -p ${remotePath}`);
    if (mk.code !== 0) {
      yield { type: 'step', name: 'mkdir', status: 'fail', code: 'mkdir_failed', stderr: mk.stderr, exit: mk.code };
      yield { type: 'done', ok: false };
      return;
    }
    yield { type: 'step', name: 'mkdir', status: 'ok' };

    yield { type: 'step', name: 'rsync', status: 'start' };
    const rsyncIter = deps.runRsync({
      src: opts.localPath.replace(/\/?$/, '/'),
      dest: `${opts.user}@${opts.host}:${remotePath}/`,
      port: opts.port,
      keyPath: opts.keyPath,
    });
    let rsyncResult: { code: number | null; stderr: string } = { code: 0, stderr: '' };
    while (true) {
      const next = await rsyncIter.next();
      if (next.done) {
        rsyncResult = next.value as { code: number | null; stderr: string };
        break;
      }
      yield next.value;
    }
    if (rsyncResult.code !== 0) {
      yield {
        type: 'step',
        name: 'rsync',
        status: 'fail',
        code: 'rsync_failed',
        stderr: rsyncResult.stderr,
        exit: rsyncResult.code,
      };
      yield { type: 'done', ok: false };
      return;
    }
    yield { type: 'step', name: 'rsync', status: 'ok' };
  }

  // Step 6: git init + sandbox identity + initial commit (idempotent)
  yield { type: 'step', name: 'git_init', status: 'start' };
  const gi = await deps.runSsh(sshBase, gitInitScript(opts.project, remotePath));
  if (gi.code !== 0) {
    yield {
      type: 'step',
      name: 'git_init',
      status: 'fail',
      code: 'git_init_failed',
      stderr: gi.stderr,
      exit: gi.code,
    };
    yield { type: 'done', ok: false };
    return;
  }
  yield { type: 'step', name: 'git_init', status: 'ok' };

  // Step 7: safety check
  yield { type: 'step', name: 'safety', status: 'start' };
  const safety = await deps.runSsh(sshBase, `cd ${remotePath} && git remote -v`);
  if (safety.code !== 0) {
    yield {
      type: 'step',
      name: 'safety',
      status: 'fail',
      code: 'unsafe_state',
      stderr: safety.stderr,
      exit: safety.code,
    };
    yield { type: 'done', ok: false };
    return;
  }
  if (safety.stdout.trim() !== '') {
    yield {
      type: 'step',
      name: 'safety',
      status: 'fail',
      code: 'unsafe_state',
      stderr: safety.stdout,
    };
    yield { type: 'done', ok: false };
    return;
  }
  yield { type: 'step', name: 'safety', status: 'ok' };

  yield { type: 'done', ok: true, projectName: opts.project, remotePath };
}

// ---- Default real-world adapter for runRsync, exported for the CLI wiring ----

export const defaultRsync: RsyncRunner = async function* ({ src, dest, port, keyPath }) {
  // Note: we deliberately do NOT use --info=progress2,stats1 here. That flag
  // (added in rsync 3.1) propagates --info=STATS to the remote `rsync --server`
  // invocation. macOS ships openrsync at /usr/bin/rsync which is 2.6.9-protocol
  // and rejects --info=. Without this flag we work with any rsync >= 2.6.9 on
  // either side. Trade-off: no live progress events; the orchestrator's
  // rsync:start / rsync:ok bookends are the only feedback. Live progress can
  // come back in v1.1 with smarter remote-rsync detection.
  const args = [
    '-a',
    '--delete',
    '--filter=:- .gitignore',
    // Exclude the laptop's .git/ — the Mini gets a fresh sandbox repo via
    // bootstrap-snapshot's git_init step. Copying the laptop's .git/ would
    // bring its `[remote "origin"]` config along, which the safety step
    // then refuses (and rightly so). Also exclude .patchwire/ since
    // that's laptop-side config the Mini shouldn't see.
    '--exclude=.git/',
    '--exclude=.patchwire/',
    '-e',
    `ssh -i ${quoteForShell(keyPath)} -p ${port} -o StrictHostKeyChecking=accept-new -o BatchMode=yes`,
    src,
    dest,
  ];
  const child = spawn('rsync', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  let currentFile: string | undefined;
  const events: RsyncProgress[] = [];

  child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });

  child.stdout.on('data', (c: Buffer) => {
    for (const line of c.toString().split(/\r|\n/)) {
      // Progress line: "  1,234,567  78%   12.34MB/s    0:00:23 (xfr#42, to-chk=12/345)"
      const m = line.match(/^\s*([\d,]+)\s+(\d+)%/);
      if (m) {
        const xfr = line.match(/xfr#(\d+)/);
        const filesCount = xfr ? Number(xfr[1]) : 0;
        events.push({
          type: 'progress',
          stage: 'rsync',
          bytes: Number(m[1]!.replace(/,/g, '')),
          pct: Number(m[2]!),
          files: filesCount,
          current: currentFile,
        });
        continue;
      }
      // File line: a plain relative path (no whitespace prefix, no "<" or ">").
      if (line && !line.startsWith(' ') && !line.includes('to-chk=') && /\S/.test(line)) {
        currentFile = line.trim();
      }
    }
  });

  const exitP = new Promise<{ code: number | null; stderr: string }>((resolve) => {
    child.on('error', (err) => resolve({ code: null, stderr: stderr + `\nspawn error: ${err.message}` }));
    child.on('close', (code) => resolve({ code, stderr }));
  });

  // Drain queued events while waiting for exit.
  const drain = async function* (): AsyncGenerator<RsyncProgress, void, void> {
    while (true) {
      if (events.length > 0) {
        const e = events.shift()!;
        yield e;
        continue;
      }
      const settled = await Promise.race([
        new Promise<'next'>((r) => setTimeout(() => r('next'), 100)),
        exitP.then(() => 'done' as const),
      ]);
      if (settled === 'done') break;
    }
  };
  for await (const e of drain()) yield e;
  // Flush any trailing events that landed after exit.
  while (events.length > 0) yield events.shift()!;
  return await exitP;
};

// Convenience for `runSsh` callers in this module that don't need to assemble argv themselves.
export const defaultRunSsh = (opts: SshOpts, command: string) =>
  runSsh({ ...opts, command });

