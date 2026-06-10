import * as cp from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile, mkdir, unlink, chmod } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import chalk from 'chalk';
import { log } from '../lib/log.ts';

const SERVICE_LABEL = 'com.patchwire.agent';

function plistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
}

function logDir(): string {
  return join(homedir(), '.patchwire', 'logs');
}

function envFile(): string {
  return join(homedir(), '.patchwire', 'agent.env');
}

function which(bin: string): string | undefined {
  const r = cp.spawnSync('command', ['-v', bin], { encoding: 'utf8', shell: '/bin/sh' });
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
  aiBin?: string;
}

/**
 * Start (or restart) the LaunchAgent. Tries the modern GUI-domain `bootstrap`
 * first (this is what works over SSH when the user is logged in), then the
 * legacy `load`, then `kickstart`. Returns how it started, or a failure.
 */
export function startLaunchAgent(plist: string, uid: number): { ok: boolean; method?: string; stderr?: string } {
  const domain = `gui/${uid}`;
  // Clear any prior registration both ways (ignore errors).
  cp.spawnSync('launchctl', ['bootout', `${domain}/${SERVICE_LABEL}`], { stdio: 'ignore' });
  cp.spawnSync('launchctl', ['unload', plist], { stdio: 'ignore' });

  const boot = cp.spawnSync('launchctl', ['bootstrap', domain, plist], { encoding: 'utf8' });
  if (boot.status === 0) {
    cp.spawnSync('launchctl', ['kickstart', '-k', `${domain}/${SERVICE_LABEL}`], { stdio: 'ignore' });
    return { ok: true, method: 'bootstrap' };
  }
  const load = cp.spawnSync('launchctl', ['load', plist], { encoding: 'utf8' });
  if (load.status === 0) return { ok: true, method: 'load' };

  const stderr = (boot.stderr || load.stderr || 'launchctl could not start the agent').trim();
  return { ok: false, stderr };
}

export async function runDaemonInstall(opts: InstallOptions = {}): Promise<void> {
  if (platform() !== 'darwin') {
    log.err(`launchd install is macOS-only. On Linux, run \`patchwire-agent\` under systemd or tmux.`);
    process.exitCode = 1;
    return;
  }

  const agentBin = which('patchwire-agent');
  if (!agentBin) {
    log.err('`patchwire-agent` not found on PATH. Install with `pnpm add -g github:rebink/patchwire` first.');
    process.exitCode = 1;
    return;
  }

  const projectsRoot = opts.projectsRoot ?? process.env.PW_PROJECTS_ROOT ?? join(homedir(), 'workspace');
  const port = opts.port ?? Number(process.env.PW_AGENT_PORT ?? 7878);
  // Default to loopback; network reachability (Tailscale/LAN) must be opted into.
  const host = opts.host ?? process.env.PW_AGENT_HOST ?? '127.0.0.1';
  const token = opts.token ?? process.env.PW_AGENT_TOKEN ?? randomBytes(32).toString('hex');
  const aiBin = opts.aiBin ?? process.env.PW_AI_BIN ?? 'claude';

  await mkdir(logDir(), { recursive: true });
  await mkdir(join(homedir(), '.patchwire'), { recursive: true });

  await writeFile(
    envFile(),
    `# patchwire-agent environment\nexport PW_AGENT_TOKEN=${token}\nexport PW_PROJECTS_ROOT=${projectsRoot}\nexport PW_AGENT_HOST=${host}\nexport PW_AGENT_PORT=${port}\nexport PW_AI_BIN=${aiBin}\n`,
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
    <key>PW_AGENT_TOKEN</key><string>${escape(token)}</string>
    <key>PW_PROJECTS_ROOT</key><string>${escape(projectsRoot)}</string>
    <key>PW_AGENT_HOST</key><string>${escape(host)}</string>
    <key>PW_AGENT_PORT</key><string>${escape(String(port))}</string>
    <key>PW_AI_BIN</key><string>${escape(aiBin)}</string>
  </dict>
</dict>
</plist>
`;

  await mkdir(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
  await writeFile(plistPath(), plist, { encoding: 'utf8', mode: 0o600 });

  const uid = process.getuid?.() ?? 0;
  const start = startLaunchAgent(plistPath(), uid);
  if (!start.ok) {
    log.err(`launchctl could not start the agent: ${start.stderr}`);
    log.err(`The plist is written. If this remote is logged in, run: launchctl bootstrap gui/${uid} ${plistPath()}`);
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
  log.dim('On the laptop, set: export PW_TOKEN=<token-above>');
  console.log();
  log.step('Manage the service:');
  console.log(`  launchctl unload ${plistPath()}    # stop`);
  console.log(`  launchctl load   ${plistPath()}    # start`);
  console.log(`  patchwire-agent uninstall        # remove`);
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
  cp.spawnSync('launchctl', ['unload', plistPath()], { stdio: 'ignore' });
  await unlink(plistPath());
  log.ok(`Removed ${plistPath()}`);
  log.dim(`(env file at ${envFile()} kept — delete manually if you want a clean slate)`);
}
