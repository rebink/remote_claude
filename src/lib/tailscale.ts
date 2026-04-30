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
