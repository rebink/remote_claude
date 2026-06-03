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
