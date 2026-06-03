# Android Device Bridge Implementation Plan (`patchwire device`)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkboxes (`- [ ]`). TDD for the pure core and the dep-injected command.

**Goal:** `patchwire device doctor` + `patchwire device connect` — guide an Android phone onto the remote Flutter toolchain over Tailscale by running the safe local `adb` steps and PRINTING the exact remote `adb connect` command. Android only; prints, never SSH-executes.

**Architecture:** Pure `lib/device-bridge.ts` (parse/select/build) + a `commands/device.ts` command group that takes **injectable deps** (`runAdb`, `tailscaleStatus`) so orchestration is unit-tested without hardware. Reuses the existing `lib/tailscale.ts`.

**Tech Stack:** TypeScript ESM, commander, vitest. Package `patchwire` (`packages/cli`, the laptop binary `cli.ts`).

**Source spec:** `docs/superpowers/specs/2026-06-03-device-bridge-design.md`

**Honesty note:** CI covers only the pure logic + faked-dep orchestration. The live phone loop is hardware-verified by the user.

---

## Task 0: Branch + baseline
- [ ] `cd /Users/apple/Documents/Workspace/patchwire && git checkout main && git checkout -b feat/device-bridge`
- [ ] `pnpm --filter patchwire test` → green baseline. If red, STOP.

---

## Task 1: Pure core `lib/device-bridge.ts` (TDD)

**Files:** Create `packages/cli/src/lib/device-bridge.ts`, `packages/cli/test/lib/device-bridge.test.ts`

- [ ] **Step 1: Failing test `packages/cli/test/lib/device-bridge.test.ts`:**
```ts
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
```

- [ ] **Step 2:** `pnpm --filter patchwire test device-bridge` → FAIL (module missing).

- [ ] **Step 3: Create `packages/cli/src/lib/device-bridge.ts`:**
```ts
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
```

- [ ] **Step 4:** `pnpm --filter patchwire test device-bridge` → PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/cli/src/lib/device-bridge.ts packages/cli/test/lib/device-bridge.test.ts
git commit -m "feat(cli): device-bridge pure core (adb/tailscale parse, select, command builders)"
```

---

## Task 2: `device` command group + wiring (TDD with faked deps)

**Files:** Create `packages/cli/src/commands/device.ts`, `packages/cli/test/commands/device.test.ts`; Modify `packages/cli/src/cli.ts`

- [ ] **Step 1: Failing test `packages/cli/test/commands/device.test.ts`:**
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { registerDeviceCommands, type DeviceDeps } from '../../src/commands/device.ts';
import type { TailscaleStatus } from '../../src/lib/tailscale.ts';

function tsStatus(over: Partial<TailscaleStatus> = {}): TailscaleStatus {
  return {
    installed: true, running: true,
    peers: [{ hostname: 'pixel', dnsName: 'pixel.ts.net', ipv4: '100.9.9.9', os: 'android', online: true, isSelf: false, user: 'r' }],
    ...over,
  };
}
function makeDeps(over: Partial<DeviceDeps> = {}): DeviceDeps {
  return {
    runAdb: (args) => args[0] === 'devices'
      ? { stdout: 'List of devices attached\nSER1\tdevice\n', status: 0 }
      : { stdout: '', status: 0 },
    tailscaleStatus: () => tsStatus(),
    ...over,
  };
}

describe('patchwire device', () => {
  let out: string[];
  let outSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    out = [];
    outSpy = vi.spyOn(process.stdout, 'write').mockImplementation((c) => { out.push(String(c)); return true; });
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit:${code}`); }) as never);
  });
  afterEach(() => { outSpy.mockRestore(); exitSpy.mockRestore(); });

  function run(argv: string[], deps: DeviceDeps): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerDeviceCommands(program, deps);
    return program.parseAsync(['node', 'patchwire', 'device', ...argv]);
  }

  it('connect prints the remote adb connect + flutter hint for the phone peer', async () => {
    await run(['connect'], makeDeps());
    const text = out.join('');
    expect(text).toContain('adb connect 100.9.9.9:5555');
    expect(text).toContain('flutter run -d 100.9.9.9:5555');
  });

  it('connect honors --port', async () => {
    await run(['connect', '--port', '5599'], makeDeps());
    expect(out.join('')).toContain('adb connect 100.9.9.9:5599');
  });

  it('connect exits (2) when no device is attached', async () => {
    const deps = makeDeps({ runAdb: (a) => a[0] === 'devices' ? { stdout: 'List of devices attached\n', status: 0 } : { stdout: '', status: 0 } });
    await expect(run(['connect'], deps)).rejects.toThrow(/exit:2/);
  });

  it('connect exits (3) when no android peer is online', async () => {
    await expect(run(['connect'], makeDeps({ tailscaleStatus: () => tsStatus({ peers: [] }) }))).rejects.toThrow(/exit:3/);
  });

  it('doctor runs the checks without exiting', async () => {
    await run(['doctor'], makeDeps());
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2:** `pnpm --filter patchwire test commands/device` → FAIL (module missing).

- [ ] **Step 3: Create `packages/cli/src/commands/device.ts`:**
```ts
import { spawnSync } from 'node:child_process';
import type { Command } from 'commander';
import { tailscaleStatus, type TailscaleStatus } from '../lib/tailscale.ts';
import {
  parseAdbDevices, selectAndroidDevice, selectAndroidPeer, tcpipArgs, buildBridgePlan,
} from '../lib/device-bridge.ts';
import { log } from '../lib/log.ts';

export interface DeviceDeps {
  runAdb(args: string[]): { stdout: string; status: number };
  tailscaleStatus(): TailscaleStatus;
}

const realDeps: DeviceDeps = {
  runAdb(args) {
    const r = spawnSync('adb', args, { encoding: 'utf8' });
    return { stdout: r.stdout ?? '', status: r.status ?? 1 };
  },
  tailscaleStatus,
};

export function registerDeviceCommands(program: Command, deps: DeviceDeps = realDeps): void {
  const device = program
    .command('device')
    .description('Bridge a local Android device to the remote Flutter toolchain over Tailscale (Android only)');

  device
    .command('doctor')
    .description('Check adb, Tailscale, and a connected Android device.')
    .action(() => {
      const adb = deps.runAdb(['version']);
      if (adb.status === 0) log.ok('adb found');
      else log.err('adb NOT found (install Android platform-tools)');

      const ts = deps.tailscaleStatus();
      if (ts.running) log.ok('tailscale running');
      else log.err('tailscale NOT running');

      const sel = selectAndroidDevice(parseAdbDevices(deps.runAdb(['devices']).stdout));
      if (sel.ok) log.ok(`device: ${sel.value.serial}`);
      else log.err(sel.error);
    });

  device
    .command('connect')
    .description('Put the phone in TCP mode and print the remote `adb connect` command.')
    .option('--device <serial>', 'choose a specific device (when several are attached)')
    .option('--name <peer>', 'choose a specific Tailscale peer (the phone)')
    .option('--port <n>', 'adb tcpip port', (v: string) => Number(v), 5555)
    .action((opts: { device?: string; name?: string; port: number }) => {
      const port = opts.port;
      const dev = selectAndroidDevice(parseAdbDevices(deps.runAdb(['devices']).stdout), opts.device);
      if (!dev.ok) { log.err(dev.error); process.exit(2); }

      const tcp = deps.runAdb(tcpipArgs(dev.value.serial, port));
      if (tcp.status !== 0) { log.err('adb tcpip failed — is the phone connected over USB?'); process.exit(2); }

      const peer = selectAndroidPeer(deps.tailscaleStatus().peers, opts.name);
      if (!peer.ok) { log.err(peer.error); process.exit(3); }

      const plan = buildBridgePlan(dev.value, peer.value, port);
      process.stdout.write(
        `\nPhone '${dev.value.serial}' is in TCP mode; phone peer ${peer.value.hostname} (${peer.value.ipv4}).\n\n` +
        `On the remote host, run:\n  ${plan.remoteConnect}\n\n` +
        `then build to the phone with:\n  ${plan.flutterHint}\n\n` +
        plan.warnings.map((w) => `  ! ${w}`).join('\n') + '\n',
      );
    });
}
```
Note: after `if (!dev.ok) { …; process.exit(2); }`, TypeScript narrows `dev` to the `ok` branch because `process.exit` returns `never`. Same for `peer`. (`log` provides `.ok`/`.err` — same as `commands/daemon.ts`. If the exact method names differ, match whatever `lib/log.ts` exports.)

- [ ] **Step 4: Wire into `packages/cli/src/cli.ts`.** Add with the imports:
```ts
import { registerDeviceCommands } from './commands/device.ts';
```
And immediately before `program.parseAsync(process.argv)` at the bottom, add:
```ts
registerDeviceCommands(program);
```

- [ ] **Step 5:** `pnpm --filter patchwire test commands/device` → PASS. Then `pnpm --filter patchwire typecheck` → exit 0 (confirms the `never`-narrowing and log methods).

- [ ] **Step 6: Commit**
```bash
git add packages/cli/src/commands/device.ts packages/cli/test/commands/device.test.ts packages/cli/src/cli.ts
git commit -m "feat(cli): patchwire device doctor + connect (guided adb-over-Tailscale bridge)"
```

---

## Task 3: Runbook doc

**Files:** Create `docs/device-bridge.md`

- [ ] **Step 1: Write `docs/device-bridge.md`:**
```markdown
# Android device bridge (`patchwire device`)

Run your Flutter build on the remote toolchain but deploy + hot-reload to the
Android phone in your hand, over Tailscale. **Android only** — iOS real-device
debugging needs a Mac and is not bridged.

## Prerequisites
- `adb` (Android platform-tools) on your laptop.
- The phone on your Tailscale tailnet (Tailscale app, logged into the same tailnet).
- The phone connected to the laptop over **USB** for the one-time switch to TCP mode.
- USB debugging enabled + authorized (accept the prompt on the phone).

## Use
```
patchwire device doctor     # verify adb, tailscale, and an authorized phone
patchwire device connect    # switch the phone to TCP mode + print the remote command
```
`connect` prints an `adb connect <phone-tailscale-ip>:5555` line to run **on the
remote host**, then `flutter run -d <phone-tailscale-ip>:5555` builds to the phone
with USB-equivalent hot reload + breakpoints.

Flags: `--device <serial>` (multiple phones attached), `--name <peer>` (pick the
Tailscale peer), `--port <n>` (default 5555).

## Security — required
adb-over-TCP has **no authentication**. Restrict the adb port to your remote host
with a Tailscale ACL, e.g.:
```jsonc
// tailnet policy (Access Controls)
{
  "acls": [
    { "action": "accept", "src": ["<remote-host>"], "dst": ["<phone>:5555"] }
  ]
}
```
Without an ACL, any tailnet device could drive the phone's adb.

## Caveats
- `tcpip` mode resets when the phone reboots — re-run `patchwire device connect`
  over USB afterwards.
- TCP adb is slower / less stable than a cable; prefer USB when co-located.
- The device loop is per-developer-per-device — it cannot be pooled on one shared box.
```

- [ ] **Step 2: Commit**
```bash
git add docs/device-bridge.md
git commit -m "docs: Android device-bridge runbook + Tailscale ACL guidance"
```

---

## Task 4: Verification

- [ ] **Step 1:** `pnpm --filter patchwire typecheck` → exit 0.
- [ ] **Step 2:** `pnpm --filter patchwire test` → all pass (new: device-bridge, commands/device; nothing regressed).
- [ ] **Step 3:** `pnpm --filter patchwire build` → exit 0.
- [ ] **Step 4:** Help smoke:
```bash
node packages/cli/dist/cli.js device --help        # lists 'doctor' and 'connect'
node packages/cli/dist/cli.js device connect --help # shows --device/--name/--port
```

---

## Self-review (plan author)
- **Spec coverage:** pure parse/select/build + tests → T1; `doctor` + `connect` with injectable deps + faked-dep tests (happy path, --port, no-device exit 2, no-peer exit 3, doctor) → T2; wiring → T2 Step 4; runbook + ACL guidance → T3; verify + help → T4. Android-only + print-not-execute honored; no SSH/agent surface.
- **Placeholder scan:** none — full code/text in every step.
- **Type/name consistency:** `Selection<T>` (not the built-in `Pick`); `parseAdbDevices`/`selectAndroidDevice`/`selectAndroidPeer`/`tcpipArgs`/`connectCommand`/`buildBridgePlan`/`registerDeviceCommands`/`DeviceDeps` consistent across module, tests, command, wiring. Reuses `TailscalePeer`/`TailscaleStatus`/`tailscaleStatus` from `lib/tailscale.ts` (verified exports). `log.ok`/`log.err` per `commands/daemon.ts`.
```
