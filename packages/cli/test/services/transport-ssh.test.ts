// packages/cli/test/services/transport-ssh.test.ts
import { describe, it, expect, vi } from 'vitest';
import { makeSshTransport } from '../../src/services/transport-ssh.ts';

const target = { host: 'h', user: 'u', port: 22, keyPath: '/k' };

describe('makeSshTransport', () => {
  it('opens a reverse tunnel for the requested local/remote ports', () => {
    const kill = vi.fn();
    const spawnAdapter = vi.fn().mockReturnValue({ kill, on: vi.fn() });
    const t = makeSshTransport(target, spawnAdapter);
    const handle = t.open({ localPort: 5432, remotePort: 5432 }, () => {});
    expect(spawnAdapter).toHaveBeenCalledWith('ssh', expect.arrayContaining(['-R', '127.0.0.1:5432:127.0.0.1:5432']));
    handle.stop();
    expect(kill).toHaveBeenCalled();
  });

  it('forwards the ssh exit code to onClose', () => {
    let cb: ((c: number | null) => void) | undefined;
    const spawnAdapter = () => ({ kill: vi.fn(), on: (e: string, f: (c: number | null) => void) => { if (e === 'close') cb = f; } });
    const onClose = vi.fn();
    makeSshTransport(target, spawnAdapter as never).open({ localPort: 1, remotePort: 2 }, onClose);
    cb?.(255);
    expect(onClose).toHaveBeenCalledWith(255);
  });
});
