import { spawn } from 'node:child_process';
import { lookup } from 'node:dns/promises';
import { delimiter, join } from 'node:path';
import { statSync } from 'node:fs';

/**
 * Default-deny egress for the remote `claude` process (macOS / seatbelt).
 *
 * Read-minimization (the sync model) stops the agent *seeing* un-synced secrets;
 * this stops it *exfiltrating* the synced code (or being prompt-injected into
 * phoning out). We wrap the `claude` spawn in `sandbox-exec` with a profile that
 * denies outbound network except localhost, DNS, and the resolved allowlist —
 * the same mechanism Claude Code's own macOS sandbox uses.
 */

/** Hosts every confined agent may always reach. */
export const ANTHROPIC_DEFAULT_HOSTS: string[] = ['api.anthropic.com'];

/** Default ∪ operator hosts (comma/whitespace separated), deduped, order-stable. */
export function mergeAllowHosts(extra: string | undefined): string[] {
  const extras = (extra ?? '')
    .split(/[\s,]+/)
    .map((h) => h.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const h of [...ANTHROPIC_DEFAULT_HOSTS, ...extras]) {
    if (!out.includes(h)) out.push(h);
  }
  return out;
}

/** DNS-resolve each host to a deduped list of IP literals. Hosts that fail to resolve are skipped. */
export async function resolveHosts(hosts: string[]): Promise<string[]> {
  const ips = new Set<string>();
  for (const h of hosts) {
    try {
      for (const a of await lookup(h, { all: true })) ips.add(a.address);
    } catch {
      /* unresolvable host is skipped; doctor probe surfaces reachability */
    }
  }
  return [...ips];
}

/**
 * Generate a seatbelt profile: allow everything except outbound network, then
 * re-allow localhost, unix sockets, (optionally) DNS, and each allowlist IP on
 * 443. NO hostname-suffix matching — only resolved IP literals — to avoid the
 * parser-differential class of bypass.
 */
export function buildSeatbeltProfile(opts: { allowIps: string[]; allowDns: boolean }): string {
  const lines = [
    '(version 1)',
    '(allow default)',
    '(deny network-outbound)',
    '(allow network-outbound (remote ip "localhost:*"))',
    '(allow network-outbound (remote unix-socket))',
  ];
  if (opts.allowDns) lines.push('(allow network-outbound (remote ip "*:53"))');
  for (const ip of opts.allowIps) {
    lines.push(`(allow network-outbound (remote ip "${ip}:443"))`);
  }
  return lines.join('\n') + '\n';
}

export interface EgressWrap {
  command: string;
  args: string[];
}

/** Rewrite a spawn to run `command` under `sandbox-exec` with the given profile file. */
export function wrapWithEgress(command: string, args: string[], profilePath: string): EgressWrap {
  return { command: 'sandbox-exec', args: ['-f', profilePath, command, ...args] };
}

/** True if `sandbox-exec` is on PATH (used for the fail-closed start check). */
export function egressAvailable(): boolean {
  if (process.platform !== 'darwin') return false;
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    try {
      if (statSync(join(dir, 'sandbox-exec')).isFile()) return true;
    } catch {
      /* not here */
    }
  }
  return false;
}

/**
 * Probe whether the profile actually blocks/allows as intended (run on the box).
 * Returns the argv for a `sandbox-exec` probe of `url` — exit 0 means reachable.
 */
export function egressProbeArgv(profilePath: string, url: string): string[] {
  return ['-f', profilePath, 'curl', '-sS', '-m', '4', '-o', '/dev/null', url];
}

/** Run an egress probe under the profile. resolves to whether the URL was reachable. */
export function runEgressProbe(profilePath: string, url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('sandbox-exec', egressProbeArgv(profilePath, url), { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}
