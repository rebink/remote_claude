import { posix, win32 } from 'node:path';

/** Well-known install locations for tools not always on PATH, keyed by tool then platform. */
const KNOWN_LOCATIONS: Record<string, Partial<Record<NodeJS.Platform, string[]>>> = {
  tailscale: {
    win32: ['C:\\Program Files\\Tailscale\\tailscale.exe', 'C:\\Program Files (x86)\\Tailscale\\tailscale.exe'],
    darwin: ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/usr/local/bin/tailscale', '/opt/homebrew/bin/tailscale'],
    linux: ['/usr/bin/tailscale', '/usr/local/bin/tailscale'],
  },
};

/** Ordered absolute-path candidates for an external tool: PATH dirs first, then known install dirs. */
export function toolCandidates(platform: NodeJS.Platform, name: string, env: NodeJS.ProcessEnv): string[] {
  const isWin = platform === 'win32';
  const exe = isWin ? `${name}.exe` : name;
  const pathSep = isWin ? ';' : ':';
  const pathJoin = isWin ? win32.join : posix.join;
  const out: string[] = [];
  for (const dir of (env.PATH ?? '').split(pathSep).filter(Boolean)) out.push(pathJoin(dir, exe));
  const known = KNOWN_LOCATIONS[name]?.[platform];
  if (known) out.push(...known);
  return out;
}
