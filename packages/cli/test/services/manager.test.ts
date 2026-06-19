// packages/cli/test/services/manager.test.ts
import { describe, it, expect, vi } from 'vitest';
import { makeManager } from '../../src/services/manager.ts';
import type { Transport, DiscoveredService } from '../../src/services/types.ts';

const svc: DiscoveredService = {
  id: 'docker:pw-db:5432', label: 'Postgres (pw-db)', kind: 'docker',
  localPort: 5432, connectionHint: 'postgres://127.0.0.1:5432',
};

function upTransport(): { transport: Transport; closes: ((c: number | null) => void)[] } {
  const closes: ((c: number | null) => void)[] = [];
  const transport: Transport = { open: (_o, cb) => { closes.push(cb); return { stop: vi.fn() }; } };
  return { transport, closes };
}

describe('makeManager', () => {
  const noWait = { probe: async () => {}, delay: async () => {} };

  it('binds a service and reports it active with same-port mirror', async () => {
    const { transport } = upTransport();
    const m = makeManager(transport, noWait);
    const p = await m.bind(svc);
    expect(p).toMatchObject({ remotePort: 5432, mirrored: true, status: 'active' });
    expect(m.status()).toHaveLength(1);
  });

  it('emits change on bind and unbind', async () => {
    const { transport } = upTransport();
    const m = makeManager(transport, noWait);
    const seen: number[] = [];
    m.on('change', (ps) => seen.push(ps.length));
    await m.bind(svc);
    await m.unbind(svc.id);
    expect(seen).toContain(1);
    expect(m.status()).toHaveLength(0);
  });

  it('reconnects when a tunnel closes unexpectedly', async () => {
    const { transport, closes } = upTransport();
    const openSpy = vi.spyOn(transport, 'open');
    const m = makeManager(transport, noWait);
    await m.bind(svc);
    const callsBefore = openSpy.mock.calls.length;
    closes[closes.length - 1](255); // simulate ssh drop
    await new Promise((r) => setTimeout(r, 0));
    expect(m.status()[0].status).toBe('active');
    expect(openSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('does not reconnect after unbind', async () => {
    const { transport, closes } = upTransport();
    const m = makeManager(transport, noWait);
    await m.bind(svc);
    const openSpy = vi.spyOn(transport, 'open');
    await m.unbind(svc.id);
    closes[closes.length - 1](0);
    await new Promise((r) => setTimeout(r, 0));
    expect(openSpy).not.toHaveBeenCalled();
  });
});
