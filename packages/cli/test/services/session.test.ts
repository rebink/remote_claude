// packages/cli/test/services/session.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runServicesSession, type SessionIo } from '../../src/services/session.ts';
import type { DiscoveredService, Projection, ServiceProjectionManager } from '../../src/services/types.ts';

const svc: DiscoveredService = { id: 'docker:db:5432', label: 'Postgres', kind: 'docker', localPort: 5432, connectionHint: 'postgres://127.0.0.1:5432' };

function fakeIo() {
  let lineCb: (l: string) => void = () => {};
  let closeCb: () => void = () => {};
  const writes: unknown[] = [];
  const io: SessionIo = {
    onLine: (cb) => { lineCb = cb; },
    write: (o) => { writes.push(o); },
    onClose: (cb) => { closeCb = cb; },
  };
  return { io, writes, feed: (l: string) => lineCb(l), close: () => closeCb() };
}

function fakeManager(): ServiceProjectionManager & { changeCb?: (p: Projection[]) => void } {
  const m: any = {
    bind: vi.fn(async () => ({ service: svc, remotePort: 5432, mirrored: true, status: 'active' })),
    unbind: vi.fn(async () => {}),
    refresh: vi.fn(),
    retry: vi.fn(async () => {}),
    status: vi.fn(() => []),
    stopAll: vi.fn(),
    on: (_e: string, cb: (p: Projection[]) => void) => { m.changeCb = cb; },
  };
  return m;
}

describe('runServicesSession', () => {
  it('on discover: emits candidates and refreshes the manager', async () => {
    const { io, writes, feed } = fakeIo();
    const manager = fakeManager();
    const discover = vi.fn(async () => [svc]);
    runServicesSession(io, { manager, discover });
    feed(JSON.stringify({ cmd: 'discover' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(writes).toContainEqual({ type: 'candidates', services: [svc] });
    expect(manager.refresh).toHaveBeenCalledWith([svc]);
  });

  it('on bind: looks up the last-discovered candidate by id and binds it', async () => {
    const { io, feed } = fakeIo();
    const manager = fakeManager();
    runServicesSession(io, { manager, discover: async () => [svc] });
    feed(JSON.stringify({ cmd: 'discover' }));
    await new Promise((r) => setTimeout(r, 0));
    feed(JSON.stringify({ cmd: 'bind', id: 'docker:db:5432' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(manager.bind).toHaveBeenCalledWith(svc);
  });

  it('emits a status event when the manager changes, and writes the manifest', () => {
    const { io, writes } = fakeIo();
    const manager = fakeManager();
    const onManifest = vi.fn();
    runServicesSession(io, { manager, discover: async () => [], onManifest });
    const proj: Projection = { service: svc, remotePort: 5432, mirrored: true, status: 'active' };
    manager.changeCb!([proj]);
    expect(writes).toContainEqual({ type: 'status', projections: [proj] });
    expect(onManifest).toHaveBeenCalledWith([proj]);
  });

  it('emits an error for a malformed command line and keeps running', async () => {
    const { io, writes, feed } = fakeIo();
    const manager = fakeManager();
    runServicesSession(io, { manager, discover: async () => [] });
    feed('not json');
    await new Promise((r) => setTimeout(r, 0));
    expect(writes.some((w: any) => w.type === 'error')).toBe(true);
  });

  it('on close: stops all projections', () => {
    const { io, close } = fakeIo();
    const manager = fakeManager();
    runServicesSession(io, { manager, discover: async () => [] });
    close();
    expect(manager.stopAll).toHaveBeenCalled();
  });
});
