import type { TailscalePeer } from './tailscale.ts';

export interface AdbDevice {
  serial: string;
  /** 'device' (authorized) | 'unauthorized' | 'offline' | … */
  state: string;
}

export type Selection<T> = { ok: true; value: T } | { ok: false; error: string };

/** Parse `adb devices` stdout into rows, skipping the header and daemon chatter. */
export function parseAdbDevices(stdout: string): AdbDevice[] {
  const out: AdbDevice[] = [];
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('List of devices') || t.startsWith('*')) continue;
    const parts = t.split(/\s+/);
    if (parts.length < 2) continue;
    out.push({ serial: parts[0], state: parts[1] });
  }
  return out;
}

/** Choose exactly one authorized Android device, honoring an optional serial. */
export function selectAndroidDevice(devices: AdbDevice[], serial?: string): Selection<AdbDevice> {
  if (serial) {
    const d = devices.find((x) => x.serial === serial);
    if (!d) return { ok: false, error: `no device with serial '${serial}' is attached` };
    if (d.state !== 'device') {
      return { ok: false, error: `device '${serial}' is '${d.state}' — unlock the phone and accept the USB-debugging prompt` };
    }
    return { ok: true, value: d };
  }
  const authorized = devices.filter((d) => d.state === 'device');
  if (authorized.length === 0) {
    const unauth = devices.find((d) => d.state === 'unauthorized');
    if (unauth) return { ok: false, error: `device '${unauth.serial}' is unauthorized — accept the USB-debugging prompt on the phone` };
    return { ok: false, error: 'no Android device attached over USB' };
  }
  if (authorized.length > 1) {
    return { ok: false, error: `multiple devices attached (${authorized.map((d) => d.serial).join(', ')}) — pass --device <serial>` };
  }
  return { ok: true, value: authorized[0] };
}

/** Choose the phone's online Tailscale peer (an Android peer, or one matched by name). */
export function selectAndroidPeer(peers: TailscalePeer[], name?: string): Selection<TailscalePeer> {
  const online = peers.filter((p) => p.online && p.ipv4);
  if (name) {
    const p = online.find((x) => x.hostname === name || x.dnsName === name || x.dnsName.startsWith(name + '.'));
    if (!p) return { ok: false, error: `no online Tailscale peer named '${name}' (with an IPv4) found` };
    return { ok: true, value: p };
  }
  const androids = online.filter((p) => /android/i.test(p.os));
  if (androids.length === 0) {
    return { ok: false, error: 'no online Android peer found on your tailnet — put the phone on Tailscale, or pass --name <peer>' };
  }
  if (androids.length > 1) {
    return { ok: false, error: `multiple Android peers online (${androids.map((p) => p.hostname).join(', ')}) — pass --name <peer>` };
  }
  return { ok: true, value: androids[0] };
}

export function tcpipArgs(serial: string, port: number): string[] {
  return ['-s', serial, 'tcpip', String(port)];
}

export function connectCommand(host: string, port: number): string {
  return `adb connect ${host}:${port}`;
}

export interface BridgePlan {
  remoteConnect: string;
  flutterHint: string;
  warnings: string[];
}

export function buildBridgePlan(device: AdbDevice, peer: TailscalePeer, port: number): BridgePlan {
  const target = `${peer.ipv4}:${port}`;
  return {
    remoteConnect: connectCommand(peer.ipv4, port),
    flutterHint: `flutter run -d ${target}`,
    warnings: [
      `Lock down port ${port} with a Tailscale ACL so only your remote host can reach the phone.`,
      'tcpip mode resets when the phone reboots — re-run `patchwire device connect` over USB afterwards.',
      'Android only: iOS real-device debugging needs a Mac and is not bridged.',
    ],
  };
}
