import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  bootstrapSnapshot,
  defaultRsync,
  type BootstrapDeps,
  type BootstrapEvent,
} from '../lib/bootstrap-snapshot.ts';
import { runSsh, type SshOpts } from '../lib/ssh-runner.ts';
import * as config from '../lib/config.ts';
import { log } from '../lib/log.ts';

export interface InitRemoteOpts {
  fromLocal: true;
  project: string;
  host?: string;
  user?: string;
  sshPort?: number;
  keyPath?: string;
  localPath?: string;
  /** Override the default `~/workspace/<project>` path on the remote. */
  remotePath?: string;
  overwrite?: boolean;
  useExisting?: boolean;
  json?: boolean;
}

export type InitRemoteResult =
  | { ok: true; projectName: string; remotePath: string }
  | {
      ok: false;
      code:
        | 'invalid_project_name'
        | 'missing_config'
        | 'missing_key'
        | 'target_exists'
        | 'wipe_failed'
        | 'mkdir_failed'
        | 'rsync_failed'
        | 'git_init_failed'
        | 'unsafe_state'
        | 'ssh_unreachable'
        | 'ssh_auth_failed'
        | 'ssh_error'
        | 'unknown_error';
      stderr?: string;
    };

const PROJECT_NAME_RE = /^[a-zA-Z0-9._-]+$/;

function validateProjectName(name: string): boolean {
  if (!PROJECT_NAME_RE.test(name)) return false;
  if (/^\.+$/.test(name)) return false; // reject ".", "..", "..."
  return true;
}

function defaultDeps(): BootstrapDeps {
  return {
    existsKey: (p: string) => existsSync(p),
    runSsh: (opts: Omit<SshOpts, 'command'>, command: string) => runSsh({ ...opts, command }),
    runRsync: defaultRsync,
  };
}

export async function runInitRemote(
  opts: InitRemoteOpts,
  deps: BootstrapDeps = defaultDeps(),
): Promise<InitRemoteResult> {
  if (!validateProjectName(opts.project)) {
    return { ok: false, code: 'invalid_project_name' };
  }

  // Resolve host/user from remote-claude.yml unless overridden.
  let host = opts.host;
  let user = opts.user;
  let port = opts.sshPort ?? 22;
  if (!host || !user) {
    try {
      const cfg = await config.loadConfig(process.cwd());
      host = host ?? cfg.remote.host;
      user = user ?? cfg.remote.user;
      // re-evaluate so cfg.remote.sshPort is consulted when opts.sshPort is undefined
      port = opts.sshPort ?? cfg.remote.sshPort ?? 22;
    } catch (err) {
      return { ok: false, code: 'missing_config', stderr: (err as Error).message };
    }
  }

  const keyPath = opts.keyPath ?? join(homedir(), '.remote-claude', 'keys', `${host}-${user}`);
  const localPath = opts.localPath ?? process.cwd();

  let lastFailure: Extract<BootstrapEvent, { type: 'step'; status: 'fail' }> | undefined;
  let doneOk = false;
  let remotePath: string | undefined;

  for await (const e of bootstrapSnapshot(
    { host: host!, user: user!, port, keyPath, project: opts.project, localPath, remotePath: opts.remotePath, overwrite: opts.overwrite, useExisting: opts.useExisting },
    deps,
  )) {
    if (opts.json) {
      process.stdout.write(JSON.stringify(e) + '\n');
    } else {
      if (e.type === 'step' && e.status === 'start') log.info(`→ ${e.name}`);
      if (e.type === 'step' && e.status === 'ok') log.ok(`  ${e.name}`);
      if (e.type === 'step' && e.status === 'fail') log.err(`  ${e.name}: ${e.code}${e.stderr ? ` — ${e.stderr.slice(0, 200)}` : ''}`);
      if (e.type === 'progress') log.info(`  rsync ${e.pct}% ${e.current ?? ''}`);
    }
    if (e.type === 'step' && e.status === 'fail') lastFailure = e;
    if (e.type === 'done') {
      doneOk = e.ok;
      remotePath = e.remotePath;
    }
  }

  if (doneOk && remotePath) {
    return { ok: true, projectName: opts.project, remotePath };
  }
  return { ok: false, code: lastFailure?.code ?? 'unknown_error', stderr: lastFailure?.stderr };
}
