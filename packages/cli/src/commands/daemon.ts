import * as cp from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';
import { log } from '../lib/log.ts';
import { buildAgentLauncherPs1, buildSchtasksCreate, buildSchtasksDelete, WINDOWS_TASK_NAME } from '../agent/provision/windows-primitives.ts';

const SERVICE_LABEL = 'com.patchwire.agent';
const SYSTEMD_UNIT = 'patchwire-agent.service';

function plistPath(): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
}

function unitPath(): string {
  return join(homedir(), '.config', 'systemd', 'user', SYSTEMD_UNIT);
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

function whichWindows(bin: string): string | undefined {
  const r = cp.spawnSync('where', [bin], { encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim().split(/\r?\n/)[0];
  return undefined;
}

function launcherPath(): string {
  return join(homedir(), '.patchwire', 'bin', 'agent-launcher.ps1');
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
 * Build a systemd --user unit that sources the agent env file and then exec's the agent binary.
 * Pure function — exported for testing.
 *
 * NOTE: systemd EnvironmentFile= cannot parse `export VAR=val` lines (it takes the literal string
 * "export VAR" as the key). Instead we source the env via a login shell exactly like the launchd
 * plist does: ExecStart=/bin/sh -lc '. <envFile>; exec <agentBin> serve'
 */
export function buildAgentUnit(agentBin: string, env: string): string {
  return `[Unit]
Description=Patchwire agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/bin/sh -lc '. ${env}; exec ${agentBin} serve'
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
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

/**
 * Enable and start the systemd --user service. Analogous to startLaunchAgent.
 * Also attempts best-effort loginctl enable-linger so the unit survives across logout;
 * linger failure is non-fatal (requires polkit/root on many distros).
 */
export function startSystemdUser(): { ok: boolean; stderr?: string } {
  cp.spawnSync('systemctl', ['--user', 'daemon-reload'], { encoding: 'utf8' });
  const enable = cp.spawnSync('systemctl', ['--user', 'enable', '--now', SYSTEMD_UNIT], { encoding: 'utf8' });
  // Best-effort linger: allows the user unit to survive across logout. Non-fatal.
  cp.spawnSync('loginctl', ['enable-linger'], { stdio: 'ignore' });
  if (enable.status === 0) return { ok: true };
  return { ok: false, stderr: (enable.stderr || 'systemctl --user enable --now failed').trim() };
}

export async function runDaemonInstall(_opts: InstallOptions = {}): Promise<void> {
  // Platform-agnostic checks first.
  const agentBin = platform() === 'win32' ? whichWindows('patchwire-agent') : which('patchwire-agent');
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

  if (platform() === 'darwin') {
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
    return;
  }

  if (platform() === 'linux') {
    await mkdir(join(homedir(), '.config', 'systemd', 'user'), { recursive: true });
    const unit = buildAgentUnit(agentBin, envFile());
    await writeFile(unitPath(), unit, { encoding: 'utf8', mode: 0o644 });
    const start = startSystemdUser();
    if (!start.ok) {
      log.err(`systemctl --user could not start the agent: ${start.stderr}`);
      log.err(`The unit is written at ${unitPath()}. If this is a fresh login session you may need: loginctl enable-linger`);
      process.exitCode = 1;
      return;
    }
    log.ok(`Installed systemd --user service: ${SYSTEMD_UNIT}`);
    log.ok(`Unit: ${unitPath()}`);
    log.ok(`Env: ${envFile()} (sourced at launch)`);
    log.step('Manage the service:');
    console.log(`  systemctl --user stop ${SYSTEMD_UNIT}`);
    console.log(`  systemctl --user start ${SYSTEMD_UNIT}`);
    console.log(`  patchwire-agent uninstall        # remove`);
    return;
  }

  if (platform() === 'win32') {
    await mkdir(join(homedir(), '.patchwire', 'bin'), { recursive: true });
    await writeFile(launcherPath(), buildAgentLauncherPs1(), { encoding: 'utf8' });
    const create = cp.spawnSync('cmd', ['/c', buildSchtasksCreate(launcherPath())], { encoding: 'utf8' });
    if (create.status !== 0) {
      log.err(`schtasks could not register the agent task: ${(create.stderr || create.stdout || '').trim()}`);
      log.err(`The launcher is written at ${launcherPath()}. You can register it manually with schtasks /Create.`);
      process.exitCode = 1;
      return;
    }
    cp.spawnSync('cmd', ['/c', `schtasks /Run /TN ${WINDOWS_TASK_NAME}`], { stdio: 'ignore' });
    log.ok(`Installed scheduled task: ${WINDOWS_TASK_NAME}`);
    log.ok(`Launcher: ${launcherPath()}`);
    log.ok(`Env: ${envFile()} (sourced at launch)`);
    log.step('Manage the task:');
    console.log(`  schtasks /End /TN ${WINDOWS_TASK_NAME}`);
    console.log(`  schtasks /Run /TN ${WINDOWS_TASK_NAME}`);
    console.log(`  patchwire-agent uninstall        # remove`);
    return;
  }

  log.err(`service install is not supported on ${platform()}.`);
  process.exitCode = 1;
}

export async function runDaemonUninstall(): Promise<void> {
  if (platform() === 'darwin') {
    if (!existsSync(plistPath())) {
      log.warn('No launchd plist found — nothing to uninstall.');
      return;
    }
    cp.spawnSync('launchctl', ['unload', plistPath()], { stdio: 'ignore' });
    await unlink(plistPath());
    log.ok(`Removed ${plistPath()}`);
    log.dim(`(env file at ${envFile()} kept — delete manually if you want a clean slate)`);
    return;
  }

  if (platform() === 'linux') {
    if (!existsSync(unitPath())) {
      log.warn('No systemd unit found — nothing to uninstall.');
      return;
    }
    cp.spawnSync('systemctl', ['--user', 'disable', '--now', SYSTEMD_UNIT], { stdio: 'ignore' });
    await unlink(unitPath());
    cp.spawnSync('systemctl', ['--user', 'daemon-reload'], { stdio: 'ignore' });
    log.ok(`Removed ${unitPath()}`);
    log.dim(`(env file at ${envFile()} kept — delete manually if you want a clean slate)`);
    return;
  }

  if (platform() === 'win32') {
    cp.spawnSync('cmd', ['/c', buildSchtasksDelete()], { stdio: 'ignore' });
    if (existsSync(launcherPath())) await unlink(launcherPath());
    log.ok(`Removed scheduled task: ${WINDOWS_TASK_NAME}`);
    log.dim(`(env file at ${envFile()} kept — delete manually if you want a clean slate)`);
    return;
  }

  log.err('service uninstall is not supported on this platform.');
  process.exitCode = 1;
}
