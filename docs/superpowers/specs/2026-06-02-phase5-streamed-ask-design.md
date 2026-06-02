# Phase 5: Streamed `/ask` (live queue visibility) — design spec

**Status:** approved (brainstorm 2026-06-02)
**Supersedes:** §6.2 ("SSE event format") of `2026-06-01-multi-developer-agent-design.md` — see §8 below.

## 1. Context

`/ask` is currently a blocking JSON POST. The handler awaits the whole run and
returns one body: `{ diff, files, durationMs, stdout, stderr, exitCode }`. Queue
information is conveyed via `X-Patchwire-Queue-Wait-Ms` /
`X-Patchwire-Queue-Position-At-Entry` response headers that only resolve *after*
the wait — and **no consumer reads them today** (write-only, added in phase 3).
The CLI prints `Asking Patchwire…` and then blocks silently, giving the user no
feedback while their request waits behind others in the concurrency queue.

Phases 1–4 (identity, per-user paths, concurrency/queue, audit log) shipped the
multi-developer agent with this blocking interim. The original overarching
design (`2026-06-01-multi-developer-agent-design.md` §6.2) always intended
`/ask` to stream. The streaming `/chat` endpoint that actually shipped uses
**NDJSON** (`reply.hijack()` + newline-delimited JSON), not the true SSE framing
the original doc sketched. This spec brings `/ask` into line with that shipped
reality.

## 2. Goal

A single, focused slice: **live queue visibility**. The client sees a one-shot
`queued { position }` event while it waits, an `accepted` event when its slot is
granted, and then the final `result` (or `error`). `runAi` stays buffered — the
claude run itself is not streamed.

## 3. Non-goals

- Streaming claude's stdout / progress during the run (`runAi` stays buffered).
- Token-delta / `chat_text`-style streaming for `/ask` (that is `/chat`'s job).
- Ticking position updates (3→2→1). Position is emitted **once** at entry. A
  later phase can add ticking via the same enqueue handle if needed.
- True SSE framing (`event:`/`data:`, `text/event-stream`, browser `EventSource`).
  We use NDJSON to match `/chat`. The name "SSE" from earlier phase notes is
  retained loosely; the wire format is NDJSON.
- Backward compatibility / JSON fallback. `/ask` becomes NDJSON-only (hard
  switch). `/ask` has exactly one consumer — the CLI's `AgentClient.ask` — and
  the agent + CLI are pre-1.0 and ship together. The VS Code extension uses
  `/chat`, not `/ask`.
- The §6.2-era extras not part of this slice: `total` in `queued`, `503`/`507`
  status codes, token-revoked-mid-stream, disk-pressure pre-flight, write-timeout
  backpressure. These remain deferred follow-ups, unchanged by this spec.

## 4. Wire protocol — `AskEvent`

`/ask` responds with `content-type: application/x-ndjson`: one JSON object per
line, `\n`-delimited. Identical framing to `/chat`.

New union, added to `packages/protocol/src/events.ts` and re-exported from
`packages/protocol/src/index.ts`:

```ts
export type AskEvent =
  | { type: 'queued'; position: number }            // emitted ONCE, only if the request waits
  | { type: 'accepted'; queueWaitMs: number }       // slot granted, run starting
  | { type: 'result';                               // terminal success
      diff: string;
      files: ChangedFile[];
      durationMs: number;
      stdout: string;
      stderr: string;
      exitCode: number;
    }
  | { type: 'error'; code: string; message: string };  // terminal failure (mid-stream)
```

`AskRequest` and `AskResponse` (currently inline in `packages/cli/src/lib/client.ts`)
move into `packages/protocol` alongside `AskEvent`, so producer (agent) and
consumer (CLI) share one source of truth. `AskResponse` keeps its current shape
— it is exactly the payload of the `result` event minus the `type` tag.

### 4.1 Lifecycle on the wire

- Request waits for a slot: `queued` → `accepted` → (`result` | `error`).
- Slot free immediately: `accepted` → (`result` | `error`). **No `queued` line.**
- Exactly one terminal event (`result` or `error`); then the stream ends.

### 4.2 Field notes

- `position` is 1-indexed (you are Nth in line). Reuses the existing
  `positionAtEntry` computation in `concurrency.ts`.
- `queueWaitMs` lives on `accepted` (was an `X-Patchwire-Queue-*` header; in the
  superseded §6.2 it lived inside `done`).
- camelCase throughout, matching shipped `AskResponse` / `ChatEvent`.
- A non-zero claude `exitCode` is **not** an error — it produces a `result`
  event with `exitCode` set; the CLI warns on it. Only a thrown / spawn failure
  becomes an `error` event.

## 5. Server changes

### 5.1 `ConcurrencyManager.acquire(user, onQueued?)` — Approach A

```ts
async acquire(
  user: string,
  onQueued?: (info: { position: number }) => void,
): Promise<Lease>
```

When (and only when) the request must wait on the global semaphore, the manager
invokes `onQueued({ position })` **once**, synchronously at the point it
determines it will wait — reusing the same `positionAtEntry` computation that
already exists around `concurrency.ts:59`. If a slot is free, the callback never
fires. The return value (`Lease`) is unchanged.

`/chat`'s call site stays exactly `acquire(username)` — the parameter is
optional, so that handler is untouched.

### 5.2 `/ask` handler rewrite (`packages/cli/src/agent/server.ts`)

1. **Pre-flight stays plain HTTP** (before any hijack), unchanged from today:
   body parse → `400`; project name escapes root → `400`; project missing →
   `404`; not a git repo → `412`; dirty working tree → `409`. Same JSON error
   bodies. Rationale: these are knowable before committing to a stream, and HTTP
   status codes are more useful than an error frame for a malformed request.
2. After pre-flight passes:
   `reply.raw.setHeader('content-type', 'application/x-ndjson')` + `reply.hijack()`;
   define `emit` (same one-liner as `/chat`: `reply.raw.write(JSON.stringify(e) + '\n')`).
3. `const lease = await concurrency.acquire(username, ({ position }) => emit({ type: 'queued', position }));`
4. `emit({ type: 'accepted', queueWaitMs: lease.queueWaitMs });`
5. Run buffered `runAi` → `captureDiff` → `resetClean` (unchanged logic). Write
   the **same audit-log entry** as today (success only). `emit({ type: 'result', … })`.
6. Any post-hijack throw → `emit({ type: 'error', code, message })`.
7. `finally`: `resetClean(projectDir)` (best-effort), `concurrency.release(lease)`,
   `reply.raw.end()`.

The `X-Patchwire-Queue-*` response headers (`server.ts:181-184`) are **removed** —
`queued` / `accepted` replace them, and nothing consumed them.

## 6. Client + CLI changes

### 6.1 `AgentClient.ask` (`packages/cli/src/lib/client.ts`)

```ts
async ask(body: AskRequest, onEvent?: (e: AskEvent) => void): Promise<AskResponse>
```

- Read the response body as a stream; split on `\n`; `JSON.parse` each non-empty
  line as an `AskEvent`; forward every event to `onEvent?.(e)`.
- `result` → resolve to `{ diff, files, durationMs, stdout, stderr, exitCode }`
  (the existing `AskResponse` shape).
- `error` → `throw new Error(message)` (carrying `code`), matching today's
  throw-on-failure contract.
- Stream ends with no terminal event → throw `"agent stream ended without result"`.
- Pre-flight HTTP error (non-200 before the stream) → throw with status + body
  text, exactly as today.

### 6.2 `runAsk` (`packages/cli/src/commands/ask.ts`)

Pass an `onEvent` that surfaces the wait:

- `queued` → `log.step(\`Queued — position ${position}…\`)`
- `accepted` → `log.step('Asking Patchwire…')` (moves here, so it prints when the
  run actually starts rather than before the wait)
- Everything after (`result` handling, exit-code warning, empty-diff branch,
  save-only, interactive apply) is **unchanged** — it operates on the resolved
  `AskResponse`.

User-visible effect: instead of a silent block, the user sees
`Queued — position 2…` then `Asking Patchwire…` then the diff.

## 7. Error handling

Split by *when* the failure is knowable.

**Pre-hijack → HTTP status + JSON** (client throws on non-200, as today):

| Condition | Status | Body |
|---|---|---|
| Bad/invalid body | `400` | `{ error, issues }` |
| Project name escapes root | `400` | `{ error: 'invalid project name' }` |
| Project missing | `404` | `{ error }` |
| Not a git repo | `412` | `{ error }` |
| Dirty working tree | `409` | `{ error, status }` |

**Post-hijack → `error` event** (client throws `Error(message)` carrying `code`):

| Condition | `code` |
|---|---|
| `runAi` throws / claude spawn fails | `run_failed` |
| `captureDiff` fails | `diff_failed` |
| Any other post-hijack throw | `internal` |

**Invariants preserved on every path:**

- `resetClean(projectDir)` always runs in `finally` (working tree restored).
- `concurrency.release(lease)` always runs in `finally` (no leaked slot).
- `reply.raw.end()` always called after hijack.
- Audit log writes **only on success** (after `result`) — failures are not
  audited, matching current behavior.

## 8. Reconciliation with the overarching design

This spec **supersedes §6.2 ("SSE event format")** of
`2026-06-01-multi-developer-agent-design.md`. Divergences and rationale:

| §6.2 (original) | Phase 5 (this spec) | Why |
|---|---|---|
| True SSE (`event:` / `data:`, `text/event-stream`) | NDJSON (`application/x-ndjson`) | Matches `/chat`, which shipped NDJSON in phases 1–4 |
| `queued { position, total }` | `queued { position }` | `total` dropped — not needed for the CLI message |
| `started { started_at }` | `accepted { queueWaitMs }` | Clearer terminal-vs-transitional naming; carries the wait |
| `done { …, queue_wait_ms }` | `result { … }` (wait on `accepted`) | One terminal success event; wait reported earlier |
| snake_case fields | camelCase | Matches the actual shipped `AskResponse` / `ChatEvent` |

A one-line pointer to this spec is added at §6.2 of the overarching doc so the
two documents do not contradict.

## 9. Testing strategy

- **`ConcurrencyManager.acquire` callback** — unit: a request that must wait
  fires `onQueued` once with the expected position; a request that gets a free
  slot never fires it. `/chat`'s no-callback call still works (regression).
- **`/ask` happy path (no wait)** — integration with mocked AI: stream is
  `accepted` then `result`; no `queued`; `result` payload equals today's
  `AskResponse`; audit line written once.
- **`/ask` queued path** — saturate the global cap so a second `/ask` waits;
  assert it emits `queued { position }` then `accepted` then `result`; assert
  slot released and tree reset.
- **`/ask` error path** — mock `runAi` to throw; assert `error { code:'run_failed' }`
  event, `resetClean` ran, slot released, **no** audit line.
- **Pre-flight HTTP errors** — 400/404/412/409 still returned as JSON status
  responses *before* any stream byte (no hijack).
- **`AgentClient.ask`** — unit over a fake NDJSON body: collapses to
  `AskResponse` on `result`; throws on `error`; throws on truncated stream;
  forwards each event to `onEvent`.
- **CLI smoke** — `scripts/smoke.sh` exercises a real `patchwire ask` and shows
  the `Queued`/`Asking` lines (extend the existing e2e rather than add a new one).

## 10. Spec coverage check

| Requirement | Covered by |
|---|---|
| `/ask` streams NDJSON | §4, §5.2 |
| One-shot `queued { position }` only when waiting | §4.1, §5.1 |
| `accepted` carries `queueWaitMs`; headers removed | §4.2, §5.2 |
| `result` == existing `AskResponse` payload | §4, §6.1 |
| Hard switch, no JSON fallback | §3, §6.1 |
| `acquire(user, onQueued?)`, `/chat` untouched | §5.1 |
| Pre-flight = HTTP errors; runtime = `error` event | §7 |
| `resetClean` / `release` / `end` invariants | §5.2, §7 |
| Audit on success only | §5.2, §7 |
| `AskEvent`/`AskRequest`/`AskResponse` in `protocol` | §4 |
| CLI surfaces queue position to the user | §6.2 |
| Supersedes overarching §6.2 | §8 |
