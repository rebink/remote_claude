import { existsSync } from 'node:fs';
import * as fs from 'node:fs';
import { writeFile, mkdir, readFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import chalk from 'chalk';
import prompts from 'prompts';
import { log } from '../lib/log.ts';
import * as tailscale from '../lib/tailscale.ts';
import { tailscaleStatus, type TailscalePeer } from '../lib/tailscale.ts';
import * as sshpass from '../lib/sshpass.ts';
import type { CopyIdResult } from '../lib/sshpass.ts';

interface SetupAnswers {
  project: string;
  host: string;
  user: string;
  path: string;
  sshPort: number;
  agentUrl: string;
  token: string;
}

export interface SetupOptions {
  force?: boolean;
  /** Skip Tailscale auto-detection (also implied by --host). */
  noTailscale?: boolean;
  /** Pre-filled values; any provided flag becomes the answer (no prompt). */
  host?: string;
  user?: string;
  project?: string;
  path?: string;
  sshPort?: number;
  agentPort?: number;
  token?: string;
}

export async function runSetup(cwd: string, opts: SetupOptions = {}): Promise<void> {
  const target = join(cwd, 'patchwire.yml');
  if (existsSync(target) && !opts.force) {
    log.warn(`patchwire.yml already exists. Use --force to overwrite.`);
    return;
  }

  log.step(chalk.bold('Remote Claude — one-shot setup'));
  console.log();

  // --host (or --no-tailscale) skips the tailnet picker entirely.
  const skipTailscale = opts.noTailscale === true || typeof opts.host === 'string';
  const ts = skipTailscale
    ? { installed: false, running: false, peers: [] as TailscalePeer[] }
    : tailscaleStatus();

  const answers = !skipTailscale && ts.running && ts.peers.length > 0
    ? await tailnetFlow(cwd, ts.peers, opts)
    : await manualFlow(cwd, ts, opts);

  await writeYaml(cwd, answers);
  await mkdir(join(cwd, '.remote-claude'), { recursive: true });
  await ensureGitignoreEntry(cwd, ['.remote-claude/']);

  const envFile = join(homedir(), '.remote-claude', 'env');
  await mkdir(join(homedir(), '.remote-claude'), { recursive: true });
  await writeFile(envFile, `export RC_TOKEN=${answers.token}\n`, 'utf8');
  await chmod(envFile, 0o600);

  console.log();
  log.ok(`Wrote ${target}`);
  log.ok(`Wrote ${envFile} (chmod 600)`);
  console.log();
  log.step('Next steps:');
  console.log(chalk.cyan('  1. Load the token in your shell:'));
  console.log(`       echo 'source ~/.remote-claude/env' >> ~/.zshrc`);
  console.log(`       source ~/.remote-claude/env`);
  console.log();
  console.log(chalk.cyan('  2. On the Mac Mini, run:'));
  console.log(`       pnpm add -g github:rebink/remote_claude`);
  console.log(`       export RC_AGENT_TOKEN=${answers.token}`);
  console.log(`       export RC_PROJECTS_ROOT=${answers.path.replace(/\/[^/]+$/, '')}`);
  console.log(`       remote-claude-agent install        # registers as a launchd service`);
  console.log();
  console.log(chalk.cyan('  3. Verify the connection:'));
  console.log(`       remote-claude doctor`);
  console.log();
}

/** Build a prompts question only if the corresponding flag wasn't provided. */
function maybeAsk<T>(skip: boolean, q: prompts.PromptObject<string>): prompts.PromptObject<string> | null {
  return skip ? null : q;
}

async function tailnetFlow(cwd: string, peers: TailscalePeer[], opts: SetupOptions): Promise<SetupAnswers> {
  log.ok('Tailscale is running — picking the Mac Mini from your tailnet.');
  const candidates = peers
    .filter((p) => p.online)
    .filter((p) => p.os === 'macOS' || p.os === 'iOS' || p.os === 'Linux' || p.os === '')
    .sort((a, b) => a.hostname.localeCompare(b.hostname));

  const choices = (candidates.length > 0 ? candidates : peers).map((p) => ({
    title: `${p.hostname} ${chalk.dim(`${p.dnsName} · ${p.ipv4} · ${p.os}${p.online ? '' : ' · OFFLINE'}`)}`,
    value: p,
  }));

  const { peer } = await prompts({
    type: 'select',
    name: 'peer',
    message: 'Which device is your Mac Mini?',
    choices,
  }, { onCancel: () => process.exit(1) });

  const tsPeer = peer as TailscalePeer;
  const useDns = tsPeer.dnsName && tsPeer.dnsName !== tsPeer.hostname;
  const host = useDns ? tsPeer.dnsName : tsPeer.ipv4;
  const agentPort = opts.agentPort ?? 7878;

  const questions = [
    maybeAsk(!!opts.project, { type: 'text', name: 'project', message: 'Project name on remote', initial: basename(cwd) }),
    maybeAsk(!!opts.user, { type: 'text', name: 'user', message: 'Remote user (SSH)', initial: process.env.USER ?? 'rebin' }),
    maybeAsk(!!opts.path, { type: 'text', name: 'path', message: 'Remote project path', initial: '~/workspace/${project}' }),
    maybeAsk(opts.sshPort !== undefined, { type: 'number', name: 'sshPort', message: 'SSH port', initial: 22 }),
  ].filter((q): q is prompts.PromptObject<string> => q !== null);

  const detail = questions.length ? await prompts(questions, { onCancel: () => process.exit(1) }) : {};

  const project = (opts.project ?? detail.project) as string;
  const user = (opts.user ?? detail.user) as string;
  const pathTpl = (opts.path ?? detail.path) as string;
  const path = pathTpl.replace('${project}', project);
  const sshPort = (opts.sshPort ?? detail.sshPort) as number;

  return {
    project,
    host,
    user,
    path,
    sshPort,
    agentUrl: `http://${host}:${agentPort}`,
    token: opts.token ?? generateToken(),
  };
}

async function manualFlow(
  cwd: string,
  ts: { installed: boolean; running: boolean },
  opts: SetupOptions,
): Promise<SetupAnswers> {
  if (!opts.host) {
    if (!ts.installed) {
      log.warn('Tailscale not detected.');
      log.dim('  Install: brew install tailscale && sudo tailscale up');
      log.dim('  Or continue with a manual host below.');
    } else if (!ts.running) {
      log.warn('Tailscale is installed but not running. Run `sudo tailscale up` for auto-discovery.');
    }
    console.log();
  } else {
    log.ok(`Using host from --host: ${opts.host}`);
  }

  const questions = [
    maybeAsk(!!opts.project, { type: 'text', name: 'project', message: 'Project name on remote', initial: basename(cwd) }),
    maybeAsk(!!opts.host, { type: 'text', name: 'host', message: 'Mac Mini host (IP or hostname)', initial: '192.168.1.10' }),
    maybeAsk(!!opts.user, { type: 'text', name: 'user', message: 'Remote user (SSH)', initial: process.env.USER ?? 'rebin' }),
    maybeAsk(!!opts.path, { type: 'text', name: 'path', message: 'Remote project path', initial: '~/workspace/${project}' }),
    maybeAsk(opts.sshPort !== undefined, { type: 'number', name: 'sshPort', message: 'SSH port', initial: 22 }),
    maybeAsk(opts.agentPort !== undefined, { type: 'number', name: 'agentPort', message: 'Agent HTTP port', initial: 7878 }),
  ].filter((q): q is prompts.PromptObject<string> => q !== null);

  const a = questions.length ? await prompts(questions, { onCancel: () => process.exit(1) }) : {};

  const project = (opts.project ?? a.project) as string;
  const host = (opts.host ?? a.host) as string;
  const user = (opts.user ?? a.user) as string;
  const pathTpl = (opts.path ?? a.path) as string;
  const path = pathTpl.replace('${project}', project);
  const sshPort = (opts.sshPort ?? a.sshPort) as number;
  const agentPort = (opts.agentPort ?? a.agentPort ?? 7878) as number;

  return {
    project,
    host,
    user,
    path,
    sshPort,
    agentUrl: `http://${host}:${agentPort}`,
    token: opts.token ?? generateToken(),
  };
}

function generateToken(): string {
  return randomBytes(32).toString('hex');
}

async function writeYaml(cwd: string, a: SetupAnswers): Promise<void> {
  const yaml = `project: ${a.project}
remote:
  host: ${a.host}
  user: ${a.user}
  path: ${a.path}
  sshPort: ${a.sshPort}
  agentUrl: ${a.agentUrl}
  token: \${RC_TOKEN}
sync:
  exclude:
    - build/
    - .dart_tool/
    - ios/Pods/
    - node_modules/
    - .git/
ai:
  command: claude
  args:
    - --print
  timeoutSec: 600
`;
  await writeFile(join(cwd, 'patchwire.yml'), yaml, 'utf8');
}

async function ensureGitignoreEntry(cwd: string, entries: string[]): Promise<void> {
  const path = join(cwd, '.gitignore');
  let current = '';
  if (existsSync(path)) {
    current = await readFile(path, 'utf8');
  }
  const lines = new Set(current.split('\n').map((l) => l.trim()).filter(Boolean));
  let changed = false;
  for (const e of entries) {
    if (!lines.has(e)) {
      lines.add(e);
      changed = true;
    }
  }
  if (changed) {
    await writeFile(path, Array.from(lines).join('\n') + '\n', 'utf8');
  }
}

/**
 * One-shot, non-interactive: print the Tailscale peer list as JSON and exit.
 * Consumed by the VS Code extension setup wizard (M5).
 *
 * Goes through the `tailscale` namespace import so tests can mock
 * `getPeers` via `vi.spyOn(ts, 'getPeers')`.
 */
export async function runSetupListPeers(opts: { json: boolean }): Promise<void> {
  const peers = await tailscale.getPeers();
  if (opts.json) {
    process.stdout.write(JSON.stringify(peers));
    return;
  }
  for (const p of peers) {
    const status = p.online ? 'online' : 'offline';
    process.stdout.write(`${p.hostname}\t${p.host}\t${status}\n`);
  }
}

export interface PasswordStdinInput {
  host: string;
  user: string;
  port: number;
  keyPath: string; // private key path; .pub appended for the public key
  trustNewKey?: boolean;
}

/**
 * One-shot, non-interactive: read a single-line password from stdin and run
 * `ssh-copy-id` via `sshpass` to install the per-project key on the remote.
 * Writes the typed result `{ ok, code?, stderr? }` as JSON to stdout.
 *
 * Imports `fs` and `sshpass` via namespace so tests can spy on
 * `fs.existsSync` and `sshpass.copyIdWithPassword`.
 */
export async function runSetupPasswordStdin(input: PasswordStdinInput): Promise<void> {
  if (!input.keyPath) {
    process.stdout.write(JSON.stringify({ ok: false, code: 'unknown', stderr: '--key-path is required' }));
    return;
  }

  if (input.trustNewKey) {
    spawnSync('ssh-keygen', ['-R', input.host]);
    spawnSync('ssh-keygen', ['-R', `[${input.host}]:${input.port}`]);
  }

  // Ensure key dir + key exist
  if (!fs.existsSync(input.keyPath)) {
    fs.mkdirSync(dirname(input.keyPath), { recursive: true, mode: 0o700 });
    const r = spawnSync('ssh-keygen', [
      '-t',
      'ed25519',
      '-N',
      '',
      '-f',
      input.keyPath,
      '-C',
      `remote-claude@${input.host}`,
    ]);
    if (r.status !== 0) {
      process.stdout.write(JSON.stringify({ ok: false, code: 'unknown', stderr: 'ssh-keygen failed' }));
      return;
    }
    fs.chmodSync(input.keyPath, 0o600);
  }

  // Read password from stdin (single line)
  const password = await readPasswordFromStdin();

  let result: CopyIdResult;
  try {
    result = await sshpass.copyIdWithPassword({
      host: input.host,
      user: input.user,
      port: input.port,
      keyPath: input.keyPath,
      password,
    });
  } finally {
    // Best-effort: drop the reference. The Buffer inside sshpass.ts is already zeroed.
  }

  process.stdout.write(JSON.stringify(result));
}

function readPasswordFromStdin(): Promise<string> {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c: string) => {
      buf += c;
    });
    process.stdin.on('end', () => resolve(buf.replace(/\r?\n$/, '')));
  });
}
