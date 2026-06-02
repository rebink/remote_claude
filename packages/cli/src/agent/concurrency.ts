import { Semaphore } from './semaphore.ts';

export interface ConcurrencyOptions {
  globalCap: number;
  perUserCap: number;
}

export interface Lease {
  readonly user: string;
  readonly acquiredAt: number;
  readonly queueWaitMs: number;
  /** Position in the *global* queue at the moment this request entered. 0 if it ran immediately. */
  readonly positionAtEntry: number;
}

export interface QueueSnapshotRow {
  user: string;
  position: number;
}

export interface QueueSnapshot {
  globalCap: number;
  perUserCap: number;
  inFlight: string[];        // usernames currently holding a slot
  queued: QueueSnapshotRow[]; // usernames waiting, in queue order
}

/**
 * Acquire order is (per-user → global). Per-user is typically the tighter
 * cap (often 1), so checking it first avoids holding a global slot while
 * waiting on per-user. Release order is the reverse: global → per-user.
 */
export class ConcurrencyManager {
  private global: Semaphore;
  private perUser = new Map<string, Semaphore>();
  // Tracks who is currently holding a slot, for snapshot().
  private inFlight = new Set<string>();
  // Tracks pending acquire calls in arrival order, for snapshot().
  private pending: { user: string; key: symbol }[] = [];

  constructor(public readonly opts: ConcurrencyOptions) {
    this.global = new Semaphore(opts.globalCap);
  }

  async acquire(
    user: string,
    onQueued?: (info: { position: number }) => void,
  ): Promise<Lease> {
    const start = Date.now();
    const perUserSem = this.getOrCreatePerUser(user);

    // Track pending so snapshot() can show it.
    const trackKey = Symbol('lease-pending');
    this.pending.push({ user, key: trackKey });

    try {
      // Acquire the per-user slot first. Use a token so we can act on the
      // immediate-grant case without yielding to a microtask: when the slot is
      // free the token is granted synchronously (positionOf === 0), letting
      // onQueued fire before acquire()'s first await.
      const perUserToken = perUserSem.acquireToken();
      if (perUserSem.positionOf(perUserToken) !== 0) {
        await perUserToken.promise;
      }

      // Per-user slot now held. Decide the global-queue position at entry before
      // awaiting the global slot, and fire the one-shot queued notification only
      // when we will actually wait on the global cap.
      const willWaitOnGlobal =
        this.global.available() === 0 || this.global.waiting() > 0;
      const positionAtEntrySnapshot = willWaitOnGlobal ? this.global.waiting() + 1 : 0;
      if (willWaitOnGlobal) onQueued?.({ position: positionAtEntrySnapshot });

      const globalAcquireStart = Date.now();
      await this.global.acquire();
      const globalWaitMs = Date.now() - globalAcquireStart;

      this.inFlight.add(user);
      const queueWaitMs = Date.now() - start;

      return {
        user,
        acquiredAt: Date.now(),
        queueWaitMs,
        // Report position only if we waited on global
        positionAtEntry: globalWaitMs > 0 ? positionAtEntrySnapshot : 0,
      };
    } finally {
      // Whether we succeeded or threw, remove the pending marker.
      const idx = this.pending.findIndex((p) => p.key === trackKey);
      if (idx !== -1) this.pending.splice(idx, 1);
    }
  }

  release(lease: Lease): void {
    this.inFlight.delete(lease.user);
    // Release global first, then per-user (reverse of acquire order).
    this.global.release();
    const sem = this.perUser.get(lease.user);
    if (sem) sem.release();
  }

  snapshot(): QueueSnapshot {
    return {
      globalCap: this.opts.globalCap,
      perUserCap: this.opts.perUserCap,
      inFlight: Array.from(this.inFlight),
      queued: this.pending.map((p, i) => ({ user: p.user, position: i + 1 })),
    };
  }

  private getOrCreatePerUser(user: string): Semaphore {
    let s = this.perUser.get(user);
    if (!s) {
      s = new Semaphore(this.opts.perUserCap);
      this.perUser.set(user, s);
    }
    return s;
  }
}
