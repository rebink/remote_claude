# Phase 3: Concurrency + per-user queue — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded, FIFO concurrency model to the agent so that simultaneous `/ask` / `/chat` requests from N developers don't melt the box. A global cap limits total in-flight Claude runs; a per-user cap prevents any single developer from hogging all slots. Requests that exceed either cap wait in line, then run in arrival order.

**Architecture:** A new `Semaphore` primitive (slot count + FIFO waiter queue) is composed into a `ConcurrencyManager` that owns one global semaphore (`max_total`, default 3) and a lazy `Map<user, Semaphore>` (`max_per_user`, default 1). The Fastify handlers for `/ask` and `/chat` acquire (per-user first, then global — see Task 2 rationale), do their work, and release. The response carries `X-Patchwire-Queue-Wait-Ms` (always) and `X-Patchwire-Queue-Position-At-Entry` (only when the request actually waited). A new `GET /queue` route exposes a read-only snapshot: in-flight users, queued counts per user, and the configured caps.

**Tech Stack:** TypeScript, Node 20+, Fastify 4, Vitest 2. No new dependencies — Semaphore is a pure-TS class.

**Spec reference:** `docs/superpowers/specs/2026-06-01-multi-developer-agent-design.md` (sections 4.3, 5.3, 6.1 step 3, 11 phase 3).

**Out of scope for this phase** (later plans):
- JSONL audit log — phase 4
- SSE protocol on `/ask` — phase 5 (which replaces the header-based queue position with a streamed `queued` event)
- Admin panel — phase 6

---

## File Structure

**New files:**
- `packages/cli/src/agent/semaphore.ts` — `Semaphore` class (slot count + FIFO waiter queue)
- `packages/cli/src/agent/concurrency.ts` — `ConcurrencyManager` composing global + per-user semaphores
- `packages/cli/test/agent/semaphore.test.ts`
- `packages/cli/test/agent/concurrency.test.ts`
- `packages/cli/test/integration/concurrency.e2e.test.ts`

**Modified files:**
- `packages/cli/src/agent/server.ts` — `AgentOptions` gains `concurrency`; `/ask` + `/chat` acquire/release around the work; new `GET /queue` route; response headers on /ask
- `packages/cli/src/agent.ts` — `runServe` reads `PW_MAX_CONCURRENT_TOTAL` and `PW_MAX_CONCURRENT_PER_USER` env vars, constructs the manager
- `packages/website/src/content/docs/configuration.md` — document the two new env vars
- `packages/website/src/content/docs/agent.md` — note the queue + caps + `/queue` endpoint

---

## Task 1: `Semaphore` primitive (`src/agent/semaphore.ts`)

A tiny, dependency-free FIFO semaphore. `acquire()` returns a Promise that resolves when a slot is available; `release()` either restores a slot or hands it directly to the next waiter.

**Files:**
- Create: `packages/cli/src/agent/semaphore.ts`
- Test: `packages/cli/test/agent/semaphore.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/agent/semaphore.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/cli && pnpm vitest run test/agent/semaphore.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/cli/src/agent/semaphore.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/cli && pnpm vitest run test/agent/semaphore.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/semaphore.ts packages/cli/test/agent/semaphore.test.ts
git commit -m "feat(agent): FIFO Semaphore primitive for concurrency control"
```

---

## Task 2: `ConcurrencyManager` (`src/agent/concurrency.ts`)

Composes a global `Semaphore` and a `Map<user, Semaphore>`. The `acquire(user)` method takes both slots in this order:

1. **Per-user first.** If acquired and global is full, the request still holds the per-user slot while waiting on global — *but* per-user caps are typically `1`, so any subsequent request from that user is gated regardless. Per-user-first avoids the wasted holding cost of acquiring global before learning the per-user cap rejects you.
2. **Then global.** Once both are held, the caller runs.

`release(user)` releases in reverse order: global first, then per-user.

A `snapshot()` method returns the current state for the `/queue` route.

**Files:**
- Create: `packages/cli/src/agent/concurrency.ts`
- Test: `packages/cli/test/agent/concurrency.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/agent/concurrency.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ConcurrencyManager } from '../../src/agent/concurrency.ts';

describe('ConcurrencyManager', () => {
  it('allows immediate acquire when both caps have slots', async () => {
    const m = new ConcurrencyManager({ globalCap: 2, perUserCap: 1 });
    const lease = await m.acquire('alice');
    expect(lease.queueWaitMs).toBe(0);
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
    m.release(a);
    const b = await bP;
    expect(b.queueWaitMs).toBeGreaterThan(0);
    expect(b.positionAtEntry).toBe(1);
    m.release(b);
  });

  it('per-user cap serializes the same user even when global has slots', async () => {
    const m = new ConcurrencyManager({ globalCap: 10, perUserCap: 1 });
    const a1 = await m.acquire('alice');
    const a2P = m.acquire('alice');
    // a2 is queued on per-user, not global
    expect(m.snapshot().queued.some((q) => q.user === 'alice')).toBe(true);
    m.release(a1);
    const a2 = await a2P;
    expect(a2.queueWaitMs).toBeGreaterThan(0);
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/cli && pnpm vitest run test/agent/concurrency.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/cli/src/agent/concurrency.ts`:

```typescript
import { Semaphore, type AcquireToken } from './semaphore.ts';

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

  async acquire(user: string): Promise<Lease> {
    const start = Date.now();
    // If we are going to wait on the global semaphore, our position at entry
    // is the current waiter count + 1 (we get appended). If we won't wait
    // (slots available and no one else queued), this snapshot is recorded
    // anyway but only reported back when queueWaitMs > 0.
    const willWaitOnGlobal =
      this.global.available() === 0 || this.global.waiting() > 0;
    const positionAtEntrySnapshot = willWaitOnGlobal ? this.global.waiting() + 1 : 0;

    const perUserSem = this.getOrCreatePerUser(user);

    // Track pending so snapshot() can show it.
    const trackKey = Symbol('lease-pending');
    this.pending.push({ user, key: trackKey });

    try {
      await perUserSem.acquire();
      await this.global.acquire();
    } finally {
      // Whether we succeeded or threw, remove the pending marker.
      const idx = this.pending.findIndex((p) => p.key === trackKey);
      if (idx !== -1) this.pending.splice(idx, 1);
    }

    this.inFlight.add(user);
    const queueWaitMs = Date.now() - start;
    return {
      user,
      acquiredAt: Date.now(),
      queueWaitMs,
      // Report the snapshot only when we actually waited; otherwise 0.
      positionAtEntry: queueWaitMs > 0 ? positionAtEntrySnapshot : 0,
    };
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
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/cli && pnpm vitest run test/agent/concurrency.test.ts
```

Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/concurrency.ts packages/cli/test/agent/concurrency.test.ts
git commit -m "feat(agent): ConcurrencyManager composing global + per-user caps"
```

---

## Task 3: Wire `ConcurrencyManager` into the server

`AgentOptions` gains an optional `concurrency` field (defaulted to `new ConcurrencyManager({ globalCap: 3, perUserCap: 1 })` if not provided). Both `/ask` and `/chat` acquire/release around the actual work. `/ask` sets `X-Patchwire-Queue-Wait-Ms` (always) and `X-Patchwire-Queue-Position-At-Entry` (only when wait > 0) on the response. A new `GET /queue` route returns the manager's snapshot.

**Files:**
- Modify: `packages/cli/src/agent/server.ts`

- [ ] **Step 1: Update `AgentOptions`**

In `packages/cli/src/agent/server.ts`, add the import near the existing agent-module imports:

```typescript
import { ConcurrencyManager } from './concurrency.ts';
```

Replace the `AgentOptions` interface to add an optional `concurrency` field:

```typescript
export interface AgentOptions {
  usersStore: UsersStore;
  projectsRoot: string;
  aiCommand: string;
  aiArgs: string[];
  timeoutSec: number;
  version: string;
  /** Path to the persistent session-store JSON. Defaults to `~/.patchwire/agent-sessions.json`. */
  sessionStorePath?: string;
  /** Concurrency manager. Defaults to ConcurrencyManager({globalCap:3, perUserCap:1}). */
  concurrency?: ConcurrencyManager;
}
```

- [ ] **Step 2: Construct a default manager inside `buildServer` if none provided**

At the top of `buildServer(opts)`, after the existing app/sessionStore setup, add:

```typescript
  const concurrency =
    opts.concurrency ?? new ConcurrencyManager({ globalCap: 3, perUserCap: 1 });
```

- [ ] **Step 3: Wrap `/ask` with acquire/release**

The current `/ask` handler does (simplified):
```typescript
app.post('/ask', async (req, reply) => {
  // ... validation, path resolution, isGitRepo, isClean checks ...
  // claude run
  // captureDiff
  // reset
  // return { diff, files, ... }
});
```

Wrap the work AFTER the cheap pre-flight checks (validation + path resolution + isGitRepo + isClean) but BEFORE the Claude spawn. The acquire/release ONLY guards the expensive Claude run, not the cheap checks. (Rationale: returning 404/409/412 should not require a queue slot.)

Inside the handler, after the `isClean` block and immediately before `const start = Date.now();`, add:

```typescript
    const lease = await concurrency.acquire(username);
    reply.header('X-Patchwire-Queue-Wait-Ms', String(lease.queueWaitMs));
    if (lease.positionAtEntry > 0) {
      reply.header('X-Patchwire-Queue-Position-At-Entry', String(lease.positionAtEntry));
    }
```

(`username` is the already-resolved authenticated user from Phase 2 work.)

Then wrap the rest of the handler (claude run + captureDiff + reset + return) in a `try/finally` that releases:

```typescript
    try {
      const start = Date.now();
      let claudeResult;
      try {
        claudeResult = await runAi({
          command: opts.aiCommand,
          args: opts.aiArgs,
          prompt,
          cwd: projectDir,
          timeoutMs: opts.timeoutSec * 1000,
        });
      } catch (err) {
        await resetClean(projectDir).catch(() => {});
        reply.code(500);
        return { error: (err as Error).message };
      }

      let diffData;
      try {
        diffData = await captureDiff(projectDir);
      } finally {
        await resetClean(projectDir).catch(() => {});
      }

      return {
        diff: diffData.diff,
        files: diffData.files,
        durationMs: Date.now() - start,
        stdout: claudeResult.stdout,
        stderr: claudeResult.stderr,
        exitCode: claudeResult.exitCode,
      };
    } finally {
      concurrency.release(lease);
    }
```

(The inner `try/catch` around `runAi` is preserved exactly as-is, just nested inside the outer `try/finally` for the lease release.)

- [ ] **Step 4: Wrap `/chat` with acquire/release**

`/chat` is NDJSON-streamed and has its own complex flow. The acquire/release goes around the entire body of the handler that runs `runChatTurn` — after the pre-flight checks (parsing + project lookup) but before `reply.raw.setHeader('content-type', ...)`.

Find this block in `/chat`:
```typescript
    reply.raw.setHeader('content-type', 'application/x-ndjson');
    reply.hijack();
    const emit = (e: unknown) => reply.raw.write(JSON.stringify(e) + '\n');

    // TODO comment about cancellation...
    turns.start(body.uuid);
    try {
      await runChatTurn({ ... });
    } catch (err) {
      // ...
    } finally {
      try { reply.raw.end(); } catch { /* ... */ }
    }
```

Wrap from `reply.raw.setHeader` through the `finally { reply.raw.end() }` block in an outer `try/finally` for the lease. Add the acquire BEFORE `reply.raw.setHeader`:

```typescript
    const lease = await concurrency.acquire(username);
    try {
      reply.raw.setHeader('content-type', 'application/x-ndjson');
      reply.hijack();
      // ... existing handler body unchanged ...
    } finally {
      concurrency.release(lease);
    }
```

(For /chat we do not emit X-Patchwire-Queue-* headers — those would land after `reply.hijack()` and complicate the stream. Phase 5's SSE migration will emit a `queued` event instead.)

- [ ] **Step 5: Add the `GET /queue` route**

Add this route immediately after the existing `GET /me` route:

```typescript
  app.get('/queue', async () => {
    return concurrency.snapshot();
  });
```

- [ ] **Step 6: Run all existing agent tests + typecheck**

```bash
cd packages/cli && pnpm vitest run test/agent.test.ts test/agent/ && pnpm typecheck
```

Expected: ALL PASS. The existing `/ask` happy-path test still passes (single user, single request, acquire-then-release adds microseconds of latency).

- [ ] **Step 7: Add a unit test for `GET /queue`**

Append to `packages/cli/test/agent/auth-multi-user.test.ts` (inside the existing `describe('server auth hook (multi-user)', ...)` block):

```typescript
  it('GET /queue returns an empty snapshot when nothing is in flight', async () => {
    const a = app();
    const res = await a.inject({
      method: 'GET', url: '/queue',
      headers: { authorization: 'Bearer alice-token' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { globalCap: number; perUserCap: number; inFlight: string[]; queued: unknown[] };
    expect(body.globalCap).toBe(3);
    expect(body.perUserCap).toBe(1);
    expect(body.inFlight).toEqual([]);
    expect(body.queued).toEqual([]);
    await a.close();
  });

  it('GET /queue requires auth', async () => {
    const a = app();
    const res = await a.inject({ method: 'GET', url: '/queue' });
    expect(res.statusCode).toBe(401);
    await a.close();
  });
```

- [ ] **Step 8: Run the new tests**

```bash
cd packages/cli && pnpm vitest run test/agent/auth-multi-user.test.ts
```

Expected: PASS, all tests including the two new `/queue` tests.

- [ ] **Step 9: Commit**

```bash
git add packages/cli/src/agent/server.ts packages/cli/test/agent/auth-multi-user.test.ts
git commit -m "feat(agent): per-request concurrency (acquire/release on /ask + /chat) + /queue"
```

---

## Task 4: `runServe` reads concurrency caps from env

Two new env vars on the agent: `PW_MAX_CONCURRENT_TOTAL` (default 3) and `PW_MAX_CONCURRENT_PER_USER` (default 1). `runServe` reads them, constructs a `ConcurrencyManager`, and passes it to `buildServer`.

**File:**
- Modify: `packages/cli/src/agent.ts`

- [ ] **Step 1: Edit `src/agent.ts`**

Add the import (just below the existing migration imports):

```typescript
import { ConcurrencyManager } from './agent/concurrency.ts';
```

Inside `runServe()`, just before the `const app = buildServer({...})` call, add:

```typescript
  const globalCap = Number(process.env.PW_MAX_CONCURRENT_TOTAL ?? 3);
  const perUserCap = Number(process.env.PW_MAX_CONCURRENT_PER_USER ?? 1);
  if (!Number.isInteger(globalCap) || globalCap < 1) {
    console.error(`PW_MAX_CONCURRENT_TOTAL must be a positive integer (got ${process.env.PW_MAX_CONCURRENT_TOTAL})`);
    process.exit(1);
  }
  if (!Number.isInteger(perUserCap) || perUserCap < 1) {
    console.error(`PW_MAX_CONCURRENT_PER_USER must be a positive integer (got ${process.env.PW_MAX_CONCURRENT_PER_USER})`);
    process.exit(1);
  }
  const concurrency = new ConcurrencyManager({ globalCap, perUserCap });
```

Then update the `buildServer({...})` call to pass it through:

```typescript
  const app = buildServer({
    usersStore,
    projectsRoot,
    aiCommand,
    aiArgs,
    timeoutSec,
    version: VERSION,
    concurrency,
  });
```

After `app.listen(...)`, log the configured caps:

```typescript
    app.log.info(
      `concurrency: global=${globalCap}, per_user=${perUserCap}`,
    );
```

(Place this immediately after the existing `app.log.info(\`patchwire-agent listening on ${addr}\`);`.)

- [ ] **Step 2: Typecheck**

```bash
cd packages/cli && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/agent.ts
git commit -m "feat(agent): read PW_MAX_CONCURRENT_TOTAL / _PER_USER env vars"
```

---

## Task 5: End-to-end concurrency test

Prove the key property: with `globalCap: 1`, two simultaneous /ask requests from different users serialize (the second one's response carries non-zero `X-Patchwire-Queue-Wait-Ms`).

**File:**
- Create: `packages/cli/test/integration/concurrency.e2e.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildServer } from '../../src/agent/server.ts';
import { UsersStore } from '../../src/agent/users-store.ts';
import { ConcurrencyManager } from '../../src/agent/concurrency.ts';

describe('concurrency end-to-end', () => {
  let dir: string;
  let app: ReturnType<typeof buildServer>;

  function git(args: string[], cwd: string): void {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  }
  function makeProject(parent: string, name: string): void {
    const p = join(parent, name);
    mkdirSync(p, { recursive: true });
    git(['init', '-q', '-b', 'main'], p);
    git(['config', 'user.email', 't@e'], p);
    git(['config', 'user.name', 't'], p);
    git(['config', 'commit.gpgsign', 'false'], p);
    writeFileSync(join(p, 'a.txt'), 'one\n');
    git(['add', '.'], p);
    git(['commit', '-q', '-m', 'init'], p);
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-conc-e2e-'));
    const store = new UsersStore(join(dir, 'users.json'));
    store.addUser('alice', 'alice-token');
    store.addUser('bob', 'bob-token');
    makeProject(join(dir, 'alice'), 'app');
    makeProject(join(dir, 'bob'), 'app');
    app = buildServer({
      usersStore: store, projectsRoot: dir,
      aiCommand: 'sh',
      aiArgs: ['-c', 'sleep 0.3'], // each "claude" run takes ~300ms
      timeoutSec: 5, version: 'e2e',
      concurrency: new ConcurrencyManager({ globalCap: 1, perUserCap: 1 }),
    });
  });
  afterEach(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('with globalCap=1, two concurrent /ask requests serialize and the second reports a queue wait', async () => {
    const [a, b] = await Promise.all([
      app.inject({
        method: 'POST', url: '/ask',
        headers: { authorization: 'Bearer alice-token', 'content-type': 'application/json' },
        payload: { prompt: 'p', project: 'app' },
      }),
      app.inject({
        method: 'POST', url: '/ask',
        headers: { authorization: 'Bearer bob-token', 'content-type': 'application/json' },
        payload: { prompt: 'p', project: 'app' },
      }),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    const aWait = Number(a.headers['x-patchwire-queue-wait-ms'] ?? '0');
    const bWait = Number(b.headers['x-patchwire-queue-wait-ms'] ?? '0');
    // One of them ran first (wait ≈ 0), the other waited at least the fake AI duration (≈ 300ms).
    const waits = [aWait, bWait].sort((x, y) => x - y);
    expect(waits[0]).toBeLessThan(150);
    expect(waits[1]).toBeGreaterThanOrEqual(200);
  });

  it('GET /queue reflects in-flight + queued', async () => {
    // Start one long-ish request, then peek at /queue while it's running.
    const pending = app.inject({
      method: 'POST', url: '/ask',
      headers: { authorization: 'Bearer alice-token', 'content-type': 'application/json' },
      payload: { prompt: 'p', project: 'app' },
    });
    // Give the handler a moment to acquire the lease.
    await new Promise((r) => setTimeout(r, 50));
    const snap = await app.inject({
      method: 'GET', url: '/queue',
      headers: { authorization: 'Bearer bob-token' },
    });
    expect(snap.statusCode).toBe(200);
    const body = snap.json() as { inFlight: string[]; globalCap: number };
    expect(body.inFlight).toContain('alice');
    expect(body.globalCap).toBe(1);
    await pending;
  });
});
```

- [ ] **Step 2: Run it**

```bash
cd packages/cli && pnpm vitest run test/integration/concurrency.e2e.test.ts
```

Expected: PASS, 2 tests.

- [ ] **Step 3: Run the full suite**

```bash
cd packages/cli && pnpm test && pnpm typecheck
```

Expected: ALL PASS (modulo the known environmental flake at `test/agent.test.ts:161`).

- [ ] **Step 4: Commit**

```bash
git add packages/cli/test/integration/concurrency.e2e.test.ts
git commit -m "test(agent): concurrency e2e (serialization + /queue snapshot)"
```

---

## Task 6: Documentation refresh

**Files:**
- Modify: `packages/website/src/content/docs/configuration.md` — document the two new env vars
- Modify: `packages/website/src/content/docs/agent.md` — describe queue behavior + `/queue` endpoint

- [ ] **Step 1: Read each file first**

```bash
cat packages/website/src/content/docs/configuration.md
cat packages/website/src/content/docs/agent.md
```

- [ ] **Step 2: Add the two env vars to `configuration.md`**

In the "Agent environment variables" table, immediately after `PW_TIMEOUT_SEC`, add two new rows:

```markdown
| `PW_MAX_CONCURRENT_TOTAL` | no | `3` | Maximum simultaneous Claude runs across all users. Requests beyond this cap wait FIFO. |
| `PW_MAX_CONCURRENT_PER_USER` | no | `1` | Maximum simultaneous Claude runs from any one user. Prevents single-user hogging when the global cap allows it. |
```

- [ ] **Step 3: Add a queue note to `agent.md`**

Inside or just after the "Project layout on the agent" section (added in phase 2), insert:

```markdown
### Concurrency + queue (v0.2.2+)

The agent caps simultaneous Claude runs to avoid melting the box under team load:

- `PW_MAX_CONCURRENT_TOTAL` (default `3`) — global ceiling.
- `PW_MAX_CONCURRENT_PER_USER` (default `1`) — per-user ceiling so no single
  developer hogs all slots while teammates wait.

Requests that exceed either cap wait in arrival order (FIFO). The response carries:

- `X-Patchwire-Queue-Wait-Ms` — how long the request waited (always present).
- `X-Patchwire-Queue-Position-At-Entry` — position in the global queue at entry (only when wait > 0).

A read-only `GET /queue` endpoint returns the current snapshot:

\```json
{
  "globalCap": 3,
  "perUserCap": 1,
  "inFlight": ["alice"],
  "queued": [{"user": "bob", "position": 1}]
}
\```
```

(Use real triple backticks in the file; the escaped backticks above are just for this prompt.)

- [ ] **Step 4: Commit**

```bash
git add packages/website/src/content/docs/configuration.md packages/website/src/content/docs/agent.md
git commit -m "docs: agent concurrency caps + /queue endpoint (v0.2 phase 3)"
```

---

## Final verification

- [ ] **Step 1: Full pipeline**

```bash
cd packages/cli && pnpm verify
```

Expected: typecheck, tests, build, smoke all green.

- [ ] **Step 2: Tag**

```bash
git tag -a v0.2.2-phase3 -m "Phase 3: concurrency caps + per-user FIFO queue"
```

---

## Spec coverage check

| Spec requirement | Covered by |
|---|---|
| `Semaphore` FIFO primitive | Task 1 |
| `ConcurrencyManager` global + per-user composition | Task 2 |
| Per-user lazy semaphore creation | Task 2 |
| Acquire order (per-user first, then global) | Task 2 |
| Release order (global first, then per-user) | Task 2 |
| /ask + /chat acquire-then-work-then-release | Task 3 |
| `X-Patchwire-Queue-Wait-Ms` header on /ask | Task 3 |
| `X-Patchwire-Queue-Position-At-Entry` header on /ask | Task 3 |
| `GET /queue` snapshot endpoint | Task 3 |
| `PW_MAX_CONCURRENT_TOTAL` + `_PER_USER` env vars | Task 4 |
| E2E proof of serialization + queue snapshot | Task 5 |
| Docs updated | Task 6 |
