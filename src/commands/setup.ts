import { existsSync } from 'node:fs';
import { writeFile, mkdir, readFile, chmod } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import chalk from 'chalk';
import prompts from 'prompts';
import { log } from '../lib/log.ts';
import { tailscaleStatus, type TailscalePeer } from '../lib/tailscale.ts';

interface SetupAnswers {
  project: string;
  host: string;
  user: string;
  path: string;
  sshPort: number;
  agentUrl: string;
  token: string;
}

export async function runSetup(cwd: string, opts: { force?: boolean } = {}): Promise<void> {
  const target = join(cwd, 'remote-claude.yml');
  if (existsSync(target) && !opts.force) {
    log.warn(`remote-claude.yml already exists. Use --force to overwrite.`);
    return;
  }

  log.step(chalk.bold('Remote Claude — one-shot setup'));
  console.log();

  const ts = tailscaleStatus();
  const answers = ts.running && ts.peers.length > 0
    ? await tailnetFlow(cwd, ts.peers)
    : await manualFlow(cwd, ts);

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

async function tailnetFlow(cwd: string, peers: TailscalePeer[]): Promise<SetupAnswers> {
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

  const detail = await prompts([
    { type: 'text', name: 'project', message: 'Project name on remote', initial: basename(cwd) },
    { type: 'text', name: 'user', message: 'Remote user (SSH)', initial: process.env.USER ?? 'rebin' },
    { type: 'text', name: 'path', message: 'Remote project path', initial: '~/workspace/${project}' },
    { type: 'number', name: 'sshPort', message: 'SSH port', initial: 22 },
  ], { onCancel: () => process.exit(1) });

  const path = String(detail.path).replace('${project}', String(detail.project));
  return {
    project: String(detail.project),
    host,
    user: String(detail.user),
    path,
    sshPort: Number(detail.sshPort),
    agentUrl: `http://${host}:7878`,
    token: generateToken(),
  };
}

async function manualFlow(cwd: string, ts: { installed: boolean; running: boolean }): Promise<SetupAnswers> {
  if (!ts.installed) {
    log.warn('Tailscale not detected.');
    log.dim('  Install: brew install tailscale && sudo tailscale up');
    log.dim('  Or continue with a manual host below.');
  } else if (!ts.running) {
    log.warn('Tailscale is installed but not running. Run `sudo tailscale up` for auto-discovery.');
  }
  console.log();

  const a = await prompts([
    { type: 'text', name: 'project', message: 'Project name on remote', initial: basename(cwd) },
    { type: 'text', name: 'host', message: 'Mac Mini host (IP or hostname)', initial: '192.168.1.10' },
    { type: 'text', name: 'user', message: 'Remote user (SSH)', initial: process.env.USER ?? 'rebin' },
    { type: 'text', name: 'path', message: 'Remote project path', initial: '~/workspace/${project}' },
    { type: 'number', name: 'sshPort', message: 'SSH port', initial: 22 },
    { type: 'number', name: 'agentPort', message: 'Agent HTTP port', initial: 7878 },
  ], { onCancel: () => process.exit(1) });

  const path = String(a.path).replace('${project}', String(a.project));
  return {
    project: String(a.project),
    host: String(a.host),
    user: String(a.user),
    path,
    sshPort: Number(a.sshPort),
    agentUrl: `http://${a.host}:${a.agentPort}`,
    token: generateToken(),
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
  await writeFile(join(cwd, 'remote-claude.yml'), yaml, 'utf8');
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
