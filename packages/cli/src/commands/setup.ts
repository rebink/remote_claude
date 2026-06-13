import { existsSync } from 'node:fs';
import * as fs from 'node:fs';
import { writeFile, mkdir, readFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir, userInfo } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import chalk from 'chalk';
import prompts from 'prompts';
import { log } from '../lib/log.ts';
import * as tailscale from '../lib/tailscale.ts';
import { tailscaleStatus, type TailscalePeer } from '../lib/tailscale.ts';
import { buildAgentEnv, WRITE_AGENT_ENV_CMD, AGENT_INSTALL_CMD } from '../agent/provision/primitives.ts';

interface SetupAnswers {
  project: string;
  host: string;
  user: string;
  path: string;
  sshPort: number;
  agentUrl: string;
  token: string;
  username: string;
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
  username?: string;
}

export async function runSetup(cwd: string, opts: SetupOptions = {}): Promise<void> {
  const target = join(cwd, 'patchwire.yml');
  if (existsSync(target) && !opts.force) {
    log.warn(`patchwire.yml already exists. Use --force to overwrite.`);
    return;
  }

  log.step(chalk.bold('Patchwire — one-shot setup'));
  console.log();

  const username = opts.username ?? userInfo().username;

  // --host (or --no-tailscale) skips the tailnet picker entirely.
  const skipTailscale = opts.noTailscale === true || typeof opts.host === 'string';
  const ts = skipTailscale
    ? { installed: false, running: false, peers: [] as TailscalePeer[] }
    : tailscaleStatus();

  const answers = !skipTailscale && ts.running && ts.peers.length > 0
    ? await tailnetFlow(cwd, ts.peers, opts)
    : await manualFlow(cwd, ts, opts);
  answers.username = username;

  await writeYaml(cwd, answers);
  await mkdir(join(cwd, '.patchwire'), { recursive: true });
  await ensureGitignoreEntry(cwd, ['.patchwire/']);

  const envFile = join(homedir(), '.patchwire', 'env');
  await mkdir(join(homedir(), '.patchwire'), { recursive: true });
  await writeFile(
    envFile,
    `export PW_TOKEN=${answers.token}\nexport PW_USER=${answers.username}\n`,
    'utf8',
  );
  await chmod(envFile, 0o600);

  console.log();
  log.ok(`Wrote ${target}`);
  log.ok(`Wrote ${envFile} (chmod 600)`);
  console.log();
  log.step('Next steps:');
  console.log(chalk.cyan('  1. Load the token in your shell:'));
  console.log(`       echo 'source ~/.patchwire/env' >> ~/.zshrc`);
  console.log(`       source ~/.patchwire/env`);
  console.log();
  console.log(chalk.cyan('  2. On the Mac Mini, run:'));
  console.log(`       pnpm add -g github:rebink/patchwire`);
  console.log(`       export PW_AGENT_TOKEN=${answers.token}`);
  console.log(`       export PW_PROJECTS_ROOT=${answers.path.replace(/\/[^/]+$/, '')}`);
  console.log(`       patchwire-agent install        # registers as a launchd service`);
  console.log();
  console.log(chalk.cyan('  3. Verify the connection:'));
  console.log(`       patchwire doctor`);
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
    maybeAsk(!!opts.path, { type: 'text', name: 'path', message: 'Remote project path', initial: '~/workspace/${PW_USER}/${project}' }),
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
    username: '',
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
    maybeAsk(!!opts.path, { type: 'text', name: 'path', message: 'Remote project path', initial: '~/workspace/${PW_USER}/${project}' }),
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
    username: '',
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
  token: \${PW_TOKEN}
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

export interface VerifyKeyInput {
  host: string;
  user: string;
  port: number;
  keyPath: string;
}

export interface ProvisionAgentInput {
  host: string;
  user: string;
  port: number;       // ssh port
  keyPath: string;
  agentPort: number;  // agent HTTP port
  token: string;
}

function writeLocalToken(token: string): void {
  const envPath = join(homedir(), '.patchwire', 'env');
  fs.mkdirSync(dirname(envPath), { recursive: true });
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
  if (/^PW_TOKEN=.*$/m.test(content)) content = content.replace(/^PW_TOKEN=.*$/m, `PW_TOKEN=${token}`);
  else content = (content && !content.endsWith('\n') ? content + '\n' : content) + `PW_TOKEN=${token}\n`;
  fs.writeFileSync(envPath, content, { mode: 0o600 });
  fs.chmodSync(envPath, 0o600);
}

async function pollAgentHealth(host: string, port: number): Promise<boolean> {
  const { fetch } = await import('undici');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://${host}:${port}/health`, { method: 'GET' });
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

/**
 * Install + start the remote agent over the per-project key, set the token on the
 * laptop, and wait for /health. Prints a single JSON result to stdout.
 */
/**
 * Reject inputs that contain shell metacharacters before they are ever spliced
 * into the remote `bash -lc` script. token/host/port are interpolated into the
 * script text, so a value with `;`/`&`/`$()`/backticks would be command injection.
 * The wizard's values (hex token, IP/hostname, integer port) always pass.
 */
function unsafeProvisionField(input: ProvisionAgentInput): string | null {
  if (!/^[A-Za-z0-9_-]{16,}$/.test(input.token)) return 'token';
  if (!/^[A-Za-z0-9._:-]+$/.test(input.host)) return 'host';
  if (!/^[A-Za-z0-9._-]+$/.test(input.user)) return 'user';
  if (!Number.isInteger(input.agentPort) || input.agentPort < 1 || input.agentPort > 65535) return 'agentPort';
  return null;
}

export async function runProvisionAgent(input: ProvisionAgentInput): Promise<void> {
  const bad = unsafeProvisionField(input);
  if (bad) {
    process.stdout.write(JSON.stringify({ ok: false, code: 'invalid_input', stderr: `Refusing to provision: unsafe ${bad}.` }));
    return;
  }
  const remoteScript = [
    'set -e',
    'command -v node >/dev/null || { echo PW_NO_NODE; exit 3; }',
    `command -v patchwire-agent >/dev/null || { ${AGENT_INSTALL_CMD}; }`,
    `( ${WRITE_AGENT_ENV_CMD} )`,
    `patchwire-agent install --host ${input.host} --port ${input.agentPort}`,
  ].join(' && ');
  const remoteCmd = `bash -lc '${remoteScript.replace(/'/g, `'\\''`)}'`;
  const envPayload = buildAgentEnv({ token: input.token, host: input.host, port: input.agentPort });

  const ssh = spawnSync('ssh', [
    '-i', input.keyPath,
    '-o', 'IdentitiesOnly=yes',
    '-o', 'IdentityAgent=none',
    '-o', 'BatchMode=yes',
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'ConnectTimeout=10',
    '-p', String(input.port),
    `${input.user}@${input.host}`,
    remoteCmd,
  ], { encoding: 'utf8', input: envPayload });

  const stdout = ssh.stdout ?? '';
  const stderr = (ssh.stderr ?? '').trim();

  if (stdout.includes('PW_NO_NODE')) {
    process.stdout.write(JSON.stringify({ ok: false, code: 'no_node', stderr: 'Node 20+ was not found on the remote. Install Node there, then re-run setup.' }));
    return;
  }
  if (ssh.status !== 0) {
    const code = /launchctl|bootstrap|could not start/i.test(stderr) ? 'launchd_unstarted' : 'install_failed';
    writeLocalToken(input.token); // so a manual start still authenticates
    process.stdout.write(JSON.stringify({ ok: false, code, stderr: stderr || `provision exited ${ssh.status ?? 'null'}` }));
    return;
  }

  writeLocalToken(input.token);
  const healthy = await pollAgentHealth(input.host, input.agentPort);
  process.stdout.write(JSON.stringify(healthy ? { ok: true, healthy: true } : { ok: false, code: 'unhealthy', healthy: false }));
}

/**
 * Non-interactive key check used by the wizard's "Verify & continue". With
 * BatchMode the ssh can only succeed when the key is actually installed (no
 * password fallback). Writes `{ ok }` or a structured failure as JSON to stdout.
 */
export function runVerifyKey(input: VerifyKeyInput): void {
  const r = spawnSync(
    'ssh',
    [
      '-i', input.keyPath,
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'ConnectTimeout=6',
      '-p', String(input.port),
      `${input.user}@${input.host}`,
      'true',
    ],
    { encoding: 'utf8' },
  );
  if (r.status === 0) {
    process.stdout.write(JSON.stringify({ ok: true }));
    return;
  }
  const stderr = (r.stderr || r.stdout || `ssh exited ${r.status ?? 'null'}`).trim();
  process.stdout.write(JSON.stringify({ ok: false, code: 'verify_failed', stderr }));
}
