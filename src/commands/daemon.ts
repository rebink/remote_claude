import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile, mkdir, unlink, chmod } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import chalk from 'chalk';
import { log } from '../lib/log.ts';

const SERVICE_LABEL = 'com.remote-claude.agent';

function plistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
}

function logDir(): string {
  return join(homedir(), '.remote-claude', 'logs');
}

function envFile(): string {
  return join(homedir(), '.remote-claude', 'agent.env');
}

function which(bin: string): string | undefined {
  const r = spawnSync('command', ['-v', bin], { encoding: 'utf8', shell: '/bin/sh' });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  return undefined;
}

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface InstallOptions {
  projectsRoot?: string;
  port?: number;
  host?: string;
  token?: string;
  claudeBin?: string;
}

export async function runDaemonInstall(opts: InstallOptions = {}): Promise<void> {
  if (platform() !== 'darwin') {
    log.err(`launchd install is macOS-only. On Linux, run \`remote-claude-agent\` under systemd or tmux.`);
    process.exitCode = 1;
    return;
  }

  const agentBin = which('remote-claude-agent');
  if (!agentBin) {
    log.err('`remote-claude-agent` not found on PATH. Install with `pnpm add -g github:rebink/remote_claude` first.');
    process.exitCode = 1;
    return;
  }

  const nodeBin = which('node') ?? '/usr/bin/env node';
  const projectsRoot = opts.projectsRoot ?? process.env.RC_PROJECTS_ROOT ?? join(homedir(), 'workspace');
  const port = opts.port ?? Number(process.env.RC_AGENT_PORT ?? 7878);
  const host = opts.host ?? process.env.RC_AGENT_HOST ?? '0.0.0.0';
  const token = opts.token ?? process.env.RC_AGENT_TOKEN ?? randomBytes(32).toString('hex');
  const claudeBin = opts.claudeBin ?? process.env.RC_CLAUDE_BIN ?? 'claude';

  await mkdir(logDir(), { recursive: true });
  await mkdir(join(homedir(), '.remote-claude'), { recursive: true });

  await writeFile(
    envFile(),
    `# remote-claude-agent environment\nexport RC_AGENT_TOKEN=${token}\nexport RC_PROJECTS_ROOT=${projectsRoot}\nexport RC_AGENT_HOST=${host}\nexport RC_AGENT_PORT=${port}\nexport RC_CLAUDE_BIN=${claudeBin}\n`,
    'utf8',
  );
  await chmod(envFile(), 0o600);

  const path = process.env.PATH ?? '/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin';

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escape(agentBin)}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escape(join(logDir(), 'agent.out.log'))}</string>
  <key>StandardErrorPath</key><string>${escape(join(logDir(), 'agent.err.log'))}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${escape(path)}</string>
    <key>RC_AGENT_TOKEN</key><string>${escape(token)}</string>
    <key>RC_PROJECTS_ROOT</key><string>${escape(projectsRoot)}</string>
    <key>RC_AGENT_HOST</key><string>${escape(host)}</string>
    <key>RC_AGENT_PORT</key><string>${escape(String(port))}</string>
    <key>RC_CLAUDE_BIN</key><string>${escape(claudeBin)}</string>
  </dict>
</dict>
</plist>
`;

  await mkdir(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
  await writeFile(plistPath(), plist, 'utf8');

  spawnSync('launchctl', ['unload', plistPath()], { stdio: 'ignore' });
  const load = spawnSync('launchctl', ['load', plistPath()], { encoding: 'utf8' });
  if (load.status !== 0) {
    log.err(`launchctl load failed: ${load.stderr.trim()}`);
    process.exitCode = 1;
    return;
  }

  log.ok(`Installed launchd service: ${SERVICE_LABEL}`);
  log.ok(`Plist: ${plistPath()}`);
  log.ok(`Env file: ${envFile()} (chmod 600)`);
  log.ok(`Logs: ${logDir()}/agent.{out,err}.log`);
  console.log();
  log.step('Token (share with the laptop):');
  console.log(`  ${chalk.bold(token)}`);
  console.log();
  log.dim('On the laptop, set: export RC_TOKEN=<token-above>');
  console.log();
  log.step('Manage the service:');
  console.log(`  launchctl unload ${plistPath()}    # stop`);
  console.log(`  launchctl load   ${plistPath()}    # start`);
  console.log(`  remote-claude-agent uninstall        # remove`);
}

export async function runDaemonUninstall(): Promise<void> {
  if (platform() !== 'darwin') {
    log.err('launchd uninstall is macOS-only.');
    process.exitCode = 1;
    return;
  }
  if (!existsSync(plistPath())) {
    log.warn('No launchd plist found — nothing to uninstall.');
    return;
  }
  spawnSync('launchctl', ['unload', plistPath()], { stdio: 'ignore' });
  await unlink(plistPath());
  log.ok(`Removed ${plistPath()}`);
  log.dim(`(env file at ${envFile()} kept — delete manually if you want a clean slate)`);
}
