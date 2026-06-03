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
