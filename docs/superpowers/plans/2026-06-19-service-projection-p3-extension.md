# Service Projection — Phase 3 (VS Code Extension) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A VS Code "Services" tree view that drives the `patchwire services serve --stream` session — discover local services, bind them onto the remote agent's loopback, show live status — as a thin native client.

**Architecture:** The extension host spawns the CLI session via `child_process` (no Rust). A `ServicesController` (EventEmitter, modeled on `MutagenController`) line-buffers the session's NDJSON stdout into a `ServicesView` and writes commands to stdin. A native `TreeDataProvider` renders it; tree-item menu commands bind/unbind/retry/copy. Lazy: the session starts when the view first becomes visible. Bound ids persist in `workspaceState`.

**Tech Stack:** TypeScript (ESM `.ts` specifiers), VS Code extension API, vitest with a `vscode` stub alias (`src/test/vscode-stub.ts`). Package `patchwire-vscode` at `packages/extension`.

**Spec:** `docs/superpowers/specs/2026-06-19-service-projection-p3-extension-design.md`
**Branch:** `feat/service-projection-p3-extension` (stacked on P2 / PR #75).

---

## Repo facts the engineer needs

- Run tests: `pnpm --filter patchwire-vscode test -- <substring>`. Typecheck: `pnpm --filter patchwire-vscode typecheck`. Build: `pnpm --filter patchwire-vscode build`.
- vitest aliases `vscode` → `packages/extension/src/test/vscode-stub.ts`. The stub currently exports `EventEmitter`, `workspace`, `Uri`, `window`, `env`, `commands` — but NOT `TreeItem`/`ThemeIcon`/`TreeItemCollapsibleState` (Task 4 adds them).
- `resolveCli(extensionFsPath)` → `{ command, baseArgs, env }`; the cwd is passed at spawn time (see `src/commands.ts` which spawns `spawn(inv.command, [...inv.baseArgs, ...args], { cwd, env: inv.env })`).
- Use pnpm, never npm. ESM with explicit `.ts` import specifiers in source.

## File Structure

| File | Responsibility |
|------|----------------|
| `src/services/protocol.ts` (create) | `parseServicesLine` + `reduceServices` + event/view types |
| `src/services/ServicesController.ts` (create) | spawn `serve --stream`, stream stdout→view, write stdin commands |
| `src/services/ServicesTreeProvider.ts` (create) | `TreeDataProvider`: view → tree items |
| `src/services/serviceCommands.ts` (create) | bind/unbind/retry/copy handlers + workspaceState persistence |
| `src/test/vscode-stub.ts` (modify) | add `TreeItem`, `ThemeIcon`, `TreeItemCollapsibleState`, tree-view window stubs |
| `package.json` (modify) | contributes: the tree view, 4 commands, menus |
| `src/extension.ts` (modify) | construct controller+provider, lazy start on view visibility, register commands |

---

## Task 1: Protocol (`protocol.ts`)

**Files:**
- Create: `packages/extension/src/services/protocol.ts`
- Test: `packages/extension/src/services/protocol.test.ts`

- [ ] **Step 1: Write the failing test** at `packages/extension/src/services/protocol.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseServicesLine, reduceServices, initialServices, type ServicesView } from './protocol.ts';

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
  it('candidates replaces candidates and clears error', () => {
    const s = reduceServices({ ...initialServices, error: 'x' }, { type: 'candidates', services: [svc] });
    expect(s.candidates).toEqual([svc]);
    expect(s.error).toBeUndefined();
  });
  it('status replaces projections', () => {
    const s = reduceServices(initialServices, { type: 'status', projections: [proj] });
    expect(s.projections).toEqual([proj]);
  });
  it('error sets the message', () => {
    const s: ServicesView = reduceServices(initialServices, { type: 'error', message: 'bad' });
    expect(s.error).toBe('bad');
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (module not found):

Run: `pnpm --filter patchwire-vscode test -- services/protocol`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/extension/src/services/protocol.ts`:**

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

- [ ] **Step 4: Run test, verify PASS (5 tests):**

Run: `pnpm --filter patchwire-vscode test -- services/protocol`

- [ ] **Step 5: Commit:**

```bash
git add packages/extension/src/services/protocol.ts packages/extension/src/services/protocol.test.ts
git commit -m "feat(extension): services NDJSON protocol parser + reducer"
```

---

## Task 2: ServicesController

**Files:**
- Create: `packages/extension/src/services/ServicesController.ts`
- Test: `packages/extension/src/services/ServicesController.test.ts`

- [ ] **Step 1: Write the failing test** at `packages/extension/src/services/ServicesController.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ServicesController, type SpawnedChild } from './ServicesController.ts';
import type { ServicesView } from './protocol.ts';

function fakeChild() {
  let dataCb: (c: string) => void = () => {};
  let exitCb: (code: number | null) => void = () => {};
  const writes: string[] = [];
  const kill = vi.fn();
  const child: SpawnedChild = {
    stdout: { on: (_ev: 'data', cb: (c: Buffer | string) => void) => { dataCb = cb as (c: string) => void; } },
    stdin: { write: (s: string) => { writes.push(s); } },
    on: (_ev: 'exit', cb: (code: number | null) => void) => { exitCb = cb; },
    kill,
  };
  return { child, writes, kill, feed: (s: string) => dataCb(s), exit: () => exitCb(0) };
}

function makeController(child: SpawnedChild) {
  const spawnFn = vi.fn(() => child);
  const c = new ServicesController('patchwire', [], '/ws', {}, spawnFn);
  return { c, spawnFn };
}

describe('ServicesController', () => {
  it('start spawns `services serve --stream` in the workspace cwd', () => {
    const f = fakeChild();
    const { c, spawnFn } = makeController(f.child);
    c.start();
    expect(spawnFn).toHaveBeenCalledWith('patchwire', ['services', 'serve', '--stream'], { cwd: '/ws', env: {} });
  });

  it('parses streamed stdout lines into the view and fires onDidChange', () => {
    const f = fakeChild();
    const { c } = makeController(f.child);
    const seen: ServicesView[] = [];
    c.onDidChange((v) => seen.push(v));
    c.start();
    f.feed('{"type":"candidates","services":[{"id":"docker:db:5432","label":"Postgres","kind":"docker","localPort":5432,"connectionHint":"postgres://127.0.0.1:5432"}]}\n');
    expect(seen.at(-1)!.candidates).toHaveLength(1);
    expect(c.current().candidates[0].id).toBe('docker:db:5432');
  });

  it('buffers a partial line until the newline arrives', () => {
    const f = fakeChild();
    const { c } = makeController(f.child);
    const seen: ServicesView[] = [];
    c.onDidChange((v) => seen.push(v));
    c.start();
    f.feed('{"type":"error","mess');
    expect(seen).toHaveLength(0);
    f.feed('age":"boom"}\n');
    expect(seen.at(-1)!.error).toBe('boom');
  });

  it('bind/unbind/retry/discover write NDJSON commands to stdin', () => {
    const f = fakeChild();
    const { c } = makeController(f.child);
    c.start();
    c.discover(); c.bind('x'); c.unbind('y'); c.retry('z');
    expect(f.writes).toEqual([
      '{"cmd":"discover"}\n',
      '{"cmd":"bind","id":"x"}\n',
      '{"cmd":"unbind","id":"y"}\n',
      '{"cmd":"retry","id":"z"}\n',
    ]);
  });

  it('stop kills the child; start is idempotent', () => {
    const f = fakeChild();
    const { c, spawnFn } = makeController(f.child);
    c.start(); c.start();
    expect(spawnFn).toHaveBeenCalledTimes(1);
    c.stop();
    expect(f.kill).toHaveBeenCalled();
  });

  it('child exit surfaces a stopped error in the view', () => {
    const f = fakeChild();
    const { c } = makeController(f.child);
    const seen: ServicesView[] = [];
    c.onDidChange((v) => seen.push(v));
    c.start();
    f.exit();
    expect(seen.at(-1)!.error).toBe('session stopped');
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (module not found):

Run: `pnpm --filter patchwire-vscode test -- ServicesController`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/extension/src/services/ServicesController.ts`:**

```ts
import * as vscode from 'vscode';
import { spawn } from 'node:child_process';
import { parseServicesLine, reduceServices, initialServices, type ServicesView } from './protocol.ts';

export interface SpawnedChild {
  stdout: { on(ev: 'data', cb: (chunk: Buffer | string) => void): void } | null;
  stdin: { write(s: string): void } | null;
  on(ev: 'exit', cb: (code: number | null) => void): void;
  kill(): void;
}

export type CliSpawn = (command: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => SpawnedChild;

const defaultSpawn: CliSpawn = (command, args, opts) =>
  spawn(command, args, { cwd: opts.cwd, env: opts.env, stdio: ['pipe', 'pipe', 'pipe'] }) as unknown as SpawnedChild;

/** Drives one `patchwire services serve --stream` session for the workspace. */
export class ServicesController {
  private statusEmitter = new vscode.EventEmitter<ServicesView>();
  readonly onDidChange = this.statusEmitter.event;
  private view: ServicesView = initialServices;
  private child: SpawnedChild | null = null;
  private buf = '';

  constructor(
    private readonly command: string,
    private readonly baseArgs: string[],
    private readonly cwd: string,
    private readonly env: NodeJS.ProcessEnv,
    private readonly spawnFn: CliSpawn = defaultSpawn,
  ) {}

  start(): void {
    if (this.child) return;
    const child = this.spawnFn(this.command, [...this.baseArgs, 'services', 'serve', '--stream'], { cwd: this.cwd, env: this.env });
    this.child = child;
    child.stdout?.on('data', (chunk) => this.onData(chunk.toString()));
    child.on('exit', () => {
      this.child = null;
      this.view = { ...this.view, error: 'session stopped' };
      this.statusEmitter.fire(this.view);
    });
  }

  private onData(text: string): void {
    this.buf += text;
    let nl = this.buf.indexOf('\n');
    while (nl >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      const ev = parseServicesLine(line);
      if (ev) {
        this.view = reduceServices(this.view, ev);
        this.statusEmitter.fire(this.view);
      }
      nl = this.buf.indexOf('\n');
    }
  }

  send(cmd: Record<string, unknown>): void {
    this.child?.stdin?.write(JSON.stringify(cmd) + '\n');
  }
  discover(): void { this.send({ cmd: 'discover' }); }
  bind(id: string): void { this.send({ cmd: 'bind', id }); }
  unbind(id: string): void { this.send({ cmd: 'unbind', id }); }
  retry(id: string): void { this.send({ cmd: 'retry', id }); }

  current(): ServicesView { return this.view; }
  isRunning(): boolean { return this.child !== null; }

  stop(): void { this.child?.kill(); this.child = null; }
  dispose(): void { this.stop(); this.statusEmitter.dispose(); }
}
```

- [ ] **Step 4: Run test + typecheck, verify PASS (6 tests):**

Run: `pnpm --filter patchwire-vscode test -- ServicesController && pnpm --filter patchwire-vscode typecheck`

- [ ] **Step 5: Commit:**

```bash
git add packages/extension/src/services/ServicesController.ts packages/extension/src/services/ServicesController.test.ts
git commit -m "feat(extension): ServicesController drives serve --stream session"
```

---

## Task 3: Extend the vscode stub for tree views

**Files:**
- Modify: `packages/extension/src/test/vscode-stub.ts`
- Test: `packages/extension/src/test/vscode-stub-tree.test.ts`

The stub lacks `TreeItem`/`ThemeIcon`/`TreeItemCollapsibleState`, which the tree provider (Task 4) and its tests need.

- [ ] **Step 1: Write the failing test** at `packages/extension/src/test/vscode-stub-tree.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { TreeItem, ThemeIcon, TreeItemCollapsibleState } from 'vscode';

describe('vscode stub tree primitives', () => {
  it('TreeItem stores label + collapsible state', () => {
    const t = new TreeItem('hi', TreeItemCollapsibleState.None);
    expect(t.label).toBe('hi');
    expect(t.collapsibleState).toBe(TreeItemCollapsibleState.None);
  });
  it('ThemeIcon stores its id', () => {
    expect(new ThemeIcon('pass-filled').id).toBe('pass-filled');
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (exports missing):

Run: `pnpm --filter patchwire-vscode test -- vscode-stub-tree`
Expected: FAIL.

- [ ] **Step 3: Append to `packages/extension/src/test/vscode-stub.ts`:**

```ts
export enum TreeItemCollapsibleState { None = 0, Collapsed = 1, Expanded = 2 }

export class ThemeIcon {
  constructor(public readonly id: string) {}
}

export class TreeItem {
  label?: string;
  description?: string;
  iconPath?: unknown;
  contextValue?: string;
  tooltip?: string;
  collapsibleState?: TreeItemCollapsibleState;
  constructor(label?: string, collapsibleState?: TreeItemCollapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}
```

Also extend the existing `window` object literal in the stub (add these properties inside it):

```ts
  registerTreeDataProvider: (_id: string, _provider: unknown) => ({ dispose: () => {} }),
  createTreeView: (_id: string, _opts: unknown) => ({
    onDidChangeVisibility: (_cb: (e: { visible: boolean }) => void) => ({ dispose: () => {} }),
    visible: false,
    dispose: () => {},
  }),
```

- [ ] **Step 4: Run test, verify PASS:**

Run: `pnpm --filter patchwire-vscode test -- vscode-stub-tree`

- [ ] **Step 5: Commit:**

```bash
git add packages/extension/src/test/vscode-stub.ts packages/extension/src/test/vscode-stub-tree.test.ts
git commit -m "test(extension): add TreeItem/ThemeIcon/tree-view stubs"
```

---

## Task 4: ServicesTreeProvider

**Files:**
- Create: `packages/extension/src/services/ServicesTreeProvider.ts`
- Test: `packages/extension/src/services/ServicesTreeProvider.test.ts`

- [ ] **Step 1: Write the failing test** at `packages/extension/src/services/ServicesTreeProvider.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { ServicesTreeProvider, ServiceItem, iconFor } from './ServicesTreeProvider.ts';
import { initialServices, type ServicesView } from './protocol.ts';

const svc = { id: 'docker:db:5432', label: 'Postgres', kind: 'docker', localPort: 5432, connectionHint: 'postgres://127.0.0.1:5432' };

function fakeController(view: ServicesView) {
  const emitter = new vscode.EventEmitter<ServicesView>();
  return { onDidChange: emitter.event, current: () => view, emitter };
}

describe('iconFor', () => {
  it('maps statuses to theme icon ids', () => {
    expect(iconFor('active')).toBe('pass-filled');
    expect(iconFor('failed')).toBe('error');
    expect(iconFor('stale')).toBe('warning');
    expect(iconFor('available')).toBe('circle-outline');
  });
});

describe('ServicesTreeProvider', () => {
  it('renders a placeholder when there is no patchwire.yml', () => {
    const p = new ServicesTreeProvider(fakeController(initialServices), () => new Set());
    p.setHasConfig(false);
    const items = p.getChildren();
    expect(items).toHaveLength(1);
    expect(items[0].label).toMatch(/Setup first/i);
  });

  it('renders a placeholder when there are no candidates', () => {
    const p = new ServicesTreeProvider(fakeController(initialServices), () => new Set());
    const items = p.getChildren();
    expect(items[0].label).toMatch(/No local services/i);
  });

  it('renders one ServiceItem per candidate with status + contextValue', () => {
    const view: ServicesView = { candidates: [svc], projections: [{ service: svc, remotePort: 5432, mirrored: true, status: 'active' }], error: undefined };
    const p = new ServicesTreeProvider(fakeController(view), () => new Set(['docker:db:5432']));
    const items = p.getChildren();
    expect(items).toHaveLength(1);
    const it = items[0] as ServiceItem;
    expect(it.label).toBe('Postgres');
    expect(it.description).toContain('127.0.0.1:5432');
    expect(it.contextValue).toBe('service:bound:active');
    expect(it.data.remoteAddr).toBe('127.0.0.1:5432');
  });

  it('shows available status + no addr when a candidate is unbound', () => {
    const view: ServicesView = { candidates: [svc], projections: [], error: undefined };
    const p = new ServicesTreeProvider(fakeController(view), () => new Set());
    const it = p.getChildren()[0] as ServiceItem;
    expect(it.contextValue).toBe('service:available:available');
    expect(it.data.remoteAddr).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (module not found):

Run: `pnpm --filter patchwire-vscode test -- ServicesTreeProvider`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/extension/src/services/ServicesTreeProvider.ts`:**

```ts
import * as vscode from 'vscode';
import type { ServicesView, WireService, WireProjection } from './protocol.ts';

export interface ServiceItemData {
  id: string;
  label: string;
  status: string;
  bound: boolean;
  remoteAddr: string | null;
  connectionHint: string;
}

export function iconFor(status: string): string {
  switch (status) {
    case 'active': return 'pass-filled';
    case 'binding':
    case 'reconnecting': return 'sync~spin';
    case 'failed': return 'error';
    case 'stale': return 'warning';
    default: return 'circle-outline';
  }
}

export class ServiceItem extends vscode.TreeItem {
  constructor(public readonly data: ServiceItemData) {
    super(data.label, vscode.TreeItemCollapsibleState.None);
    this.description = data.remoteAddr ? `${data.status} · ${data.remoteAddr}` : data.status;
    this.iconPath = new vscode.ThemeIcon(iconFor(data.status));
    this.contextValue = `service:${data.bound ? 'bound' : 'available'}:${data.status}`;
    this.tooltip = data.connectionHint;
  }
}

interface ControllerView {
  onDidChange: vscode.Event<ServicesView>;
  current(): ServicesView;
}

function placeholder(text: string): vscode.TreeItem {
  const t = new vscode.TreeItem(text, vscode.TreeItemCollapsibleState.None);
  t.contextValue = 'placeholder';
  return t;
}

function toItemData(s: WireService, projections: WireProjection[], bound: Set<string>): ServiceItemData {
  const p = projections.find((x) => x.service.id === s.id);
  return {
    id: s.id,
    label: s.label,
    status: p ? p.status : 'available',
    bound: bound.has(s.id),
    remoteAddr: p ? `127.0.0.1:${p.remotePort}` : null,
    connectionHint: s.connectionHint,
  };
}

export class ServicesTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;
  private hasConfig = true;

  constructor(
    private readonly controller: ControllerView,
    private readonly boundIds: () => Set<string>,
  ) {
    this.controller.onDidChange(() => this.changeEmitter.fire());
  }

  setHasConfig(v: boolean): void { this.hasConfig = v; this.changeEmitter.fire(); }
  refresh(): void { this.changeEmitter.fire(); }

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }

  getChildren(): vscode.TreeItem[] {
    if (!this.hasConfig) return [placeholder('Run Patchwire: Setup first')];
    const view = this.controller.current();
    if (view.error === 'session stopped') return [placeholder('Session stopped — reopen the view')];
    if (view.candidates.length === 0) return [placeholder('No local services discovered')];
    const bound = this.boundIds();
    return view.candidates.map((s) => new ServiceItem(toItemData(s, view.projections, bound)));
  }
}
```

- [ ] **Step 4: Run test + typecheck, verify PASS:**

Run: `pnpm --filter patchwire-vscode test -- ServicesTreeProvider && pnpm --filter patchwire-vscode typecheck`

- [ ] **Step 5: Commit:**

```bash
git add packages/extension/src/services/ServicesTreeProvider.ts packages/extension/src/services/ServicesTreeProvider.test.ts
git commit -m "feat(extension): services tree provider with status icons"
```

---

## Task 5: Service commands + persistence

**Files:**
- Create: `packages/extension/src/services/serviceCommands.ts`
- Test: `packages/extension/src/services/serviceCommands.test.ts`

- [ ] **Step 1: Write the failing test** at `packages/extension/src/services/serviceCommands.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { boundIdsFrom, makeServiceCommandHandlers, type Memento } from './serviceCommands.ts';
import { ServiceItem } from './ServicesTreeProvider.ts';

function fakeMemento(initial: string[] = []): Memento & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>([['patchwire.boundServiceIds', initial]]);
  return {
    store,
    get: (<T>(k: string, d?: T) => (store.has(k) ? store.get(k) : d) as T),
    update: (k: string, v: unknown) => { store.set(k, v); return Promise.resolve(); },
  };
}

function item(id: string, remoteAddr: string | null = '127.0.0.1:5432') {
  return new ServiceItem({ id, label: id, status: 'available', bound: false, remoteAddr, connectionHint: 'postgres://127.0.0.1:5432' });
}

describe('boundIdsFrom', () => {
  it('reads the persisted set', () => {
    expect([...boundIdsFrom(fakeMemento(['a', 'b']))].sort()).toEqual(['a', 'b']);
  });
});

describe('service command handlers', () => {
  it('bind sends to the controller and persists the id', async () => {
    const controller = { bind: vi.fn(), unbind: vi.fn(), retry: vi.fn() };
    const mem = fakeMemento();
    const h = makeServiceCommandHandlers(controller, mem);
    await h.bind(item('docker:db:5432'));
    expect(controller.bind).toHaveBeenCalledWith('docker:db:5432');
    expect(mem.store.get('patchwire.boundServiceIds')).toEqual(['docker:db:5432']);
  });

  it('unbind sends and removes the persisted id', async () => {
    const controller = { bind: vi.fn(), unbind: vi.fn(), retry: vi.fn() };
    const mem = fakeMemento(['docker:db:5432']);
    const h = makeServiceCommandHandlers(controller, mem);
    await h.unbind(item('docker:db:5432'));
    expect(controller.unbind).toHaveBeenCalledWith('docker:db:5432');
    expect(mem.store.get('patchwire.boundServiceIds')).toEqual([]);
  });

  it('retry forwards to the controller', async () => {
    const controller = { bind: vi.fn(), unbind: vi.fn(), retry: vi.fn() };
    const h = makeServiceCommandHandlers(controller, fakeMemento());
    await h.retry(item('x'));
    expect(controller.retry).toHaveBeenCalledWith('x');
  });

  it('copyAddress writes the remote addr to the clipboard', async () => {
    const writeText = vi.fn(async () => {});
    const h = makeServiceCommandHandlers({ bind: vi.fn(), unbind: vi.fn(), retry: vi.fn() }, fakeMemento(), { writeText });
    await h.copyAddress(item('x', '127.0.0.1:5432'));
    expect(writeText).toHaveBeenCalledWith('127.0.0.1:5432');
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (module not found):

Run: `pnpm --filter patchwire-vscode test -- serviceCommands`
Expected: FAIL.

- [ ] **Step 3: Implement `packages/extension/src/services/serviceCommands.ts`:**

```ts
import * as vscode from 'vscode';
import type { ServiceItem } from './ServicesTreeProvider.ts';

const KEY = 'patchwire.boundServiceIds';

export interface Memento {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Promise<void>;
}

export interface ServiceController {
  bind(id: string): void;
  unbind(id: string): void;
  retry(id: string): void;
}

export interface Clipboard { writeText(text: string): Promise<void>; }

export function boundIdsFrom(state: Memento): Set<string> {
  return new Set(state.get<string[]>(KEY, []));
}

export interface ServiceCommandHandlers {
  bind(item: ServiceItem): Promise<void>;
  unbind(item: ServiceItem): Promise<void>;
  retry(item: ServiceItem): Promise<void>;
  copyAddress(item: ServiceItem): Promise<void>;
}

export function makeServiceCommandHandlers(
  controller: ServiceController,
  state: Memento,
  clipboard: Clipboard = vscode.env.clipboard,
): ServiceCommandHandlers {
  const persist = async (ids: Set<string>) => state.update(KEY, [...ids]);
  return {
    async bind(item) {
      controller.bind(item.data.id);
      const ids = boundIdsFrom(state);
      ids.add(item.data.id);
      await persist(ids);
    },
    async unbind(item) {
      controller.unbind(item.data.id);
      const ids = boundIdsFrom(state);
      ids.delete(item.data.id);
      await persist(ids);
    },
    async retry(item) {
      controller.retry(item.data.id);
    },
    async copyAddress(item) {
      if (item.data.remoteAddr) await clipboard.writeText(item.data.remoteAddr);
    },
  };
}
```

- [ ] **Step 4: Run test + typecheck, verify PASS:**

Run: `pnpm --filter patchwire-vscode test -- serviceCommands && pnpm --filter patchwire-vscode typecheck`

- [ ] **Step 5: Commit:**

```bash
git add packages/extension/src/services/serviceCommands.ts packages/extension/src/services/serviceCommands.test.ts
git commit -m "feat(extension): service bind/unbind/retry/copy command handlers"
```

---

## Task 6: package.json contributes (view + commands + menus)

**Files:**
- Modify: `packages/extension/package.json`
- Test: `packages/extension/src/services/contributes.test.ts`

- [ ] **Step 1: Write the failing test** at `packages/extension/src/services/contributes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8'));

describe('package.json contributes the services UI', () => {
  it('registers the patchwire.services tree view', () => {
    const views = pkg.contributes.views.patchwire as Array<{ id: string }>;
    expect(views.some((v) => v.id === 'patchwire.services')).toBe(true);
  });
  it('registers the four service commands', () => {
    const ids = (pkg.contributes.commands as Array<{ command: string }>).map((c) => c.command);
    for (const c of ['patchwire.services.bind', 'patchwire.services.unbind', 'patchwire.services.retry', 'patchwire.services.copyAddress']) {
      expect(ids).toContain(c);
    }
  });
  it('gates item context menus by contextValue', () => {
    const menus = pkg.contributes.menus['view/item/context'] as Array<{ command: string; when: string }>;
    expect(menus.some((m) => m.command === 'patchwire.services.bind' && /service:available/.test(m.when))).toBe(true);
    expect(menus.some((m) => m.command === 'patchwire.services.unbind' && /service:bound/.test(m.when))).toBe(true);
    expect(menus.some((m) => m.command === 'patchwire.services.retry' && /(failed|stale)/.test(m.when))).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (entries missing):

Run: `pnpm --filter patchwire-vscode test -- contributes`
Expected: FAIL.

- [ ] **Step 3: Edit `packages/extension/package.json`.**

(a) In `contributes.views.patchwire`, ADD a second entry after the existing chat view (note: NO `type` field → defaults to a tree view):

```json
        {
          "id": "patchwire.services",
          "name": "Services"
        }
```

(b) In `contributes.commands`, ADD these four entries:

```json
        { "command": "patchwire.services.bind", "title": "Bind", "category": "Patchwire", "icon": "$(plug)" },
        { "command": "patchwire.services.unbind", "title": "Unbind", "category": "Patchwire", "icon": "$(debug-disconnect)" },
        { "command": "patchwire.services.retry", "title": "Retry", "category": "Patchwire", "icon": "$(refresh)" },
        { "command": "patchwire.services.copyAddress", "title": "Copy Remote Address", "category": "Patchwire", "icon": "$(copy)" }
```

(c) ADD a `menus` block to `contributes` (if `contributes.menus` does not exist yet, create it; if it does, merge these arrays):

```json
      "menus": {
        "view/item/context": [
          { "command": "patchwire.services.bind", "when": "view == patchwire.services && viewItem =~ /^service:available/", "group": "inline" },
          { "command": "patchwire.services.unbind", "when": "view == patchwire.services && viewItem =~ /^service:bound/", "group": "inline" },
          { "command": "patchwire.services.copyAddress", "when": "view == patchwire.services && viewItem =~ /^service:bound/", "group": "inline" },
          { "command": "patchwire.services.retry", "when": "view == patchwire.services && viewItem =~ /:(failed|stale)$/", "group": "inline" }
        ]
      }
```

- [ ] **Step 4: Run test + build, verify PASS:**

Run: `pnpm --filter patchwire-vscode test -- contributes && pnpm --filter patchwire-vscode build`
Expected: test passes; build clean (valid JSON, bundle succeeds).

- [ ] **Step 5: Commit:**

```bash
git add packages/extension/package.json packages/extension/src/services/contributes.test.ts
git commit -m "feat(extension): contribute services tree view, commands, menus"
```

---

## Task 7: Wire into `extension.ts`

**Files:**
- Modify: `packages/extension/src/extension.ts`
- Test: `packages/extension/src/services/wiring.test.ts`

The deep activation path needs a full VS Code context, so we test a small exported helper `wireServices(deps)` that does the lazy-start wiring against injectable seams; `activate` calls it.

- [ ] **Step 1: Write the failing test** at `packages/extension/src/services/wiring.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { wireServices } from './wiring.ts';

describe('wireServices', () => {
  it('on first view visibility: starts the controller, discovers, and auto-rebinds persisted ids', () => {
    const controller = { start: vi.fn(), discover: vi.fn(), bind: vi.fn(), isRunning: () => false };
    let visCb: (e: { visible: boolean }) => void = () => {};
    const treeView = { onDidChangeVisibility: (cb: (e: { visible: boolean }) => void) => { visCb = cb; return { dispose() {} }; } };
    wireServices({ controller, treeView, boundIds: () => new Set(['docker:db:5432']), hasConfig: true });

    visCb({ visible: true });
    expect(controller.start).toHaveBeenCalledTimes(1);
    expect(controller.discover).toHaveBeenCalledTimes(1);
    expect(controller.bind).toHaveBeenCalledWith('docker:db:5432');
  });

  it('does nothing when there is no patchwire.yml', () => {
    const controller = { start: vi.fn(), discover: vi.fn(), bind: vi.fn(), isRunning: () => false };
    let visCb: (e: { visible: boolean }) => void = () => {};
    const treeView = { onDidChangeVisibility: (cb: (e: { visible: boolean }) => void) => { visCb = cb; return { dispose() {} }; } };
    wireServices({ controller, treeView, boundIds: () => new Set(), hasConfig: false });
    visCb({ visible: true });
    expect(controller.start).not.toHaveBeenCalled();
  });

  it('starts only once across repeated visibility events', () => {
    const controller = { start: vi.fn(), discover: vi.fn(), bind: vi.fn(), isRunning: () => false };
    let visCb: (e: { visible: boolean }) => void = () => {};
    const treeView = { onDidChangeVisibility: (cb: (e: { visible: boolean }) => void) => { visCb = cb; return { dispose() {} }; } };
    wireServices({ controller, treeView, boundIds: () => new Set(), hasConfig: true });
    visCb({ visible: true });
    visCb({ visible: false });
    visCb({ visible: true });
    expect(controller.start).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (module not found):

Run: `pnpm --filter patchwire-vscode test -- wiring`
Expected: FAIL.

- [ ] **Step 3: Create `packages/extension/src/services/wiring.ts`:**

```ts
export interface WireableController {
  start(): void;
  discover(): void;
  bind(id: string): void;
  isRunning(): boolean;
}

export interface VisibilityView {
  onDidChangeVisibility(cb: (e: { visible: boolean }) => void): { dispose(): void };
}

export interface WireServicesDeps {
  controller: WireableController;
  treeView: VisibilityView;
  boundIds: () => Set<string>;
  hasConfig: boolean;
}

/** Start the session lazily the first time the Services view becomes visible. */
export function wireServices(deps: WireServicesDeps): { dispose(): void } {
  let started = false;
  return deps.treeView.onDidChangeVisibility((e) => {
    if (!e.visible || started || !deps.hasConfig) return;
    started = true;
    deps.controller.start();
    deps.controller.discover();
    for (const id of deps.boundIds()) deps.controller.bind(id);
  });
}
```

- [ ] **Step 4: Run test, verify PASS (3 tests):**

Run: `pnpm --filter patchwire-vscode test -- wiring`

- [ ] **Step 5: Wire it into `packages/extension/src/extension.ts`.** Add imports near the top:

```ts
import { resolveCli } from './cli/resolveCli.ts';
import { ServicesController } from './services/ServicesController.ts';
import { ServicesTreeProvider } from './services/ServicesTreeProvider.ts';
import { makeServiceCommandHandlers, boundIdsFrom } from './services/serviceCommands.ts';
import { wireServices } from './services/wiring.ts';
```

Inside `activate`, AFTER `registerCommands(...)`, add this block (it uses the existing `output`, `context`, `currentWs`):

```ts
  const ws0 = currentWs();
  if (ws0) {
    const inv = resolveCli(context.extensionUri.fsPath);
    const controller = new ServicesController(inv.command, inv.baseArgs, ws0, inv.env);
    context.subscriptions.push({ dispose: () => controller.dispose() });

    const provider = new ServicesTreeProvider(controller, () => boundIdsFrom(context.workspaceState));
    provider.setHasConfig(existsSync(join(ws0, 'patchwire.yml')));
    context.subscriptions.push(vscode.window.registerTreeDataProvider('patchwire.services', provider));

    const treeView = vscode.window.createTreeView('patchwire.services', { treeDataProvider: provider });
    context.subscriptions.push(treeView);
    context.subscriptions.push(wireServices({
      controller,
      treeView,
      boundIds: () => boundIdsFrom(context.workspaceState),
      hasConfig: existsSync(join(ws0, 'patchwire.yml')),
    }));

    const handlers = makeServiceCommandHandlers(controller, context.workspaceState);
    context.subscriptions.push(
      vscode.commands.registerCommand('patchwire.services.bind', (i) => handlers.bind(i)),
      vscode.commands.registerCommand('patchwire.services.unbind', (i) => handlers.unbind(i)),
      vscode.commands.registerCommand('patchwire.services.retry', (i) => handlers.retry(i)),
      vscode.commands.registerCommand('patchwire.services.copyAddress', (i) => handlers.copyAddress(i)),
    );
  }
```

- [ ] **Step 6: Run tests + typecheck + build, verify PASS:**

Run: `pnpm --filter patchwire-vscode test && pnpm --filter patchwire-vscode typecheck && pnpm --filter patchwire-vscode build`
Expected: all green. `context.workspaceState` satisfies the `Memento` interface; `createTreeView` returns a `TreeView` whose `onDidChangeVisibility` matches `VisibilityView`. If a type mismatch appears, adapt the seam interfaces to the real `vscode` types (do not weaken behavior).

- [ ] **Step 7: Commit:**

```bash
git add packages/extension/src/services/wiring.ts packages/extension/src/services/wiring.test.ts packages/extension/src/extension.ts
git commit -m "feat(extension): wire services tree view with lazy session start"
```

---

## Task 8: Full-suite gate

**Files:** none (verification only)

- [ ] **Step 1: Extension suite + typecheck + build:**

Run: `pnpm --filter patchwire-vscode test && pnpm --filter patchwire-vscode typecheck && pnpm --filter patchwire-vscode build`
Expected: all green (protocol 5, controller 6, stub-tree 2, provider 5, commands 5, contributes 3, wiring 3, plus the pre-existing extension suite).

- [ ] **Step 2: Confirm the CLI/desktop suites are unaffected** (the branch stacks on them; nothing here changes them, but verify):

Run: `pnpm --filter @rebink/patchwire test && pnpm --filter patchwire-desktop test`
Expected: CLI 629 + desktop 156 still green.

- [ ] **Step 3: Append an extension section to the E2E runbook** `docs/superpowers/plans/2026-06-19-service-projection-e2e.md`:

```markdown
## VS Code Extension (P3)
1. Open a project (with `patchwire.yml`) in VS Code; open the Patchwire → Services view.
2. First reveal spawns `services serve --stream`; `Postgres (...)` appears with a `circle-outline` icon.
3. Click the inline Bind (plug) icon → icon goes `sync~spin`→`pass-filled`, description shows `active · 127.0.0.1:5432`. Copy icon copies the address.
4. Reopen the window → the bound service auto-rebinds (workspaceState).
5. Stop the container → status `stale` (warning icon) after a refresh; Retry icon re-arms.
6. Close the window → the session process is killed → tunnels drop.
```

- [ ] **Step 4: Commit:**

```bash
git add docs/superpowers/plans/2026-06-19-service-projection-e2e.md
git commit -m "docs: VS Code extension E2E steps for service projection P3"
```

---

## Self-Review Notes

- **Spec coverage:** protocol (Task 1); controller spawn/stream/stdin/stop (Task 2); stub primitives (Task 3); tree provider with status icons + placeholders (Task 4); bind/unbind/retry/copy + workspaceState persistence (Task 5); package.json view+commands+menus (Task 6); lazy-start wiring + extension.ts registration + auto-rebind (Task 7); gate + runbook (Task 8). Every spec section maps to a task.
- **Type consistency:** `ServicesView`/`WireService`/`WireProjection` defined once (Task 1) and imported everywhere. `ServicesController` methods `start/discover/bind/unbind/retry/stop/current/isRunning/onDidChange` are used consistently by the provider (Task 4 `current`/`onDidChange`), commands (Task 5 `bind/unbind/retry`), and wiring (Task 7 `start/discover/bind/isRunning`). `ServiceItem.data` shape (`ServiceItemData`) is the contract between Task 4 (produces) and Task 5 (consumes `item.data.id`/`item.data.remoteAddr`). `Memento` (Task 5) is satisfied by `context.workspaceState` (Task 7). `contextValue` format `service:<bound|available>:<status>` (Task 4) matches the menu `when` regexes (Task 6).
- **Lazy lifecycle:** `wireServices` starts exactly once on first `visible` (guarded by `started`), honoring `hasConfig`; matches the spec's "lazy on view reveal".
- **Verification flags:** Task 7 Step 6 notes that the real `vscode` `Memento`/`TreeView` types must satisfy the seam interfaces — adapt if the compiler disagrees, without weakening behavior. Task 6 builds to validate the JSON.
