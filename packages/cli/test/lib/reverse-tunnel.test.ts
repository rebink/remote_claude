// packages/cli/test/lib/reverse-tunnel.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildReverseTunnelArgs, openReverseTunnel } from '../../src/lib/reverse-tunnel.ts';

const ssh = { host: 'h.example', user: 'admin', port: 22, keyPath: '/k' };

describe('buildReverseTunnelArgs', () => {
  it('binds the remote listener to loopback and forwards to the local port', () => {
    expect(buildReverseTunnelArgs({ ...ssh, remotePort: 9123, localPort: 50123 })).toEqual([
      '-i', '/k', '-p', '22',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'BatchMode=yes',
      '-o', 'ExitOnForwardFailure=yes',
      '-N', '-R', '127.0.0.1:9123:127.0.0.1:50123',
      'admin@h.example',
    ]);
  });

  it('omits -i entirely when keyPath is empty (falls back to SSH agent / default identities)', () => {
    const args = buildReverseTunnelArgs({ ...ssh, keyPath: '', remotePort: 9123, localPort: 50123 });
    expect(args).not.toContain('-i');
    expect(args).toContain('-R');
    expect(args).toContain('127.0.0.1:9123:127.0.0.1:50123');
    expect(args).toContain('admin@h.example');
  });
});

describe('openReverseTunnel', () => {
  it('spawns ssh with the built args and stop() kills the child', () => {
    const kill = vi.fn();
    const spawnAdapter = vi.fn().mockReturnValue({ kill, on: vi.fn() });
    const handle = openReverseTunnel({ ...ssh, remotePort: 9123, localPort: 50123 }, spawnAdapter);
    expect(spawnAdapter).toHaveBeenCalledWith('ssh', expect.arrayContaining(['-R', '127.0.0.1:9123:127.0.0.1:50123']));
    handle.stop();
    expect(kill).toHaveBeenCalled();
  });

  it('invokes onExit when the child closes', () => {
    let closeCb: ((code: number | null) => void) | undefined;
    const child = { kill: vi.fn(), on: (ev: string, cb: (c: number | null) => void) => { if (ev === 'close') closeCb = cb; } };
    const onExit = vi.fn();
    openReverseTunnel({ ...ssh, remotePort: 9123, localPort: 50123 }, () => child as never, onExit);
    closeCb?.(1);
    expect(onExit).toHaveBeenCalledWith(1);
  });
});
