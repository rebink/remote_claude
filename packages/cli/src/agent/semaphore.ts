export interface AcquireToken {
  /** Promise that resolves when this token's slot is granted. */
  promise: Promise<void>;
  /** Internal marker (used by positionOf to find the token in the waiter queue). */
  readonly key: symbol;
}

/**
 * Bounded FIFO semaphore. Single-process, in-memory only.
 *
 * `release()` either hands the slot directly to the head of the waiter queue
 * (without incrementing available slots) or returns a slot to the pool if no
 * one is waiting. This invariant is what keeps the cap firm under load.
 */
export class Semaphore {
  private slots: number;
  private waiters: AcquireToken[] = [];
  private resolvers = new Map<symbol, () => void>();

  constructor(capacity: number) {
    if (!Number.isInteger(capacity)) {
      throw new Error(`Semaphore capacity must be an integer (got ${capacity})`);
    }
    if (capacity < 1) {
      throw new Error(`Semaphore capacity must be >= 1 (got ${capacity})`);
    }
    this.slots = capacity;
  }

  available(): number { return this.slots; }
  waiting(): number { return this.waiters.length; }

  /** Convenience: acquire and discard the token (callers that just await). */
  async acquire(): Promise<void> {
    await this.acquireToken().promise;
  }

  /**
   * Acquire a slot, returning a token whose `promise` resolves when the slot
   * is granted. Use the token with `positionOf` to inspect queue position.
   */
  acquireToken(): AcquireToken {
    const key = Symbol('sema-waiter');
    if (this.slots > 0 && this.waiters.length === 0) {
      this.slots--;
      return { key, promise: Promise.resolve() };
    }
    const promise = new Promise<void>((resolve) => {
      this.resolvers.set(key, resolve);
    });
    const token: AcquireToken = { key, promise };
    this.waiters.push(token);
    return token;
  }

  release(): void {
    const next = this.waiters.shift();
    if (next) {
      const resolve = this.resolvers.get(next.key);
      this.resolvers.delete(next.key);
      resolve!();
      return;
    }
    this.slots++;
  }

  /** 1-indexed position of a still-pending token, or 0 if it has resolved / is unknown. */
  positionOf(key: symbol | AcquireToken): number {
    const k = typeof key === 'symbol' ? key : key.key;
    const idx = this.waiters.findIndex((w) => w.key === k);
    return idx === -1 ? 0 : idx + 1;
  }
}
