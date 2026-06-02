# Phase 5: Streamed `/ask` (live queue visibility) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `/ask` from a blocking JSON POST into an NDJSON stream so the CLI shows the user a live `queued { position }` event while waiting, then `accepted`, then the final `result` (or `error`).

**Architecture:** Approach A — `ConcurrencyManager.acquire` gains an optional `onQueued` callback; the `/ask` handler hijacks the response after pre-flight checks and emits NDJSON events (same framing as the shipped `/chat`). Hard switch: `/ask` is NDJSON-only, its single consumer (`AgentClient.ask`) parses the stream and still resolves to the existing `AskResponse`. `runAi` stays buffered — the claude run itself is not streamed.

**Tech Stack:** TypeScript (ESM, `.ts` imports), Fastify (`reply.hijack()` + `reply.raw.write`), undici (`fetch` streaming reader), Zod, Vitest, pnpm workspaces (`@patchwire/protocol`, CLI in `packages/cli`).

**Spec:** `docs/superpowers/specs/2026-06-02-phase5-streamed-ask-design.md`

---

## File Structure

**Modify:**
- `packages/protocol/src/events.ts` — add `AskEvent`, `AskRequest`, `AskResponse` types.
- `packages/protocol/src/index.ts` — re-export the new types.
- `packages/cli/src/agent/concurrency.ts` — add optional `onQueued` param to `acquire`.
- `packages/cli/src/agent/server.ts` — rewrite the `/ask` handler to stream NDJSON; remove `X-Patchwire-Queue-*` headers.
- `packages/cli/src/lib/client.ts` — rewrite `AgentClient.ask` to parse NDJSON; import `AskRequest`/`AskResponse`/`AskEvent` from protocol instead of declaring them inline.
- `packages/cli/src/commands/ask.ts` — pass an `onEvent` callback that logs queue position.

**Test (modify/create):**
- `packages/cli/test/agent/concurrency.test.ts` — add `onQueued` callback tests.
- `packages/cli/test/agent.test.ts` — update existing `/ask` happy-path + audit tests to parse NDJSON; add queued-path and error-path tests.
- `packages/cli/test/lib/client-ask.test.ts` — **create** unit tests for `AgentClient.ask` NDJSON parsing.

**Dependency order:** Task 1 (protocol types) → Task 2 (concurrency callback) → Task 3 (server handler) → Task 4 (client) → Task 5 (CLI command) → Task 6 (full verify + docs + tag). Tasks 1–2 are independent of each other; 3 depends on 1+2; 4 depends on 1+3; 5 depends on 4.

---

## Task 1: Add `AskEvent` / `AskRequest` / `AskResponse` to the protocol package

**Files:**
- Modify: `packages/protocol/src/events.ts`
- Modify: `packages/protocol/src/index.ts`

Note: these are pure type declarations — there is no runtime behavior to unit-test. The "test" is `tsc` (run in Task 1 Step 4) plus the consuming tasks. Do not invent a runtime test for a type-only change.

- [ ] **Step 1: Add the types to `events.ts`**

Append to `packages/protocol/src/events.ts` (after the existing `SUPPORTED_PROTOCOL` line):

```ts
/** Request body for `POST /ask`. */
export interface AskRequest {
  prompt: string;
  project: string;
}

/**
 * Terminal success payload for `/ask`. Identical to the `result` event minus
 * its `type` tag. `files` are filenames (from `captureDiff`), not ChangedFile.
 */
export interface AskResponse {
  diff: string;
  files: string[];
  durationMs: number;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * NDJSON event stream emitted by `POST /ask` (one JSON object per `\n`-delimited line).
 * Lifecycle: (`queued`?) -> `accepted` -> (`result` | `error`). `queued` is emitted
 * at most once, only when the request waits on the global concurrency cap.
 */
export type AskEvent =
  | { type: 'queued'; position: number }
  | { type: 'accepted'; queueWaitMs: number }
  | { type: 'result'; diff: string; files: string[]; durationMs: number; stdout: string; stderr: string; exitCode: number }
  | { type: 'error'; code: string; message: string };
```

- [ ] **Step 2: Re-export from `index.ts`**

Edit `packages/protocol/src/index.ts` line 1 to add the new type exports:

```ts
export type { ChangedFile, CliEvent, AskEvent, AskRequest, AskResponse } from './events.ts';
export { SUPPORTED_PROTOCOL } from './events.ts';
export { ChatBody } from './chat.ts';
```

- [ ] **Step 3: Typecheck the protocol package**

Run: `pnpm --filter @patchwire/protocol typecheck`
Expected: PASS. (The protocol package is source-direct — `main`/`exports` point at `./src/index.ts`, so there is no build step; consumers import the `.ts` directly.)

- [ ] **Step 4: Typecheck the CLI consumer compiles against it**

Run: `pnpm --filter patchwire typecheck`
Expected: PASS (nothing imports the new types yet, so this just confirms no breakage).

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/events.ts packages/protocol/src/index.ts
git commit -m "feat(protocol): AskEvent + AskRequest/AskResponse types for streamed /ask"
```

---

## Task 2: `ConcurrencyManager.acquire(user, onQueued?)`

**Files:**
- Modify: `packages/cli/src/agent/concurrency.ts:45-80`
- Test: `packages/cli/test/agent/concurrency.test.ts`

- [ ] **Step 1: Write the failing tests**

Add these two tests inside the existing `describe('ConcurrencyManager', ...)` block in `packages/cli/test/agent/concurrency.test.ts`:

```ts
  it('fires onQueued once with position when the request waits on the global cap', async () => {
    const m = new ConcurrencyManager({ globalCap: 1, perUserCap: 5 });
    const held = await m.acquire('alice');
    const positions: number[] = [];
    const bP = m.acquire('bob', ({ position }) => positions.push(position));
    // bob is waiting behind alice; the callback should already have fired once.
    expect(positions).toEqual([1]);
    m.release(held);
    const b = await bP;
    expect(positions).toEqual([1]); // still exactly one call — one-shot
    m.release(b);
  });

  it('does not fire onQueued when a slot is immediately available', async () => {
    const m = new ConcurrencyManager({ globalCap: 2, perUserCap: 1 });
    const positions: number[] = [];
    const lease = await m.acquire('alice', ({ position }) => positions.push(position));
    expect(positions).toEqual([]);
    m.release(lease);
  });

  it('still works when called without an onQueued callback (regression)', async () => {
    const m = new ConcurrencyManager({ globalCap: 1, perUserCap: 5 });
    const lease = await m.acquire('alice');
    expect(lease.positionAtEntry).toBe(0);
    m.release(lease);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter patchwire exec vitest run test/agent/concurrency.test.ts -t onQueued`
Expected: FAIL — `acquire` currently takes one argument; the callback is never invoked so `positions` stays `[]` in the first test (`expected [] to equal [ 1 ]`).

- [ ] **Step 3: Add the callback to `acquire`**

In `packages/cli/src/agent/concurrency.ts`, change the `acquire` signature and emit the callback at the point where the wait is detected. Replace lines 45-74 (the method body up to the `return`) with:

```ts
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
      await perUserSem.acquire();
      // After per-user acquired, compute position at entry for global queue.
      // This is the position we'd be in if we wait on global.
      const willWaitOnGlobal =
        this.global.available() === 0 || this.global.waiting() > 0;
      const positionAtEntrySnapshot = willWaitOnGlobal ? this.global.waiting() + 1 : 0;

      // One-shot queue notification: fire BEFORE awaiting the global slot, only
      // when we know we will wait. Position is the global-queue position at entry.
      if (willWaitOnGlobal && onQueued) {
        onQueued({ position: positionAtEntrySnapshot });
      }

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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter patchwire exec vitest run test/agent/concurrency.test.ts`
Expected: PASS (all existing tests + the 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/concurrency.ts packages/cli/test/agent/concurrency.test.ts
git commit -m "feat(agent): ConcurrencyManager.acquire onQueued callback (one-shot position)"
```

---

## Task 3: Rewrite the `/ask` handler to stream NDJSON

**Files:**
- Modify: `packages/cli/src/agent/server.ts:152-235` (the whole `/ask` handler)
- Test: `packages/cli/test/agent.test.ts`

The pre-flight validation (400/404/412/409) stays exactly as-is and returns plain JSON before any hijack. Only the post-validation section changes from "buffer + return JSON" to "hijack + emit NDJSON".

- [ ] **Step 1: Update the existing happy-path + audit tests to parse NDJSON**

The hard switch breaks the two tests that call `res.json()`. First add a parse helper near the top of `packages/cli/test/agent.test.ts` (after the `import` lines):

```ts
import type { AskEvent } from '@patchwire/protocol';

/** Parse a hijacked NDJSON `/ask` response body into typed events. */
function parseAskEvents(payload: string): AskEvent[] {
  return payload
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AskEvent);
}
```

Then replace the body assertions in the test titled
`'runs claude, captures diff (incl. modifications + new files), and resets working tree'`
(currently `expect(res.statusCode).toBe(200)` through the `body.files.sort()` line) with:

```ts
    expect(res.statusCode).toBe(200);
    const events = parseAskEvents(res.payload);
    const result = events.find((e) => e.type === 'result');
    expect(result).toBeDefined();
    if (result?.type !== 'result') throw new Error('no result event');
    expect(result.exitCode).toBe(0);
    expect(result.diff).toContain('a.txt');
    expect(result.diff).toContain('three-edited');
    expect(result.diff).toContain('c.txt');
    expect(result.files.sort()).toEqual(['a.txt', 'c.txt']);
    // No wait expected (single request, free slot) -> no queued event.
    expect(events.some((e) => e.type === 'queued')).toBe(false);
    expect(events.some((e) => e.type === 'accepted')).toBe(true);
```

The audit test (`'writes an audit line after a successful /ask'`) asserts on the
audit log, not the body, so only its status check needs care. Replace its
`expect(res.statusCode).toBe(200);` line with:

```ts
    expect(res.statusCode).toBe(200);
    expect(parseAskEvents(res.payload).some((e) => e.type === 'result')).toBe(true);
```

- [ ] **Step 2: Add a queued-path and an error-path test**

Add these two tests inside the `describe('agent server', ...)` block in `packages/cli/test/agent.test.ts`:

```ts
  it('emits a queued event when the request waits behind another (globalCap=1)', async () => {
    fakeClaudeBin = await makeFakeClaude(`sleep 0.3; printf 'edited\\n' >> a.txt`);
    const { ConcurrencyManager } = await import('../src/agent/concurrency.ts');
    const store = makeStore();
    store.addUser('other', 'other-token-1234567890');
    // Second project for the second user so both pass pre-flight.
    const otherDir = join(projectsRoot, 'other', 'sample');
    await mkdir(otherDir, { recursive: true });
    git(['init', '-q', '-b', 'main'], otherDir);
    git(['config', 'user.email', 't@e.com'], otherDir);
    git(['config', 'user.name', 'T'], otherDir);
    git(['config', 'commit.gpgsign', 'false'], otherDir);
    await writeFile(join(otherDir, 'a.txt'), 'one\n', 'utf8');
    git(['add', '.'], otherDir);
    git(['commit', '-q', '-m', 'init'], otherDir);

    const app = buildServer({
      usersStore: store, projectsRoot,
      aiCommand: fakeClaudeBin, aiArgs: [],
      timeoutSec: 10, version: 'x',
      auditLog: new NoopAuditLog(),
      concurrency: new ConcurrencyManager({ globalCap: 1, perUserCap: 1 }),
    });

    const first = app.inject({
      method: 'POST', url: '/ask',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      payload: { prompt: 'p', project: 'sample' },
    });
    // Give the first request time to acquire the only slot before the second starts.
    await new Promise((r) => setTimeout(r, 50));
    const second = await app.inject({
      method: 'POST', url: '/ask',
      headers: { authorization: `Bearer other-token-1234567890`, 'content-type': 'application/json' },
      payload: { prompt: 'p', project: 'sample' },
    });
    await first;

    const events = parseAskEvents(second.payload);
    const queued = events.find((e) => e.type === 'queued');
    expect(queued).toBeDefined();
    if (queued?.type === 'queued') expect(queued.position).toBeGreaterThanOrEqual(1);
    expect(events.some((e) => e.type === 'result')).toBe(true);
    await app.close();
  });

  it('emits an error event (not a 500) when the AI run fails, and still resets the tree', async () => {
    // Force a thrown runAi error by pointing aiCommand at a path that does not
    // exist — `runAi` rejects on the child process 'error' event (ENOENT).
    const app = buildServer({
      usersStore: makeStore(), projectsRoot,
      aiCommand: join(projectsRoot, 'does-not-exist-bin'), aiArgs: [],
      timeoutSec: 5, version: 'x',
      auditLog: new NoopAuditLog(),
    });
    const res = await app.inject({
      method: 'POST', url: '/ask',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      payload: { prompt: 'p', project: 'sample' },
    });
    expect(res.statusCode).toBe(200); // hijacked stream; failure is in-band
    const events = parseAskEvents(res.payload);
    const err = events.find((e) => e.type === 'error');
    expect(err).toBeDefined();
    if (err?.type === 'error') expect(err.code).toBe('run_failed');
    // Working tree still clean after a failed run.
    const status = spawnSync('git', ['status', '--porcelain'], { cwd: projectDir, encoding: 'utf8' });
    expect(status.stdout.trim()).toBe('');
    await app.close();
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter patchwire exec vitest run test/agent.test.ts`
Expected: FAIL — the handler still returns buffered JSON, so `parseAskEvents` sees a single non-event JSON object (no `result`/`queued`/`error` `type`), and the new error test finds no `error` event.

- [ ] **Step 4: Rewrite the `/ask` handler**

In `packages/cli/src/agent/server.ts`, replace the entire handler body from the
`const lease = await concurrency.acquire(username);` line through the closing
`});` of the `/ask` route (currently lines 180-235) with the streamed version
below. Leave everything above it (the AskBody parse + 400/404/412/409 pre-flight
checks, lines 152-178) untouched.

```ts
    // Pre-flight passed — switch to a streamed NDJSON response.
    reply.raw.setHeader('content-type', 'application/x-ndjson');
    reply.hijack();
    const emit = (e: AskEvent) => reply.raw.write(JSON.stringify(e) + '\n');

    const lease = await concurrency.acquire(username, ({ position }) =>
      emit({ type: 'queued', position }),
    );
    emit({ type: 'accepted', queueWaitMs: lease.queueWaitMs });

    try {
      const startRun = Date.now();
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
        emit({ type: 'error', code: 'run_failed', message: (err as Error).message });
        return;
      }

      let diffData;
      try {
        diffData = await captureDiff(projectDir);
      } catch (err) {
        emit({ type: 'error', code: 'diff_failed', message: (err as Error).message });
        return;
      }

      const durationMs = Date.now() - startRun;
      const stats = countDiffLines(diffData.diff);
      opts.auditLog.append({
        route: '/ask',
        ts: new Date().toISOString(),
        user: username,
        project,
        prompt_sha256: createHash('sha256').update(prompt).digest('hex'),
        files: diffData.files.length,
        lines_added: stats.linesAdded,
        lines_removed: stats.linesRemoved,
        duration_ms: durationMs,
        queue_wait_ms: lease.queueWaitMs,
        exit_code: claudeResult.exitCode,
      });
      emit({
        type: 'result',
        diff: diffData.diff,
        files: diffData.files,
        durationMs,
        stdout: claudeResult.stdout,
        stderr: claudeResult.stderr,
        exitCode: claudeResult.exitCode,
      });
    } catch (err) {
      try {
        emit({ type: 'error', code: 'internal', message: (err as Error).message });
      } catch {
        /* socket already gone */
      }
    } finally {
      await resetClean(projectDir).catch(() => {});
      concurrency.release(lease);
      try {
        reply.raw.end();
      } catch {
        /* same */
      }
    }
```

Note the cleanup change: in the original, `resetClean` ran in a `finally` around
`captureDiff` and again in the AI-error path. Here a single `finally` at the end
runs `resetClean` once on every exit path (success, `run_failed`, `diff_failed`,
`internal`), so the tree is always restored. Do not double-reset.

- [ ] **Step 5: Add the `AskEvent` import to `server.ts`**

`server.ts` already has a **value** import `import { ChatBody } from '@patchwire/protocol';`
(line 2). `AskEvent` is a type, so add a separate type-only import line directly
below it:

```ts
import type { AskEvent } from '@patchwire/protocol';
```

- [ ] **Step 6: Remove now-dead header references**

Confirm no `X-Patchwire-Queue-` strings remain in `server.ts`:

Run: `grep -n "X-Patchwire-Queue" packages/cli/src/agent/server.ts`
Expected: no output (the replacement in Step 4 already dropped them).

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter patchwire exec vitest run test/agent.test.ts && pnpm --filter patchwire typecheck`
Expected: PASS — all `/ask` tests (updated happy-path, audit, queued, error) green; typecheck clean.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/agent/server.ts packages/cli/test/agent.test.ts
git commit -m "feat(agent): stream /ask as NDJSON (queued/accepted/result/error)"
```

---

## Task 4: Rewrite `AgentClient.ask` to parse the NDJSON stream

**Files:**
- Modify: `packages/cli/src/lib/client.ts` (remove inline `AskRequest`/`AskResponse`; rewrite `ask`)
- Test: `packages/cli/test/lib/client-ask.test.ts` (create)

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/lib/client-ask.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseAskStream } from '../../src/lib/client.ts';
import type { AskEvent } from '@patchwire/protocol';

/** Build an async iterable of decoded chunks from a list of NDJSON lines. */
async function* chunks(...lines: string[]): AsyncGenerator<Uint8Array> {
  const enc = new TextEncoder();
  for (const l of lines) yield enc.encode(l);
}

describe('parseAskStream', () => {
  it('collapses queued/accepted/result into an AskResponse and forwards events', async () => {
    const seen: AskEvent[] = [];
    const res = await parseAskStream(
      chunks(
        '{"type":"queued","position":2}\n',
        '{"type":"accepted","queueWaitMs":120}\n{"type":"result","diff":"D","files":["a.txt"],"durationMs":5,"stdout":"o","stderr":"e","exitCode":0}\n',
      ),
      (e) => seen.push(e),
    );
    expect(res).toEqual({ diff: 'D', files: ['a.txt'], durationMs: 5, stdout: 'o', stderr: 'e', exitCode: 0 });
    expect(seen.map((e) => e.type)).toEqual(['queued', 'accepted', 'result']);
  });

  it('throws on an error event, carrying the message', async () => {
    await expect(
      parseAskStream(chunks('{"type":"error","code":"run_failed","message":"boom"}\n'), () => {}),
    ).rejects.toThrow('boom');
  });

  it('throws when the stream ends without a terminal event', async () => {
    await expect(
      parseAskStream(chunks('{"type":"accepted","queueWaitMs":0}\n'), () => {}),
    ).rejects.toThrow('stream ended without result');
  });

  it('tolerates a line split across two chunks', async () => {
    const full =
      '{"type":"result","diff":"D","files":[],"durationMs":0,"stdout":"","stderr":"","exitCode":0}\n';
    const cut = 30; // arbitrary mid-line split point
    const res = await parseAskStream(chunks(full.slice(0, cut), full.slice(cut)), () => {});
    expect(res.diff).toBe('D');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter patchwire exec vitest run test/lib/client-ask.test.ts`
Expected: FAIL — `parseAskStream` is not exported from `client.ts`.

- [ ] **Step 3: Implement `parseAskStream` and rewrite `ask`**

In `packages/cli/src/lib/client.ts`:

(a) Remove the inline `export interface AskRequest { … }` and
`export interface AskResponse { … }` blocks (they now live in the protocol package).

(b) Add to the top-of-file imports a type import from the protocol package:

```ts
import type { AskEvent, AskRequest, AskResponse } from '@patchwire/protocol';
```

(c) Add this exported helper (place it near the other module-level helpers, above the `AgentClient` class):

```ts
/**
 * Parse an NDJSON `/ask` event stream. Forwards every event to `onEvent` and
 * resolves to the `AskResponse` carried by the terminal `result` event. Throws
 * on an `error` event (carrying its message) or if the stream ends with no
 * terminal event.
 */
export async function parseAskStream(
  source: AsyncIterable<Uint8Array>,
  onEvent: (e: AskEvent) => void,
): Promise<AskResponse> {
  const decoder = new TextDecoder();
  let buf = '';
  let result: AskResponse | undefined;

  const handle = (line: string) => {
    if (!line.trim()) return;
    const e = JSON.parse(line) as AskEvent;
    onEvent(e);
    if (e.type === 'result') {
      // Explicit copy (not `{ type, ...rest }`) to avoid an unused `type` binding
      // under noUnusedLocals.
      result = {
        diff: e.diff,
        files: e.files,
        durationMs: e.durationMs,
        stdout: e.stdout,
        stderr: e.stderr,
        exitCode: e.exitCode,
      };
    } else if (e.type === 'error') {
      throw new Error(e.message);
    }
  };

  for await (const chunk of source) {
    buf += decoder.decode(chunk, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) handle(line);
  }
  if (buf.trim()) handle(buf);

  if (!result) throw new Error('agent stream ended without result');
  return result;
}
```

(d) Rewrite the `ask` method on `AgentClient`:

```ts
  async ask(body: AskRequest, onEvent?: (e: AskEvent) => void): Promise<AskResponse> {
    const res = await request(`${this.cfg.remote.agentUrl}/ask`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      bodyTimeout: this.cfg.ai.timeoutSec * 1000,
      headersTimeout: this.cfg.ai.timeoutSec * 1000,
    });
    if (res.statusCode !== 200) {
      const text = await res.body.text();
      throw new Error(`Agent /ask returned ${res.statusCode}: ${text}`);
    }
    return parseAskStream(res.body, onEvent ?? (() => {}));
  }
```

Note: undici's `res.body` is an async-iterable of `Uint8Array` chunks, so it
satisfies `parseAskStream`'s `source` parameter directly.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter patchwire exec vitest run test/lib/client-ask.test.ts && pnpm --filter patchwire typecheck`
Expected: PASS — parsing tests green; typecheck clean. (No other file imports `AskRequest`/`AskResponse` by name — they were only declared and used internally in `client.ts` — so moving them to the protocol package is self-contained. `commands/ask.ts` calls `client.ask(...)` with an inline object literal and is updated in Task 5.)

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/client.ts packages/cli/test/lib/client-ask.test.ts
git commit -m "feat(cli): AgentClient.ask parses NDJSON stream, resolves AskResponse"
```

---

## Task 5: Surface queue position in `runAsk`

**Files:**
- Modify: `packages/cli/src/commands/ask.ts:28-32`

This is wiring a callback into a print statement; the behavior is covered by the
e2e smoke (Task 6 Step 3). No new unit test — `runAsk` has no existing unit test
harness and adding one would mean mocking the whole client + rsync for one log
line (not worth it).

- [ ] **Step 1: Pass an onEvent callback that logs queue position**

In `packages/cli/src/commands/ask.ts`, replace lines 28-32:

```ts
  const client = new AgentClient(cfg);
  log.step('Asking Patchwire…');
  const askStart = Date.now();
  const res = await client.ask({ prompt, project: cfg.project });
  log.ok(`Remote run finished in ${res.durationMs}ms (CLI total ${Date.now() - askStart}ms)`);
```

with:

```ts
  const client = new AgentClient(cfg);
  const askStart = Date.now();
  const res = await client.ask({ prompt, project: cfg.project }, (e) => {
    if (e.type === 'queued') log.step(`Queued — position ${e.position}…`);
    else if (e.type === 'accepted') log.step('Asking Patchwire…');
  });
  log.ok(`Remote run finished in ${res.durationMs}ms (CLI total ${Date.now() - askStart}ms)`);
```

Rationale: `Asking Patchwire…` now prints on `accepted` (when the run actually
starts), so a queued user first sees `Queued — position N…`.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter patchwire typecheck`
Expected: PASS. If it reports `AskEvent` is implicitly `any` on the callback
param, add `import type { AskEvent } from '@patchwire/protocol';` and type the
param as `(e: AskEvent) =>`.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/commands/ask.ts
git commit -m "feat(cli): show live queue position during patchwire ask"
```

---

## Task 6: Full verification + docs + tag

**Files:**
- Modify: `packages/website/src/content/docs/agent.md` (audit/concurrency section neighbor)
- Modify: `packages/website/src/content/docs/api.md` (if it documents `/ask`'s response shape)

- [ ] **Step 1: Full CLI pipeline**

Run: `cd packages/cli && pnpm verify`
Expected: typecheck, tests, build, smoke all green (modulo the known environmental flake noted at `test/agent.test.ts` around the timeout test). If `pnpm verify` is not defined, run `pnpm --filter patchwire typecheck && pnpm --filter patchwire exec vitest run && pnpm --filter patchwire build`.

- [ ] **Step 2: Confirm the smoke e2e exercises the new path**

Read `packages/cli/scripts/smoke.sh`. Confirm it runs a real `patchwire ask`
turn. If it asserts on `/ask` returning a single JSON body anywhere (e.g. piping
the response to `jq` expecting an object), update that assertion to read the
final `result` line of the NDJSON stream instead:

```bash
# old: curl ... /ask | jq .diff
# new: curl ... /ask | grep '"type":"result"' | tail -1 | jq -r .diff
```

(Use the project's existing request mechanism in the script — do not introduce
`curl` if the script drives the real CLI binary, which already speaks NDJSON.)
Run the smoke script per the repo's usual invocation and confirm it passes.

- [ ] **Step 3: Read the docs before editing**

```bash
cat packages/website/src/content/docs/agent.md
cat packages/website/src/content/docs/api.md
```

- [ ] **Step 4: Update `agent.md`**

In the section describing `/ask` (near the "Concurrency + queue" / "Audit log"
sections added in phases 3–4), add:

```markdown
### Streamed `/ask` (v0.2.4+)

`POST /ask` responds with an NDJSON stream (`application/x-ndjson`), one JSON
event per line:

- `{"type":"queued","position":N}` — emitted once, only when the request waits
  behind others on the global concurrency cap.
- `{"type":"accepted","queueWaitMs":N}` — the slot is granted and the run starts.
- `{"type":"result","diff":…,"files":[…],"durationMs":N,"stdout":…,"stderr":…,"exitCode":N}`
  — terminal success.
- `{"type":"error","code":…,"message":…}` — terminal failure mid-run
  (`run_failed`, `diff_failed`, or `internal`).

Pre-flight rejections (bad body, missing project, not a git repo, dirty tree)
are still returned as plain HTTP status codes (400/404/412/409) before the
stream begins. The CLI surfaces the queue position live: `Queued — position 2…`.
```

- [ ] **Step 5: Update `api.md` if needed**

If `api.md` documents `/ask` as returning a single JSON object, replace that
description with a pointer to the NDJSON event list in `agent.md` (do not
duplicate the full list). If `api.md` does not mention `/ask`'s response shape,
skip this step.

- [ ] **Step 6: Commit docs**

```bash
git add packages/website/src/content/docs/agent.md packages/website/src/content/docs/api.md
git commit -m "docs: streamed /ask NDJSON protocol (v0.2 phase 5)"
```

If `git show --stat HEAD` lists files other than those two docs, investigate.

- [ ] **Step 7: Tag**

```bash
git tag -a v0.2.4-phase5 -m "Phase 5: streamed /ask (NDJSON live queue visibility)"
```

---

## Spec coverage check

| Spec requirement | Covered by |
|---|---|
| `/ask` streams NDJSON (`application/x-ndjson`) | Task 3 Step 4 |
| `AskEvent` union `queued`/`accepted`/`result`/`error` in `protocol` | Task 1 |
| `AskRequest`/`AskResponse` moved to `protocol`, `files: string[]` | Task 1, Task 4 Step 3a |
| One-shot `queued { position }`, only when waiting | Task 2 (callback), Task 3 (emit), Task 2 tests |
| `accepted` carries `queueWaitMs`; `X-Patchwire-Queue-*` headers removed | Task 3 Step 4 + Step 6 |
| `result` == existing `AskResponse` payload | Task 1, Task 3 Step 4, Task 4 |
| Hard switch, single consumer updated | Task 4 |
| `acquire(user, onQueued?)`, `/chat` untouched | Task 2 (optional param), Task 2 regression test |
| Pre-flight = HTTP errors; runtime failure = `error` event | Task 3 (handler boundary), Task 3 Step 2 error test |
| `resetClean` / `release` / `reply.raw.end()` on every path | Task 3 Step 4 single `finally` |
| Audit on success only | Task 3 Step 4 (append before `result`, not in error paths) |
| CLI shows live queue position | Task 5 |
| Supersedes overarching §6.2 | already noted in spec §8 (committed `5bbb753`) |
| Docs updated | Task 6 |
