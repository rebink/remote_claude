# Service Projection — Phase 2 (Desktop UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a desktop "Services" panel that discovers local Docker/Dart services, binds them onto the remote agent's loopback over a long-lived streaming CLI session, and shows live status — backed by a hardened manager (exponential backoff, `failed`, `stale`).

**Architecture:** Two sub-units. (1) CLI: harden `makeManager` (backoff + give-up + stale + retry) and add `patchwire services serve --stream`, a long-lived process that owns the manager and speaks NDJSON over stdin/stdout. (2) Desktop: a Tauri `ServicesSessionState` running one session per workspace (mirroring `start_sync_watch`), a pure reducer over `pw://services` events, and a `ServicesPanel.svelte` in the Workspace screen with per-project persistence + auto-rebind.

**Tech Stack:** TypeScript (CLI, ESM `.ts` specifiers, vitest), Rust (Tauri 2, `tauri-plugin-shell` sidecar), Svelte 5 + Vitest/Testing-Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-06-19-service-projection-p2-desktop-design.md`
**Branch:** `feat/service-projection-p2-desktop` (based on P1 / PR #74).

---

## Wire Protocol (shared contract — CLI emits, desktop parses)

Commands (desktop → CLI, one JSON object per stdin line):
- `{ "cmd": "discover", "dartVmUri"?: string }`
- `{ "cmd": "bind", "id": string }`
- `{ "cmd": "unbind", "id": string }`
- `{ "cmd": "retry", "id": string }`

Events (CLI → desktop, one JSON object per stdout line):
- `{ "type": "candidates", "services": DiscoveredService[] }`
- `{ "type": "status", "projections": Projection[] }`
- `{ "type": "error", "message": string }`

`DiscoveredService` = `{ id, label, kind, localPort, connectionHint, meta? }`; `Projection` = `{ service, remotePort, mirrored, status }` (from P1 `services/types.ts`).

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/cli/src/services/manager.ts` (modify) | Add backoff, `attempts`/`failed`, `refresh`/`stale`, `retry` |
| `packages/cli/src/services/types.ts` (modify) | Add `refresh`/`retry` to `ServiceProjectionManager` |
| `packages/cli/src/services/session.ts` (create) | `runServicesSession(io, deps)` NDJSON loop |
| `packages/cli/src/commands/services.ts` (modify) | Add `serve --stream` subcommand |
| `packages/desktop/src/lib/services-session.ts` (create) | `parseServicesLine` + `reduceServices` |
| `packages/desktop/src/lib/ipc.ts` (modify) | `startServices`/`servicesSend`/`stopServices`/`onServicesEvent` |
| `packages/desktop/src/lib/types.ts` (modify) | `Project.boundServiceIds?: string[]` |
| `packages/desktop/src-tauri/src/lib.rs` (modify) | `ServicesSessionState` + 3 commands + register |
| `packages/desktop/src/components/ServicesPanel.svelte` (create) | The panel UI |
| `packages/desktop/src/screens/Workspace.svelte` (modify) | Mount the panel |

---

## Task 1: Manager — exponential backoff + give-up (`failed`)

**Files:**
- Modify: `packages/cli/src/services/manager.ts`
- Test: `packages/cli/test/services/manager.test.ts` (extend)

- [ ] **Step 1: Add the failing tests** (append inside the existing `describe('makeManager', ...)` block in `packages/cli/test/services/manager.test.ts`):

```ts
  it('backs off with the attempt number on each reconnect', async () => {
    const { transport, closes } = upTransport();
    const backoff = vi.fn((_a: number) => 0);
    const m = makeManager(transport, { probe: async () => {}, delay: async () => {}, backoff });
    await m.bind(svc);
    closes[closes.length - 1](255);
    await new Promise((r) => setTimeout(r, 0));
    expect(backoff).toHaveBeenCalledWith(1);
  });

  it('gives up with status "failed" after maxAttempts consecutive drops', async () => {
    const { transport, closes } = upTransport();
    const m = makeManager(transport, { probe: async () => {}, delay: async () => {}, maxAttempts: 2 });
    await m.bind(svc);
    for (let i = 0; i < 3; i++) {
      closes[closes.length - 1](255);
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(m.status()[0].status).toBe('failed');
  });
```

- [ ] **Step 2: Run, verify the two new tests FAIL** (backoff not called / status never 'failed'):

Run: `pnpm --filter @rebink/patchwire test -- services/manager`
Expected: 2 new tests FAIL; the 4 existing pass.

- [ ] **Step 3: Replace the body of `packages/cli/src/services/manager.ts`** with the hardened version (this supersedes the P1 file, including removing the P1 "reserved for P2" comment):

```ts
// packages/cli/src/services/manager.ts
import { firstStablePort } from './mirror.ts';
import type {
  DiscoveredService, Projection, ServiceProjectionManager, Transport, TunnelHandle,
} from './types.ts';

interface ManagerDeps {
  /** Probe window passed to firstStablePort (injectable for tests). */
  probe?: () => Promise<void>;
  /** Sleeper for the reconnect backoff; receives the computed ms (injectable for tests). */
  delay?: (ms: number) => Promise<void>;
  /** Backoff in ms for a given 1-based attempt. Default: 1s,2s,4s,… capped at 30s. */
  backoff?: (attempt: number) => number;
  /** Consecutive failed reconnects before giving up (status 'failed'). Default 6. */
  maxAttempts?: number;
}

interface Entry {
  projection: Projection;
  handle: TunnelHandle;
  stopped: boolean;
  attempts: number;
}

export function makeManager(transport: Transport, deps: ManagerDeps = {}): ServiceProjectionManager {
  const entries = new Map<string, Entry>();
  const listeners: ((p: Projection[]) => void)[] = [];
  const delay = deps.delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const backoff = deps.backoff ?? ((attempt: number) => Math.min(1000 * 2 ** (attempt - 1), 30_000));
  const maxAttempts = deps.maxAttempts ?? 6;

  const snapshot = () => [...entries.values()].map((e) => e.projection);
  const emit = () => { const s = snapshot(); for (const l of listeners) l(s); };

  function supervise(entry: Entry, onClose: (code: number | null) => void) {
    entry.handle = transport.open(
      { localPort: entry.projection.service.localPort, remotePort: entry.projection.remotePort },
      onClose,
    );
  }

  function makeOnClose(entry: Entry): (code: number | null) => void {
    const onClose = async () => {
      if (entry.stopped || entry.projection.status === 'stale') return;
      entry.attempts += 1;
      if (entry.attempts > maxAttempts) {
        entry.projection.status = 'failed';
        emit();
        return;
      }
      entry.projection.status = 'reconnecting';
      emit();
      await delay(backoff(entry.attempts));
      if (entry.stopped || entry.projection.status === 'stale') return;
      supervise(entry, onClose);
      entry.projection.status = 'active';
      emit();
    };
    return onClose;
  }

  return {
    async bind(service: DiscoveredService): Promise<Projection> {
      const existing = entries.get(service.id);
      if (existing) return existing.projection;

      const { handle, remotePort, mirrored } = await firstStablePort(transport, service.localPort, { probe: deps.probe });
      const projection: Projection = { service, remotePort, mirrored, status: 'active' };
      const entry: Entry = { projection, handle, stopped: false, attempts: 0 };
      entries.set(service.id, entry);

      const onClose = makeOnClose(entry);
      entry.handle.stop();
      supervise(entry, onClose);

      emit();
      return projection;
    },

    async unbind(id: string): Promise<void> {
      const entry = entries.get(id);
      if (!entry) return;
      entry.stopped = true;
      entry.handle.stop();
      entries.delete(id);
      emit();
    },

    refresh(present: DiscoveredService[]): void {
      const ids = new Set(present.map((s) => s.id));
      for (const entry of entries.values()) {
        if (!ids.has(entry.projection.service.id) && entry.projection.status !== 'stale') {
          entry.projection.status = 'stale';
          entry.handle.stop(); // onClose returns early because status === 'stale'
        }
      }
      emit();
    },

    async retry(id: string): Promise<void> {
      const entry = entries.get(id);
      if (!entry) return;
      entry.stopped = false;
      entry.attempts = 0;
      entry.projection.status = 'reconnecting';
      emit();
      const { handle, remotePort, mirrored } = await firstStablePort(transport, entry.projection.service.localPort, { probe: deps.probe });
      entry.handle = handle;
      entry.projection.remotePort = remotePort;
      entry.projection.mirrored = mirrored;
      entry.handle.stop();
      supervise(entry, makeOnClose(entry));
      entry.projection.status = 'active';
      emit();
    },

    status(): Projection[] {
      return snapshot();
    },

    on(_event: 'change', cb: (p: Projection[]) => void): void {
      listeners.push(cb);
    },

    stopAll(): void {
      for (const entry of entries.values()) {
        entry.stopped = true;
        entry.handle.stop();
      }
      entries.clear();
      emit();
    },
  };
}
```

Note: this adds `refresh`/`retry` method bodies now (used in Task 2's tests). They will not type-check against `ServiceProjectionManager` until Task 2 widens the interface — but Task 1 only RUNS the manager tests, which import `makeManager` directly (not the interface). If `pnpm typecheck` is run at Task 1 it will fail on the interface; defer the full typecheck to Task 2. (The per-task test command below does not run typecheck.)

- [ ] **Step 4: Run the manager tests, verify all 6 PASS:**

Run: `pnpm --filter @rebink/patchwire test -- services/manager`
Expected: 6 pass (4 original + 2 new).

- [ ] **Step 5: Commit:**

```bash
git add packages/cli/src/services/manager.ts packages/cli/test/services/manager.test.ts
git commit -m "feat(cli): manager exponential backoff + give-up (failed) status"
```

---

## Task 2: Manager — `stale` via `refresh` + `retry`, widen interface

**Files:**
- Modify: `packages/cli/src/services/types.ts`
- Test: `packages/cli/test/services/manager.test.ts` (extend)

(The method bodies already exist from Task 1; this task widens the interface and tests the new behaviors.)

- [ ] **Step 1: Add the failing tests** (append inside `describe('makeManager', ...)`):

```ts
  it('refresh marks a vanished bound service as stale and stops its tunnel', async () => {
    const { transport } = upTransport();
    const m = makeManager(transport, { probe: async () => {}, delay: async () => {} });
    await m.bind(svc);
    m.refresh([]); // svc no longer present
    expect(m.status()[0].status).toBe('stale');
  });

  it('retry re-arms a stale service back to active', async () => {
    const { transport } = upTransport();
    const m = makeManager(transport, { probe: async () => {}, delay: async () => {} });
    await m.bind(svc);
    m.refresh([]);
    await m.retry(svc.id);
    expect(m.status()[0].status).toBe('active');
  });

  it('retry re-arms a failed service back to active', async () => {
    const { transport, closes } = upTransport();
    const m = makeManager(transport, { probe: async () => {}, delay: async () => {}, maxAttempts: 1 });
    await m.bind(svc);
    closes[closes.length - 1](255);
    await new Promise((r) => setTimeout(r, 0));
    closes[closes.length - 1](255);
    await new Promise((r) => setTimeout(r, 0));
    expect(m.status()[0].status).toBe('failed');
    await m.retry(svc.id);
    expect(m.status()[0].status).toBe('active');
  });
```

- [ ] **Step 2: Run, verify the 3 new tests FAIL** (TypeScript will error that `refresh`/`retry` are not on the manager type, since the interface isn't widened yet):

Run: `pnpm --filter @rebink/patchwire test -- services/manager`
Expected: the 3 new tests FAIL to compile/run (method not on type).

- [ ] **Step 3: Widen `ServiceProjectionManager`** in `packages/cli/src/services/types.ts`. Find the interface and add two members:

```ts
export interface ServiceProjectionManager {
  bind(service: DiscoveredService): Promise<Projection>;
  unbind(id: string): Promise<void>;
  /** Reconcile against currently-present services; absent bound entries become 'stale'. */
  refresh(present: DiscoveredService[]): void;
  /** Re-arm a 'failed' or 'stale' entry: reset attempts, re-bind (re-mirror), back to 'active'. */
  retry(id: string): Promise<void>;
  status(): Projection[];
  on(event: 'change', cb: (projections: Projection[]) => void): void;
  stopAll(): void;
}
```

- [ ] **Step 4: Run tests + typecheck, verify PASS (9 manager tests; whole package typechecks now):**

Run: `pnpm --filter @rebink/patchwire test -- services/manager && pnpm --filter @rebink/patchwire typecheck`
Expected: 9 manager tests pass; typecheck clean.

- [ ] **Step 5: Commit:**

```bash
git add packages/cli/src/services/manager.ts packages/cli/src/services/types.ts packages/cli/test/services/manager.test.ts
git commit -m "feat(cli): manager stale/refresh + retry; widen manager interface"
```

---

## Task 3: Streaming session core (`session.ts`)

**Files:**
- Create: `packages/cli/src/services/session.ts`
- Test: `packages/cli/test/services/session.test.ts`

`runServicesSession(io, deps)` runs the NDJSON loop over an injectable IO + dependencies (manager + discover). No process/stdin wiring here (that is Task 4).

- [ ] **Step 1: Write the failing test** at `packages/cli/test/services/session.test.ts`:

```ts
// packages/cli/test/services/session.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runServicesSession, type SessionIo, type SessionDeps } from '../../src/services/session.ts';
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
```

- [ ] **Step 2: Run, verify FAIL** (module not found):

Run: `pnpm --filter @rebink/patchwire test -- services/session`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/cli/src/services/session.ts`:**

```ts
// packages/cli/src/services/session.ts
import type { DiscoveredService, Projection, ServiceProjectionManager } from './types.ts';

export interface SessionIo {
  onLine(cb: (line: string) => void): void;
  write(obj: unknown): void;
  onClose(cb: () => void): void;
}

export interface SessionDeps {
  manager: ServiceProjectionManager;
  discover: (dartVmUri?: string) => Promise<DiscoveredService[]>;
  /** Called with the latest projections on every manager change (manifest write). */
  onManifest?: (projections: Projection[]) => void;
}

interface Command {
  cmd?: string;
  id?: string;
  dartVmUri?: string;
}

/** Run the NDJSON command/event loop over an injectable IO. */
export function runServicesSession(io: SessionIo, deps: SessionDeps): void {
  const { manager, discover, onManifest } = deps;
  let candidates: DiscoveredService[] = [];

  manager.on('change', (projections) => {
    io.write({ type: 'status', projections });
    onManifest?.(projections);
  });

  io.onLine((line) => {
    const text = line.trim();
    if (!text) return;
    let msg: Command;
    try {
      msg = JSON.parse(text) as Command;
    } catch {
      io.write({ type: 'error', message: `bad command: ${text}` });
      return;
    }
    void handle(msg);
  });

  io.onClose(() => manager.stopAll());

  async function handle(msg: Command): Promise<void> {
    try {
      switch (msg.cmd) {
        case 'discover': {
          candidates = await discover(msg.dartVmUri);
          io.write({ type: 'candidates', services: candidates });
          manager.refresh(candidates);
          return;
        }
        case 'bind': {
          const svc = candidates.find((s) => s.id === msg.id);
          if (!svc) { io.write({ type: 'error', message: `unknown service id: ${msg.id}` }); return; }
          await manager.bind(svc);
          return;
        }
        case 'unbind':
          if (msg.id) await manager.unbind(msg.id);
          return;
        case 'retry':
          if (msg.id) await manager.retry(msg.id);
          return;
        default:
          io.write({ type: 'error', message: `unknown cmd: ${String(msg.cmd)}` });
      }
    } catch (e) {
      io.write({ type: 'error', message: (e as Error).message ?? String(e) });
    }
  }
}
```

- [ ] **Step 4: Run test + typecheck, verify PASS (5 tests):**

Run: `pnpm --filter @rebink/patchwire test -- services/session && pnpm --filter @rebink/patchwire typecheck`

- [ ] **Step 5: Commit:**

```bash
git add packages/cli/src/services/session.ts packages/cli/test/services/session.test.ts
git commit -m "feat(cli): streaming services session NDJSON command/event loop"
```

---

## Task 4: `patchwire services serve --stream` subcommand

**Files:**
- Modify: `packages/cli/src/commands/services.ts`
- Test: `packages/cli/test/commands/services-serve.test.ts`

Wires real `process.stdin`/`stdout` + a real manager/discoverers into `runServicesSession`. The stdin loop is hard to unit-test; we test a small exported `makeStdioIo()` helper and validate the command via build.

- [ ] **Step 1: Write the failing test** at `packages/cli/test/commands/services-serve.test.ts`:

```ts
// packages/cli/test/commands/services-serve.test.ts
import { describe, it, expect, vi } from 'vitest';
import { makeStdioIo } from '../../src/commands/services.ts';

describe('makeStdioIo', () => {
  it('writes newline-delimited JSON to the sink and parses lines from the source', () => {
    const out: string[] = [];
    const handlers: Record<string, (b: string) => void> = {};
    const source = { on: (ev: string, cb: (b: string) => void) => { handlers[ev] = cb; } } as never;
    const sink = { write: (s: string) => { out.push(s); } } as never;
    const io = makeStdioIo(source, sink);

    const lines: string[] = [];
    io.onLine((l) => lines.push(l));
    io.write({ type: 'status', projections: [] });
    expect(out[0]).toBe('{"type":"status","projections":[]}\n');

    handlers['data']('{"cmd":"discover"}\n{"cmd":"unbind","id":"x"}\n');
    expect(lines).toEqual(['{"cmd":"discover"}', '{"cmd":"unbind","id":"x"}']);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (export missing):

Run: `pnpm --filter @rebink/patchwire test -- services-serve`
Expected: FAIL.

- [ ] **Step 3: Add to `packages/cli/src/commands/services.ts`** — an exported `makeStdioIo` plus the `serve --stream` subcommand. Add these imports at the top (next to the existing service imports):

```ts
import { runServicesSession, type SessionIo } from '../services/session.ts';
import { writeManifest } from '../services/manifest.ts'; // already imported in P1 — keep one import only
import { parseDartOutput } from '../services/discoverers/dart.ts'; // already imported — keep one
```

(If `writeManifest`/`parseDartOutput` are already imported from Task-10 P1 work, do NOT duplicate the import — reuse the existing line.)

Add the IO factory (line-buffers a readable stream, writes NDJSON to a writable):

```ts
import type { Readable, Writable } from 'node:stream';

/** Build a SessionIo over a readable line source and a writable sink (NDJSON). */
export function makeStdioIo(source: Readable, sink: Writable): SessionIo {
  let buf = '';
  let lineCb: (l: string) => void = () => {};
  source.on('data', (chunk: Buffer | string) => {
    buf += chunk.toString();
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      lineCb(line);
      nl = buf.indexOf('\n');
    }
  });
  return {
    onLine: (cb) => { lineCb = cb; },
    write: (obj) => { sink.write(JSON.stringify(obj) + '\n'); },
    onClose: (cb) => { source.on('end', cb); source.on('close', cb); },
  };
}
```

Then add the subcommand inside `registerServicesCommand` (alongside `discover`/`bind`):

```ts
  cmd
    .command('serve')
    .description('Long-lived projection session: NDJSON commands on stdin, events on stdout')
    .option('--stream', 'stream NDJSON events (required)')
    .action(() => {
      const target = loadSshTarget();
      const manager = makeManager(makeSshTransport(target));
      const io = makeStdioIo(process.stdin, process.stdout);
      process.stdin.resume();
      runServicesSession(io, {
        manager,
        discover: async (dartVmUri?: string) => {
          const docker = await makeDockerDiscoverer().discover();
          const dart = parseDartOutput(dartVmUri ?? process.env.PW_DART_OUTPUT ?? '');
          return aggregateDiscovered([docker, dart]);
        },
        onManifest: (projections) => { try { writeManifest(process.cwd(), projections); } catch { /* ignore */ } },
      });
    });
```

- [ ] **Step 4: Run test + typecheck + build, verify PASS:**

Run: `pnpm --filter @rebink/patchwire test -- services-serve && pnpm --filter @rebink/patchwire typecheck && pnpm --filter @rebink/patchwire build`
Expected: test passes; typecheck + build clean.

- [ ] **Step 5: Commit:**

```bash
git add packages/cli/src/commands/services.ts packages/cli/test/commands/services-serve.test.ts
git commit -m "feat(cli): services serve --stream session command"
```

---

## Task 5: Desktop reducer (`services-session.ts`)

**Files:**
- Create: `packages/desktop/src/lib/services-session.ts`
- Test: `packages/desktop/src/lib/services-session.test.ts`

- [ ] **Step 1: Write the failing test** at `packages/desktop/src/lib/services-session.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseServicesLine, reduceServices, initialServices, type ServicesView } from './services-session';

const svc = { id: 'docker:db:5432', label: 'Postgres', kind: 'docker', localPort: 5432, connectionHint: 'postgres://127.0.0.1:5432' };
const proj = { service: svc, remotePort: 5432, mirrored: true, status: 'active' };

describe('parseServicesLine', () => {
  it('parses a candidates event', () => {
    expect(parseServicesLine(JSON.stringify({ type: 'candidates', services: [svc] }))).toEqual({ type: 'candidates', services: [svc] });
  });
  it('returns null for malformed or unknown lines', () => {
    expect(parseServicesLine('nope')).toBeNull();
    expect(parseServicesLine(JSON.stringify({ type: 'bogus' }))).toBeNull();
  });
});

describe('reduceServices', () => {
  it('candidates event replaces the candidate list and clears error', () => {
    const s = reduceServices({ ...initialServices, error: 'x' }, { type: 'candidates', services: [svc] });
    expect(s.candidates).toEqual([svc]);
    expect(s.error).toBeUndefined();
  });
  it('status event replaces projections', () => {
    const s = reduceServices(initialServices, { type: 'status', projections: [proj] });
    expect(s.projections).toEqual([proj]);
  });
  it('error event sets the error message', () => {
    const s: ServicesView = reduceServices(initialServices, { type: 'error', message: 'bad' });
    expect(s.error).toBe('bad');
  });
});
```

- [ ] **Step 2: Run, verify FAIL:**

Run: `pnpm --filter patchwire-desktop test -- services-session`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `packages/desktop/src/lib/services-session.ts`:**

```ts
export interface WireService { id: string; label: string; kind: string; localPort: number; connectionHint: string; meta?: Record<string, string>; }
export interface WireProjection { service: WireService; remotePort: number; mirrored: boolean; status: string; }

export type ServicesEvent =
  | { type: 'candidates'; services: WireService[] }
  | { type: 'status'; projections: WireProjection[] }
  | { type: 'error'; message: string };

export interface ServicesView { candidates: WireService[]; projections: WireProjection[]; error?: string; }

export const initialServices: ServicesView = { candidates: [], projections: [] };

export function parseServicesLine(raw: string): ServicesEvent | null {
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const e = o as { type?: string; services?: unknown; projections?: unknown; message?: unknown };
  if (e.type === 'candidates' && Array.isArray(e.services)) return { type: 'candidates', services: e.services as WireService[] };
  if (e.type === 'status' && Array.isArray(e.projections)) return { type: 'status', projections: e.projections as WireProjection[] };
  if (e.type === 'error' && typeof e.message === 'string') return { type: 'error', message: e.message };
  return null;
}

export function reduceServices(state: ServicesView, ev: ServicesEvent): ServicesView {
  switch (ev.type) {
    case 'candidates': return { ...state, candidates: ev.services, error: undefined };
    case 'status': return { ...state, projections: ev.projections, error: undefined };
    case 'error': return { ...state, error: ev.message };
  }
}
```

- [ ] **Step 4: Run test, verify PASS:**

Run: `pnpm --filter patchwire-desktop test -- services-session`

- [ ] **Step 5: Commit:**

```bash
git add packages/desktop/src/lib/services-session.ts packages/desktop/src/lib/services-session.test.ts
git commit -m "feat(desktop): services event parser + reducer"
```

---

## Task 6: Desktop Rust — session state + commands

**Files:**
- Modify: `packages/desktop/src-tauri/src/lib.rs`

Mirrors `start_sync_watch`/`stop_sync_watch` exactly, plus a `services_send` that writes a line to the child's stdin.

- [ ] **Step 1: Add `ServicesSessionState`.** Near the existing `SyncWatchState` definition, add (use the same imports that file already has for `Mutex`, `AtomicBool`, and `CommandChild`):

```rust
#[derive(Default)]
struct ServicesSessionState {
    child: std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
    busy: std::sync::atomic::AtomicBool,
}
```

- [ ] **Step 2: Add the three commands** (place next to `start_sync_watch`):

```rust
#[tauri::command]
async fn start_services(
    app: tauri::AppHandle,
    state: tauri::State<'_, ServicesSessionState>,
    project_dir: String,
    dart_vm_uri: Option<String>,
) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    use tauri_plugin_shell::ShellExt;
    use tauri_plugin_shell::process::CommandEvent;
    use tauri::Emitter;

    if project_dir.trim().is_empty() { return Err("project_dir is required".into()); }
    if !std::path::Path::new(&project_dir).is_dir() { return Err("project_dir does not exist".into()); }

    // kill any prior session for this workspace
    if let Some(child) = state.child.lock().unwrap().take() { let _ = child.kill(); }

    let sidecar = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?;
    if state.busy.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return Err("a services session is already running".into());
    }
    let (mut rx, child) = match sidecar
        .current_dir(std::path::PathBuf::from(&project_dir))
        .args(["services", "serve", "--stream"])
        .spawn()
    {
        Ok(v) => v,
        Err(e) => { state.busy.store(false, Ordering::SeqCst); return Err(e.to_string()); }
    };
    *state.child.lock().unwrap() = Some(child);

    // if a Dart VM URI was detected, prime discovery with it
    if let Some(uri) = dart_vm_uri.filter(|u| !u.trim().is_empty()) {
        if let Some(child) = state.child.lock().unwrap().as_mut() {
            let line = format!("{{\"cmd\":\"discover\",\"dartVmUri\":{}}}\n", serde_json::to_string(&uri).unwrap_or_else(|_| "\"\"".into()));
            let _ = child.write(line.as_bytes());
        }
    }

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).trim_end().to_string();
                    if !line.is_empty() { let _ = app.emit("pw://services", line); }
                }
                CommandEvent::Terminated(_) => {
                    if let Some(st) = app.try_state::<ServicesSessionState>() {
                        *st.child.lock().unwrap() = None;
                        st.busy.store(false, Ordering::SeqCst);
                    }
                }
                _ => {}
            }
        }
    });
    Ok(())
}

#[tauri::command]
fn services_send(state: tauri::State<'_, ServicesSessionState>, json: String) -> Result<(), String> {
    let mut guard = state.child.lock().unwrap();
    let child = guard.as_mut().ok_or("no services session running")?;
    let line = format!("{}\n", json.trim_end());
    child.write(line.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn stop_services(state: tauri::State<'_, ServicesSessionState>) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    if let Some(child) = state.child.lock().unwrap().take() { let _ = child.kill(); }
    state.busy.store(false, Ordering::SeqCst);
    Ok(())
}
```

- [ ] **Step 3: Register state + commands.** In `run()`, add `.manage(ServicesSessionState::default())` next to the other `.manage(...)` calls, and add `start_services, services_send, stop_services,` to the `generate_handler!` list.

- [ ] **Step 4: Verify it compiles:**

Run: `cd packages/desktop/src-tauri && cargo build`
Expected: builds clean (the new commands + state compile and register). This is a slow build — allow several minutes. If `cargo test` is configured, run it too; otherwise compile is the gate.

- [ ] **Step 5: Commit:**

```bash
git add packages/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): tauri services session state + start/send/stop commands"
```

---

## Task 7: Desktop IPC + ServicesPanel + Workspace wire + persistence

**Files:**
- Modify: `packages/desktop/src/lib/ipc.ts`, `packages/desktop/src/lib/types.ts`, `packages/desktop/src/screens/Workspace.svelte`
- Create: `packages/desktop/src/components/ServicesPanel.svelte`
- Test: `packages/desktop/src/components/ServicesPanel.test.ts`

- [ ] **Step 1: Write the failing test** at `packages/desktop/src/components/ServicesPanel.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

import ServicesPanel from './ServicesPanel.svelte';

listenMock.mockResolvedValue(() => {});
invokeMock.mockResolvedValue(undefined);

const project = { id: 'p1', name: 'demo', branch: 'main', localPath: '/p', remotePath: '/r', host: 'h', user: 'u', lastStatus: 'unknown', syncPaused: false, connectionId: 'c1', boundServiceIds: [] };

describe('ServicesPanel', () => {
  it('starts a services session on mount', () => {
    render(ServicesPanel, { props: { project } });
    expect(invokeMock).toHaveBeenCalledWith('start_services', expect.objectContaining({ projectDir: '/p' }));
  });

  it('renders an empty hint when no candidates', () => {
    const { getByTestId } = render(ServicesPanel, { props: { project } });
    expect(getByTestId('services-empty')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, verify FAIL:**

Run: `pnpm --filter patchwire-desktop test -- ServicesPanel`
Expected: FAIL (module not found).

- [ ] **Step 3: Add IPC functions** to `packages/desktop/src/lib/ipc.ts` (mirror the existing `invoke`/`listen` wrappers):

```ts
export async function startServices(projectDir: string, dartVmUri?: string): Promise<void> {
  await invoke("start_services", { projectDir, dartVmUri: dartVmUri ?? null });
}
export async function servicesSend(cmd: Record<string, unknown>): Promise<void> {
  await invoke("services_send", { json: JSON.stringify(cmd) });
}
export async function stopServices(): Promise<void> {
  await invoke("stop_services");
}
export async function onServicesEvent(handler: (line: string) => void): Promise<import("@tauri-apps/api/event").UnlistenFn> {
  return listen<string>("pw://services", (e) => handler(e.payload));
}
```

(If `invoke`/`listen` are imported at the top of `ipc.ts`, reuse them; do not re-import.)

- [ ] **Step 4: Add the persistence field** to `packages/desktop/src/lib/types.ts` — in the `Project` interface add:

```ts
  boundServiceIds?: string[];
```

- [ ] **Step 5: Implement `packages/desktop/src/components/ServicesPanel.svelte`:**

```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import type { Project } from "../lib/types";
  import { startServices, servicesSend, stopServices, onServicesEvent, detectVmUri, saveProject } from "../lib/ipc";
  import { reduceServices, parseServicesLine, initialServices, type ServicesView } from "../lib/services-session";

  let { project }: { project: Project } = $props();
  let view = $state<ServicesView>(initialServices);
  let bound = $state<Set<string>>(new Set(project.boundServiceIds ?? []));

  onMount(() => {
    let un: (() => void) | undefined;
    (async () => {
      un = await onServicesEvent((line) => {
        const ev = parseServicesLine(line);
        if (ev) view = reduceServices(view, ev);
      });
      const vmUri = (await detectVmUri()) ?? undefined;
      await startServices(project.localPath, vmUri);
      await servicesSend({ cmd: "discover" });
      for (const id of bound) await servicesSend({ cmd: "bind", id });
    })();
    return () => { un?.(); stopServices(); };
  });

  function statusOf(id: string): string {
    const p = view.projections.find((p) => p.service.id === id);
    return p ? p.status : "available";
  }
  function remoteOf(id: string): string | null {
    const p = view.projections.find((p) => p.service.id === id);
    return p ? `127.0.0.1:${p.remotePort}` : null;
  }

  async function persist() {
    await saveProject({ ...project, boundServiceIds: [...bound] });
  }
  async function toggle(id: string) {
    if (bound.has(id)) { bound.delete(id); await servicesSend({ cmd: "unbind", id }); }
    else { bound.add(id); await servicesSend({ cmd: "bind", id }); }
    bound = new Set(bound);
    await persist();
  }
  async function retry(id: string) { await servicesSend({ cmd: "retry", id }); }
  function copy(text: string) { navigator.clipboard?.writeText(text); }
</script>

<div class="services-panel">
  <header><span class="h">Services</span>{#if view.error}<span class="err" data-testid="services-error">{view.error}</span>{/if}</header>
  {#if view.candidates.length === 0}
    <p class="empty" data-testid="services-empty">No local services discovered.</p>
  {:else}
    <ul class="list">
      {#each view.candidates as s (s.id)}
        {@const st = statusOf(s.id)}
        <li class="row" data-testid="svc-{s.id}">
          <label class="tog">
            <input type="checkbox" checked={bound.has(s.id)} onchange={() => toggle(s.id)} aria-label="bind {s.label}" />
            <span class="label">{s.label}</span>
          </label>
          <span class="pill pill-{st}">{st}</span>
          {#if remoteOf(s.id)}
            <button class="copy" onclick={() => copy(remoteOf(s.id)!)} title="Copy remote address">{remoteOf(s.id)}</button>
          {/if}
          {#if st === "failed" || st === "stale"}
            <button class="retry" onclick={() => retry(s.id)}>Retry</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .services-panel { display: flex; flex-direction: column; gap: 6px; padding: 10px 14px; border-top: 1px solid var(--border); }
  header { display: flex; align-items: center; gap: 8px; }
  .h { font-weight: 600; font-size: 13px; }
  .err { color: var(--error); font-size: 11px; }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .row { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .tog { display: flex; align-items: center; gap: 6px; flex: 1; }
  .pill { font-size: 10px; padding: 1px 7px; border-radius: 20px; border: 1px solid var(--border); text-transform: capitalize; }
  .pill-active { background: var(--accent-bg); }
  .pill-failed, .pill-stale { color: var(--error); }
  .copy { font-family: monospace; font-size: 11px; background: var(--surface-raised); color: var(--text-muted); padding: 2px 8px; }
  .retry { background: var(--surface-raised); color: var(--text); padding: 2px 8px; }
  .empty { color: var(--text-muted); font-size: 12px; }
</style>
```

Verify the IPC names you reference (`detectVmUri`, `saveProject`) already exist in `packages/desktop/src/lib/ipc.ts` — both were used in P1 desktop code. If `saveProject` lives elsewhere, import it from its real module.

- [ ] **Step 6: Wire into `Workspace.svelte`.** Add the import next to the other component imports and place `<ServicesPanel {project} />` in the `.right` section after `<FlutterPanel … />`:

```svelte
  import ServicesPanel from "../components/ServicesPanel.svelte";
```
```svelte
      <FlutterPanel projectDir={project.localPath} />
      <ServicesPanel {project} />
```

- [ ] **Step 7: Run desktop tests + typecheck-build, verify PASS:**

Run: `pnpm --filter patchwire-desktop test -- ServicesPanel && pnpm --filter patchwire-desktop test && pnpm --filter patchwire-desktop build`
Expected: ServicesPanel tests pass; full desktop suite green; `tsc && vite build` clean.

- [ ] **Step 8: Commit:**

```bash
git add packages/desktop/src/lib/ipc.ts packages/desktop/src/lib/types.ts packages/desktop/src/components/ServicesPanel.svelte packages/desktop/src/components/ServicesPanel.test.ts packages/desktop/src/screens/Workspace.svelte
git commit -m "feat(desktop): Services panel — discover/bind/status with persistence"
```

---

## Task 8: Full-suite gate

**Files:** none (verification only)

- [ ] **Step 1: CLI suite + build:**

Run: `pnpm --filter @rebink/patchwire test && pnpm --filter @rebink/patchwire typecheck && pnpm --filter @rebink/patchwire build`
Expected: all green (manager 9, session 5, serve 1, plus the P1 suite).

- [ ] **Step 2: Desktop suite + build:**

Run: `pnpm --filter patchwire-desktop test && pnpm --filter patchwire-desktop build`
Expected: all green incl. `services-session` + `ServicesPanel`.

- [ ] **Step 3: Rust compile:**

Run: `cd packages/desktop/src-tauri && cargo build`
Expected: clean.

- [ ] **Step 4: Update the E2E runbook** — append a desktop section to `docs/superpowers/plans/2026-06-19-service-projection-e2e.md`:

```markdown
## Desktop (P2)
1. Open a project workspace in the desktop app with a local Postgres container running.
2. The Services panel auto-lists `Postgres (...)`; toggle it on → pill goes `binding`→`active`, remote `127.0.0.1:5432` shown with a copy button.
3. Reopen the workspace → the bound service auto-rebinds (persisted).
4. Stop the container → pill goes `stale`; restart it and click Retry → back to `active`.
5. Kill the ssh tunnel → pill `reconnecting` → `active` (auto-heal); exhaust retries → `failed` + Retry.
```

- [ ] **Step 5: Commit:**

```bash
git add docs/superpowers/plans/2026-06-19-service-projection-e2e.md
git commit -m "docs: desktop E2E steps for service projection P2"
```

---

## Self-Review Notes

- **Spec coverage:** manager hardening — backoff/failed (Task 1), stale/refresh/retry (Task 2); streaming session + protocol (Task 3), `serve --stream` (Task 4); desktop reducer (Task 5), Rust session state + start/send/stop (Task 6), panel + IPC + Workspace wire + `boundServiceIds` persistence + auto-rebind + copy + retry (Task 7); E2E + gate (Task 8). Every spec section maps to a task.
- **Type consistency:** `ManagerDeps` (probe/delay(ms)/backoff/maxAttempts), `Entry.attempts`, manager methods `refresh(present)`/`retry(id)` match the widened `ServiceProjectionManager`. Session `SessionIo`/`SessionDeps`/event shapes match the desktop `WireService`/`WireProjection`/`ServicesEvent` (same field names across the process boundary). IPC `startServices(projectDir, dartVmUri?)`/`servicesSend(cmd)`/`stopServices()` match the Rust `start_services(project_dir, dart_vm_uri?)`/`services_send(json)`/`stop_services` (Tauri camelCase↔snake_case mapping). Event channel `pw://services` consistent across Rust emit + `onServicesEvent`.
- **P1 compatibility:** the hardened `delay` signature `(ms) => Promise` remains assignable from the P1 tests' `delay: async () => {}` (fewer-param functions are assignable); all four P1 manager tests stay green.
- **Verification flags:** Task 6/7 carry explicit "verify against the real sidecar/IPC names + `CommandChild.write`/`cargo build`" notes; Task 4 reuses (does not duplicate) existing imports.
