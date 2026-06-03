import { describe, it, expect } from 'vitest';
import {
  parseAdbDevices, selectAndroidDevice, selectAndroidPeer,
  tcpipArgs, connectCommand, buildBridgePlan,
} from '../../src/lib/device-bridge.ts';
import type { TailscalePeer } from '../../src/lib/tailscale.ts';

const peer = (over: Partial<TailscalePeer>): TailscalePeer => ({
  hostname: 'pixel', dnsName: 'pixel.tail-net.ts.net', ipv4: '100.1.2.3',
  os: 'android', online: true, isSelf: false, user: 'rebin', ...over,
});

describe('parseAdbDevices', () => {
  it('parses rows, skipping header and daemon chatter', () => {
    const out = parseAdbDevices('* daemon started *\nList of devices attached\nABC123\tdevice\nXYZ\tunauthorized\n\n');
    expect(out).toEqual([{ serial: 'ABC123', state: 'device' }, { serial: 'XYZ', state: 'unauthorized' }]);
  });
  it('returns [] for an empty list', () => {
    expect(parseAdbDevices('List of devices attached\n\n')).toEqual([]);
  });
});

describe('selectAndroidDevice', () => {
  it('picks the single authorized device', () => {
    expect(selectAndroidDevice([{ serial: 'A', state: 'device' }])).toEqual({ ok: true, value: { serial: 'A', state: 'device' } });
  });
  it('errors when none attached', () => {
    expect(selectAndroidDevice([]).ok).toBe(false);
  });
  it('errors with an unauthorized hint', () => {
    const r = selectAndroidDevice([{ serial: 'A', state: 'unauthorized' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/unauthor/i);
  });
  it('errors when multiple attached and no serial', () => {
    const r = selectAndroidDevice([{ serial: 'A', state: 'device' }, { serial: 'B', state: 'device' }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/--device/);
  });
  it('honors an explicit serial', () => {
    expect(selectAndroidDevice([{ serial: 'A', state: 'device' }, { serial: 'B', state: 'device' }], 'B'))
      .toMatchObject({ ok: true, value: { serial: 'B' } });
  });
});

describe('selectAndroidPeer', () => {
  it('picks the single online android peer', () => {
    expect(selectAndroidPeer([peer({}), peer({ hostname: 'mac', os: 'macOS' })]))
      .toMatchObject({ ok: true, value: { hostname: 'pixel' } });
  });
  it('errors when no android peer online', () => {
    expect(selectAndroidPeer([peer({ os: 'macOS' })]).ok).toBe(false);
  });
  it('errors when multiple android peers and no name', () => {
    const r = selectAndroidPeer([peer({ hostname: 'p1' }), peer({ hostname: 'p2' })]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/--name/);
  });
  it('matches by name', () => {
    expect(selectAndroidPeer([peer({ hostname: 'p1' }), peer({ hostname: 'p2' })], 'p2'))
      .toMatchObject({ ok: true, value: { hostname: 'p2' } });
  });
  it('ignores offline / ipv4-less peers', () => {
    expect(selectAndroidPeer([peer({ online: false })]).ok).toBe(false);
    expect(selectAndroidPeer([peer({ ipv4: '' })]).ok).toBe(false);
  });
});

describe('command builders + plan', () => {
  it('tcpipArgs', () => expect(tcpipArgs('A', 5555)).toEqual(['-s', 'A', 'tcpip', '5555']));
  it('connectCommand', () => expect(connectCommand('100.1.2.3', 5555)).toBe('adb connect 100.1.2.3:5555'));
  it('buildBridgePlan', () => {
    const plan = buildBridgePlan({ serial: 'A', state: 'device' }, peer({}), 5555);
    expect(plan.remoteConnect).toBe('adb connect 100.1.2.3:5555');
    expect(plan.flutterHint).toBe('flutter run -d 100.1.2.3:5555');
    expect(plan.warnings.some((w) => /Tailscale|ACL/i.test(w))).toBe(true);
    expect(plan.warnings.some((w) => /iOS/i.test(w))).toBe(true);
  });
});
