// packages/cli/test/services/mirror.test.ts
import { describe, it, expect, vi } from 'vitest';
import { candidateRemotePorts, firstStablePort } from '../../src/services/mirror.ts';
import type { Transport, TunnelHandle } from '../../src/services/types.ts';

describe('candidateRemotePorts', () => {
  it('puts the local port first, then distinct fallbacks', () => {
    const c = candidateRemotePorts(5432, 3);
    expect(c[0]).toBe(5432);
    expect(c).toHaveLength(3);
    expect(new Set(c).size).toBe(3);
  });
});

describe('firstStablePort', () => {
  const noWait = async () => {};

  it('mirrors the local port when its tunnel stays open', async () => {
    const open = vi.fn((_o, _cb) => ({ stop: vi.fn() }) as TunnelHandle);
    const transport: Transport = { open };
    const r = await firstStablePort(transport, 5432, { probe: noWait });
    expect(r).toMatchObject({ remotePort: 5432, mirrored: true });
  });

  it('falls back to the next candidate when the first port is taken', async () => {
    const transport: Transport = {
      open: vi.fn((o, cb) => {
        if (o.remotePort === 5432) queueMicrotask(() => cb(255)); // ExitOnForwardFailure
        return { stop: vi.fn() } as TunnelHandle;
      }),
    };
    const r = await firstStablePort(transport, 5432, { probe: noWait });
    expect(r.remotePort).not.toBe(5432);
    expect(r.mirrored).toBe(false);
  });

  it('throws when every candidate is taken', async () => {
    const transport: Transport = { open: (o, cb) => { queueMicrotask(() => cb(255)); return { stop: () => {} }; } };
    await expect(firstStablePort(transport, 5432, { probe: noWait, candidates: 2 })).rejects.toThrow(/no free remote port/);
  });
});
