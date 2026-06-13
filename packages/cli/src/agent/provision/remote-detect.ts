import type { DetectDeps, DetectedServerPlatform } from '../server-platform/types.ts';
import { detectServerPlatform } from '../server-platform/detect.ts';
import { runSsh, type SshOpts } from '../../lib/ssh-runner.ts';

/** Capability tools probed on the remote (mirrors the local detector's signals). */
export const PROBE_TOOLS = [
  'node', 'corepack', 'pnpm',
  'sandbox-exec', 'launchctl', 'systemctl', 'nft',
  'brew', 'apt-get', 'zsh', 'secret-tool',
] as const;

/** One POSIX probe: prints `<sysname> <machine>`, then `has:<tool>` for each present tool. */
export function buildProbeScript(tools: readonly string[] = PROBE_TOOLS): string {
  return `uname -sm; for c in ${tools.join(' ')}; do command -v "$c" >/dev/null 2>&1 && echo "has:$c"; done`;
}

function mapPlatform(sysname: string): NodeJS.Platform | null {
  const s = sysname.toLowerCase();
  if (s === 'darwin') return 'darwin';
  if (s === 'linux') return 'linux';
  return null; // unrecognized / non-POSIX (e.g. Windows)
}

function mapArch(machine: string): string {
  const m = machine.toLowerCase();
  if (m === 'x86_64' || m === 'amd64') return 'x64';
  if (m === 'aarch64' || m === 'arm64') return 'arm64';
  return m;
}

/** Parse POSIX probe output into DetectDeps, or null if the first line isn't a uname result. */
export function parseProbe(stdout: string): DetectDeps | null {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const parts = lines[0]!.split(/\s+/);
  const platform = mapPlatform(parts[0] ?? '');
  if (!platform) return null;
  const present = new Set(lines.filter((l) => l.startsWith('has:')).map((l) => l.slice(4)));
  return { platform, arch: mapArch(parts[1] ?? ''), has: (c) => present.has(c) };
}

/** Tools probed on a Windows remote (Get-Command). */
export const WINDOWS_PROBE_TOOLS = ['node', 'corepack', 'pnpm', 'claude', 'sc', 'winget'] as const;

/**
 * PowerShell probe for a native Windows remote (OpenSSH default shell is cmd.exe, which
 * can invoke powershell.exe). Prints `WINDOWS <OSArchitecture>` then `has:<tool>` lines.
 * Uses RuntimeInformation.OSArchitecture (true OS arch) — not PROCESSOR_ARCHITECTURE
 * (which reports the *process* arch).
 */
export function buildWindowsProbeScript(tools: readonly string[] = WINDOWS_PROBE_TOOLS): string {
  const list = tools.map((t) => `'${t}'`).join(',');
  return `powershell -NoProfile -Command "Write-Output ('WINDOWS ' + [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture); foreach($c in ${list}){ if(Get-Command $c -ErrorAction SilentlyContinue){ Write-Output ('has:' + $c) } }"`;
}

function mapWinArch(token: string): string {
  const t = token.toLowerCase();
  if (t === 'x64') return 'x64';
  if (t === 'arm64') return 'arm64';
  if (t === 'x86') return 'ia32';
  return t;
}

/** Parse the Windows PowerShell probe output into DetectDeps, or null if not a Windows probe. */
export function parseWindowsProbe(stdout: string): DetectDeps | null {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const m = lines[0]!.match(/^WINDOWS\s+(\S+)/i);
  if (!m) return null;
  const present = new Set(lines.filter((l) => l.startsWith('has:')).map((l) => l.slice(4)));
  return { platform: 'win32', arch: mapWinArch(m[1]!), has: (c) => present.has(c) };
}

/** SSH connection params without the per-call `command`. */
export type RemoteConn = Omit<SshOpts, 'command'>;

/** Runs a probe script on the remote and returns its stdout + exit code. Injected for testing. */
export type ProbeRunner = (script: string) => Promise<{ stdout: string; code: number | null }>;

function sshProbeRunner(conn: RemoteConn): ProbeRunner {
  return async (script) => {
    const r = await runSsh({ ...conn, command: script });
    return { stdout: r.stdout, code: r.code };
  };
}

/**
 * Detect the remote host's ServerPlatform over SSH. Node-independent: a missing Node
 * is `has('node') === false`, surfaced as a plan-time prerequisite — never a detection failure.
 */
export async function detectRemoteServerPlatform(
  conn: RemoteConn,
  runner: ProbeRunner = sshProbeRunner(conn),
): Promise<DetectedServerPlatform> {
  const posix = await runner(buildProbeScript());
  let deps = parseProbe(posix.stdout);
  if (!deps) {
    const win = await runner(buildWindowsProbeScript());
    deps = parseWindowsProbe(win.stdout);
  }
  if (!deps) {
    throw new Error(
      'Could not detect the remote OS: neither a POSIX `uname` nor a Windows PowerShell probe ' +
        'returned a recognized result. Ensure the remote is reachable over SSH and runs a POSIX shell or Windows PowerShell.',
    );
  }
  return detectServerPlatform(deps);
}
