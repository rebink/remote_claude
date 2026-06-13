import * as cp from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
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

// InstallOptions kept minimal — env vars are no longer written by this command.
// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface InstallOptions {}

/**
 * Build a plist that sources the agent env file and then exec's the agent binary.
 * Pure function — exported for testing.
 */
export function buildAgentPlist(agentBin: string, env: string, outLog: string, errLog: string): string {
  const cmd = `. ${env}; exec ${agentBin} serve`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-lc</string>
    <string>${escape(cmd)}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escape(outLog)}</string>
  <key>StandardErrorPath</key><string>${escape(errLog)}</string>
</dict>
</plist>
`;
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

export async function runDaemonInstall(_opts: InstallOptions = {}): Promise<void> {
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

  if (!existsSync(envFile())) {
    log.err(`No agent env at ${envFile()}. Provision the token first (write-secret) or create it, then re-run.`);
    process.exitCode = 1;
    return;
  }

  await mkdir(logDir(), { recursive: true });
  await mkdir(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });

  const plist = buildAgentPlist(agentBin, envFile(), join(logDir(), 'agent.out.log'), join(logDir(), 'agent.err.log'));
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
  log.ok(`Env: ${envFile()} (sourced at launch)`);
  log.ok(`Logs: ${logDir()}/agent.{out,err}.log`);
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
