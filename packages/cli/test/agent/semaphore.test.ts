import { describe, it, expect } from 'vitest';
import { Semaphore } from '../../src/agent/semaphore.ts';

describe('Semaphore', () => {
  it('allows immediate acquire when slots are available', async () => {
    const s = new Semaphore(2);
    await s.acquire();
    await s.acquire();
    expect(s.available()).toBe(0);
    expect(s.waiting()).toBe(0);
  });

  it('queues waiters in FIFO order when no slots are available', async () => {
    const s = new Semaphore(1);
    await s.acquire();
    const order: number[] = [];
    const p1 = s.acquire().then(() => order.push(1));
    const p2 = s.acquire().then(() => order.push(2));
    const p3 = s.acquire().then(() => order.push(3));
    expect(s.waiting()).toBe(3);
    s.release();
    await p1;
    expect(order).toEqual([1]);
    s.release();
    await p2;
    expect(order).toEqual([1, 2]);
    s.release();
    await p3;
    expect(order).toEqual([1, 2, 3]);
  });

  it('release without waiters restores a slot', async () => {
    const s = new Semaphore(2);
    await s.acquire();
    expect(s.available()).toBe(1);
    s.release();
    expect(s.available()).toBe(2);
  });

  it('release with waiters hands the slot to the next waiter (does not increment available)', async () => {
    const s = new Semaphore(1);
    await s.acquire();
    const p = s.acquire();
    s.release();
    await p;
    // The slot was handed to the waiter, not returned to the pool.
    expect(s.available()).toBe(0);
    expect(s.waiting()).toBe(0);
  });

  it('positionOf returns the 1-indexed position of a pending waiter, or 0 if none', async () => {
    const s = new Semaphore(1);
    await s.acquire();
    const t1 = s.acquireToken();
    const t2 = s.acquireToken();
    expect(s.positionOf(t1)).toBe(1);
    expect(s.positionOf(t2)).toBe(2);
    // Bogus token
    expect(s.positionOf(Symbol('nope'))).toBe(0);
    s.release();
    await t1.promise;
    expect(s.positionOf(t1)).toBe(0); // resolved → no longer pending
    expect(s.positionOf(t2)).toBe(1);
    s.release();
    await t2.promise;
  });

  it('rejects construction with non-positive capacity', () => {
    expect(() => new Semaphore(0)).toThrow(/capacity/);
    expect(() => new Semaphore(-1)).toThrow(/capacity/);
    expect(() => new Semaphore(1.5)).toThrow(/integer/);
  });
});
