import type { DetectDeps } from '../server-platform/types.ts';

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
