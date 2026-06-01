import { describe, it, expect } from 'vitest';
import { ConcurrencyManager } from '../../src/agent/concurrency.ts';

describe('ConcurrencyManager', () => {
  it('allows immediate acquire when both caps have slots', async () => {
    const m = new ConcurrencyManager({ globalCap: 2, perUserCap: 1 });
    const lease = await m.acquire('alice');
    expect(lease.queueWaitMs).toBeLessThan(5);
    expect(lease.positionAtEntry).toBe(0);
    m.release(lease);
    expect(m.snapshot().inFlight).toEqual([]);
  });

  it('global cap serializes requests across users', async () => {
    const m = new ConcurrencyManager({ globalCap: 1, perUserCap: 5 });
    const a = await m.acquire('alice');
    const bP = m.acquire('bob');
    // Bob is queued behind Alice on the global cap
    expect(m.snapshot().queued.some((q) => q.user === 'bob')).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 5));
    m.release(a);
    const b = await bP;
    expect(b.queueWaitMs).toBeGreaterThanOrEqual(0);
    expect(b.positionAtEntry).toBe(1);
    m.release(b);
  });

  it('per-user cap serializes the same user even when global has slots', async () => {
    const m = new ConcurrencyManager({ globalCap: 10, perUserCap: 1 });
    const a1 = await m.acquire('alice');
    const a2P = m.acquire('alice');
    // a2 is queued on per-user, not global
    expect(m.snapshot().queued.some((q) => q.user === 'alice')).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 5));
    m.release(a1);
    const a2 = await a2P;
    expect(a2.queueWaitMs).toBeGreaterThanOrEqual(0);
    m.release(a2);
  });

  it('FIFO across users on the global queue', async () => {
    const m = new ConcurrencyManager({ globalCap: 1, perUserCap: 1 });
    const held = await m.acquire('alice');
    const order: string[] = [];
    const bP = m.acquire('bob').then((l) => { order.push('bob'); return l; });
    const cP = m.acquire('carol').then((l) => { order.push('carol'); return l; });
    m.release(held);
    const b = await bP;
    expect(order).toEqual(['bob']);
    m.release(b);
    const c = await cP;
    expect(order).toEqual(['bob', 'carol']);
    m.release(c);
  });

  it('snapshot reports inFlight, queued, and the caps', async () => {
    const m = new ConcurrencyManager({ globalCap: 2, perUserCap: 1 });
    const a = await m.acquire('alice');
    const b = await m.acquire('bob');
    const cP = m.acquire('carol');
    const snap = m.snapshot();
    expect(snap.globalCap).toBe(2);
    expect(snap.perUserCap).toBe(1);
    expect(snap.inFlight.sort()).toEqual(['alice', 'bob']);
    expect(snap.queued.map((q) => q.user)).toEqual(['carol']);
    expect(snap.queued[0].position).toBe(1);
    m.release(a);
    await cP;
    m.release(b);
    const c = await cP;
    m.release(c);
  });

  it('lease.user is set so release can free both caps without bookkeeping at the call site', async () => {
    const m = new ConcurrencyManager({ globalCap: 1, perUserCap: 1 });
    const a = await m.acquire('alice');
    expect(a.user).toBe('alice');
    m.release(a);
    // Alice can immediately acquire again
    const a2 = await m.acquire('alice');
    m.release(a2);
  });
});
