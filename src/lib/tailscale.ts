import { spawnSync } from 'node:child_process';

export interface TailscalePeer {
  hostname: string;
  /** "host.tailnet-foo.ts.net" — preferred for stability */
  dnsName: string;
  /** first IPv4 in TailscaleIPs */
  ipv4: string;
  os: string;
  online: boolean;
  isSelf: boolean;
  user: string;
}

export interface TailscaleStatus {
  installed: boolean;
  /** logged in / running */
  running: boolean;
  self?: TailscalePeer;
  peers: TailscalePeer[];
  rawError?: string;
}

interface RawPeer {
  HostName: string;
  DNSName: string;
  TailscaleIPs?: string[];
  OS: string;
  Online: boolean;
  UserID: number;
}
interface RawStatus {
  BackendState?: string;
  Self?: RawPeer;
  Peer?: Record<string, RawPeer>;
  User?: Record<string, { LoginName?: string }>;
}

export function tailscaleStatus(): TailscaleStatus {
  const r = spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8', timeout: 5000 });
  if (r.error || r.status === null) {
    return { installed: false, running: false, peers: [], rawError: r.error?.message };
  }
  if (r.status !== 0) {
    return { installed: true, running: false, peers: [], rawError: r.stderr };
  }
  let parsed: RawStatus;
  try {
    parsed = JSON.parse(r.stdout) as RawStatus;
  } catch (err) {
    return { installed: true, running: false, peers: [], rawError: (err as Error).message };
  }

  const running = parsed.BackendState === 'Running';
  const users = parsed.User ?? {};
  const toPeer = (raw: RawPeer, isSelf: boolean): TailscalePeer => ({
    hostname: raw.HostName,
    dnsName: raw.DNSName.replace(/\.$/, ''),
    ipv4: raw.TailscaleIPs?.find((ip) => ip.includes('.')) ?? '',
    os: raw.OS,
    online: raw.Online,
    isSelf,
    user: users[String(raw.UserID)]?.LoginName ?? '',
  });

  const self = parsed.Self ? toPeer(parsed.Self, true) : undefined;
  const peers = Object.values(parsed.Peer ?? {}).map((p) => toPeer(p, false));
  return { installed: true, running, self, peers };
}

/**
 * Compact peer shape consumed by the VS Code extension's setup wizard
 * (via `remote-claude setup --list-peers --json`). Intentionally distinct
 * from {@link TailscalePeer}: only the fields the wizard needs.
 */
export interface PeerInfo {
  hostname: string;
  /** Magic DNS name (preferred) or first IP — what you'd SSH to. */
  host: string;
  online: boolean;
  /** ISO 8601 LastSeen from `tailscale status --json`, or '' if absent. */
  lastSeen: string;
}

/**
 * Returns the list of Tailscale peers in a compact, machine-readable shape.
 * Used by the VS Code extension's setup wizard. Returns [] on any error
 * (tailscale missing, not running, malformed JSON, etc.) — the caller is
 * expected to treat empty as "no peers available" rather than "error".
 */
export async function getPeers(): Promise<PeerInfo[]> {
  const r = spawnSync('tailscale', ['status', '--json'], { encoding: 'utf8', timeout: 5000 });
  if (r.error || r.status === null || r.status !== 0) return [];
  let parsed: RawStatus & { Peer?: Record<string, RawPeer & { LastSeen?: string }> };
  try {
    parsed = JSON.parse(r.stdout) as typeof parsed;
  } catch {
    return [];
  }
  const out: PeerInfo[] = [];
  const rawPeers = parsed.Peer ?? {};
  for (const id in rawPeers) {
    const p = rawPeers[id];
    if (!p) continue;
    const dns = p.DNSName?.replace(/\.$/, '') ?? '';
    const ip = p.TailscaleIPs?.find((x) => x.includes('.')) ?? '';
    out.push({
      hostname: p.HostName,
      host: dns || ip || p.HostName,
      online: !!p.Online,
      lastSeen: p.LastSeen ?? '',
    });
  }
  return out;
}
