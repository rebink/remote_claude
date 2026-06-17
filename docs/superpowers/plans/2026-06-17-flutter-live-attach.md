# Flutter Live-Attach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the remote AI agent observe and hot-reload the developer's locally-running Flutter app (screenshot, inspect, logs, hot reload) over an opt-in reverse-SSH-tunnelled Dart VM Service, surfaced to `claude` as a `patchwire-flutter` MCP server.

**Architecture:** The developer runs `flutter run` locally; the desktop attaches to its Dart VM Service, opens a reverse SSH tunnel (`ssh -R`) exposing it on the remote's loopback, and registers a per-project session with the agent server. When the agent spawns `claude`, it injects an MCP config pointing at `patchwire flutter-mcp`, a stdio MCP server that connects to the tunnelled VM Service and exposes four scoped tools. Compile and run stay on the laptop; no raw `evaluate` tool is exposed.

**Tech Stack:** TypeScript, Node, vitest (CLI/agent + desktop), Fastify (agent server), `@modelcontextprotocol/sdk` + `ws` (MCP server + VM Service client), Tauri + Svelte (desktop). Spec: `docs/superpowers/specs/2026-06-16-flutter-live-attach-design.md`.

---

## File Structure

**New (CLI package — `packages/cli/src/`)**
- `lib/flutter-vmservice.ts` — pure: parse VM Service URI, build ws URL, capability matrix.
- `lib/flutter-tunnel.ts` — pure reverse-tunnel arg builder + injectable lifecycle.
- `agent/flutter/vm-client.ts` — JSON-RPC-over-WebSocket VM Service client (injectable socket).
- `agent/flutter/mcp-server.ts` — `patchwire-flutter` stdio MCP server (4 tools, target gating).
- `agent/flutter/session-store.ts` — in-memory per-project flutter-session registry.
- `agent/flutter/mcp-config.ts` — pure: build the `--mcp-config` JSON for a session.
- `commands/flutter-mcp.ts` — CLI subcommand that boots the MCP server from env.

**Modified (CLI/agent)**
- `packages/cli/src/agent/server.ts` — mount `POST /flutter/session` + `DELETE /flutter/session/:project`; thread the session store into `/ask` + `/chat` so `runAi`/`aiRunner` get the MCP config.
- `packages/cli/src/agent/ai-runner.ts` — accept an optional `mcpConfigPath` and append `--mcp-config <path> --strict-mcp-config`.
- `packages/cli/src/cli.ts` — register `flutter-mcp` subcommand.
- `packages/cli/package.json` — add `@modelcontextprotocol/sdk`, `ws`, `@types/ws`.

**New / modified (protocol)**
- `packages/protocol/src/events.ts` — add `FlutterTarget`, `FlutterSession`, `FlutterSessionBody`.

**New / modified (desktop — `packages/desktop/src/`)**
- `lib/flutter-attach.ts` — pure attach state machine + line parser (mirrors `lib/sync-events.ts`).
- `lib/ipc.ts` — add `detectVmUri`, `startFlutterAttach`, `stopFlutterAttach`, `onFlutterEvent`.
- `components/FlutterPanel.svelte` (+ `.test.ts`) — paste/detect, attach/detach, status pill, capability display.
- `screens/Workspace.svelte` — mount `FlutterPanel` in the open-project view.

**New (docs)**
- `packages/website/src/content/docs/flutter.md` — feature + threat model + live-verify checklist.
- `packages/website/src/pages/index.astro` — M5 stance caveat (one line).

**Test commands** (run from `packages/cli` or `packages/desktop`): `pnpm vitest run <path>`. Typecheck: `pnpm --filter @rebink/patchwire typecheck`.

---

## Task 1: VM Service URI + capability core (pure)

**Files:**
- Create: `packages/cli/src/lib/flutter-vmservice.ts`
- Test: `packages/cli/test/lib/flutter-vmservice.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/lib/flutter-vmservice.test.ts
import { describe, it, expect } from 'vitest';
import { parseVmServiceUri, wsUrlFor, capabilitiesFor } from '../../src/lib/flutter-vmservice.ts';

describe('parseVmServiceUri', () => {
  it('parses a standard http VM service uri with auth token path', () => {
    const r = parseVmServiceUri('http://127.0.0.1:50123/abcDEF123=/');
    expect(r).toEqual({ ok: true, value: { host: '127.0.0.1', port: 50123, authPath: '/abcDEF123=/' } });
  });

  it('accepts a ws uri and strips a trailing ws segment', () => {
    const r = parseVmServiceUri('ws://127.0.0.1:8181/tok=/ws');
    expect(r).toEqual({ ok: true, value: { host: '127.0.0.1', port: 8181, authPath: '/tok=/' } });
  });

  it('accepts a uri with no auth token (root path)', () => {
    const r = parseVmServiceUri('http://127.0.0.1:8181/');
    expect(r).toEqual({ ok: true, value: { host: '127.0.0.1', port: 8181, authPath: '/' } });
  });

  it('rejects garbage', () => {
    expect(parseVmServiceUri('not a url').ok).toBe(false);
  });

  it('rejects a missing port', () => {
    expect(parseVmServiceUri('http://127.0.0.1/tok=/').ok).toBe(false);
  });
});

describe('wsUrlFor', () => {
  it('builds a ws url against a tunnel host/port preserving the auth path', () => {
    const uri = { host: '127.0.0.1', port: 50123, authPath: '/abcDEF123=/' };
    expect(wsUrlFor(uri, '127.0.0.1', 9123)).toBe('ws://127.0.0.1:9123/abcDEF123=/ws');
  });

  it('handles a root auth path without doubling slashes', () => {
    const uri = { host: '127.0.0.1', port: 8181, authPath: '/' };
    expect(wsUrlFor(uri, '127.0.0.1', 9000)).toBe('ws://127.0.0.1:9000/ws');
  });
});

describe('capabilitiesFor', () => {
  it('device gets full capabilities including screenshot', () => {
    expect(capabilitiesFor('device')).toEqual({ hotReload: true, screenshot: true, inspect: true, logs: true });
  });
  it('web is degraded: no screenshot', () => {
    expect(capabilitiesFor('web')).toEqual({ hotReload: true, screenshot: false, inspect: true, logs: true });
  });
  it('desktop has no screenshot', () => {
    expect(capabilitiesFor('desktop').screenshot).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && pnpm vitest run test/lib/flutter-vmservice.test.ts`
Expected: FAIL — cannot find module `../../src/lib/flutter-vmservice.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/lib/flutter-vmservice.ts

export type TargetKind = 'device' | 'web' | 'desktop';

export interface VmServiceUri {
  host: string;
  port: number;
  /** Auth-token path segment, always starts and ends with '/', e.g. '/abc123=/' or '/'. */
  authPath: string;
}

export type Parse<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Parse a Dart VM Service URI as printed by `flutter run`
 * ("A Dart VM Service ... is available at: http://127.0.0.1:PORT/<token>=/").
 * Accepts http(s)/ws(s); tolerates a trailing `/ws`. The token lives in the URL
 * PATH and must be preserved verbatim — it is the VM Service's only auth.
 */
export function parseVmServiceUri(raw: string): Parse<VmServiceUri> {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, error: 'not a valid URL' };
  }
  if (!/^(https?|wss?):$/.test(u.protocol)) {
    return { ok: false, error: `unsupported protocol ${u.protocol}` };
  }
  if (!u.port) return { ok: false, error: 'missing port' };
  let path = u.pathname;
  if (path.endsWith('/ws')) path = path.slice(0, -2); // drop trailing 'ws', keep slash
  if (!path.startsWith('/')) path = '/' + path;
  if (!path.endsWith('/')) path = path + '/';
  return { ok: true, value: { host: u.hostname, port: Number(u.port), authPath: path } };
}

/** Build the WebSocket URL the MCP server uses against the tunnelled host/port. */
export function wsUrlFor(uri: VmServiceUri, host: string, port: number): string {
  const base = uri.authPath === '/' ? '' : uri.authPath.replace(/\/$/, '');
  return `ws://${host}:${port}${base}/ws`;
}

export interface Capabilities {
  hotReload: boolean;
  screenshot: boolean;
  inspect: boolean;
  logs: boolean;
}

/** Capability matrix per target. Screenshot is device-only (web/desktop lack `_flutter.screenshot`). */
export function capabilitiesFor(kind: TargetKind): Capabilities {
  return {
    hotReload: true,
    screenshot: kind === 'device',
    inspect: true,
    logs: true,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && pnpm vitest run test/lib/flutter-vmservice.test.ts`
Expected: PASS (12 assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/flutter-vmservice.ts packages/cli/test/lib/flutter-vmservice.test.ts
git commit -m "feat(flutter): VM Service URI parse + capability matrix (pure core)"
```

---

## Task 2: Reverse SSH tunnel arg builder + lifecycle (pure + injectable)

**Files:**
- Create: `packages/cli/src/lib/flutter-tunnel.ts`
- Test: `packages/cli/test/lib/flutter-tunnel.test.ts`

Reuses the SSH option shape from `lib/ssh-runner.ts` (`host`, `user`, `port`, `keyPath`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/lib/flutter-tunnel.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildReverseTunnelArgs, openReverseTunnel } from '../../src/lib/flutter-tunnel.ts';

const ssh = { host: 'h.example', user: 'admin', port: 22, keyPath: '/k' };

describe('buildReverseTunnelArgs', () => {
  it('binds the remote listener to loopback and forwards to the local vm port', () => {
    const args = buildReverseTunnelArgs({ ...ssh, remotePort: 9123, localPort: 50123 });
    expect(args).toEqual([
      '-i', '/k',
      '-p', '22',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'BatchMode=yes',
      '-o', 'ExitOnForwardFailure=yes',
      '-N',
      '-R', '127.0.0.1:9123:127.0.0.1:50123',
      'admin@h.example',
    ]);
  });
});

describe('openReverseTunnel', () => {
  it('spawns ssh with the built args and exposes a stop() that kills the child', () => {
    const kill = vi.fn();
    const spawnAdapter = vi.fn().mockReturnValue({ kill, on: vi.fn() });
    const handle = openReverseTunnel({ ...ssh, remotePort: 9123, localPort: 50123 }, spawnAdapter);
    expect(spawnAdapter).toHaveBeenCalledWith('ssh', expect.arrayContaining(['-R', '127.0.0.1:9123:127.0.0.1:50123']));
    handle.stop();
    expect(kill).toHaveBeenCalled();
  });

  it('invokes onExit when the child closes', () => {
    let closeCb: ((code: number | null) => void) | undefined;
    const child = { kill: vi.fn(), on: (ev: string, cb: (c: number | null) => void) => { if (ev === 'close') closeCb = cb; } };
    const onExit = vi.fn();
    openReverseTunnel({ ...ssh, remotePort: 9123, localPort: 50123 }, () => child as never, onExit);
    closeCb?.(1);
    expect(onExit).toHaveBeenCalledWith(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && pnpm vitest run test/lib/flutter-tunnel.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/lib/flutter-tunnel.ts
import { spawn, type ChildProcess } from 'node:child_process';

export interface ReverseTunnelOpts {
  host: string;
  user: string;
  port: number;
  keyPath: string;
  remotePort: number;
  localPort: number;
}

/**
 * Build `ssh -R` args for a reverse tunnel that exposes the locally-running Dart
 * VM Service (127.0.0.1:localPort) on the remote's LOOPBACK only
 * (127.0.0.1:remotePort) — so only the agent host, not other tailnet peers, can
 * reach the debug channel. `-N` = no remote command; `ExitOnForwardFailure` =
 * fail fast if the remote port is taken.
 */
export function buildReverseTunnelArgs(o: ReverseTunnelOpts): string[] {
  return [
    '-i', o.keyPath,
    '-p', String(o.port),
    '-o', 'StrictHostKeyChecking=accept-new',
    '-o', 'BatchMode=yes',
    '-o', 'ExitOnForwardFailure=yes',
    '-N',
    '-R', `127.0.0.1:${o.remotePort}:127.0.0.1:${o.localPort}`,
    `${o.user}@${o.host}`,
  ];
}

export interface TunnelHandle {
  stop(): void;
}

export type TunnelSpawn = (cmd: string, args: string[]) => Pick<ChildProcess, 'kill' | 'on'>;

const defaultSpawn: TunnelSpawn = (cmd, args) => spawn(cmd, args, { stdio: 'ignore' });

/** Open the reverse tunnel. `onExit` fires with the ssh exit code when it closes. */
export function openReverseTunnel(
  o: ReverseTunnelOpts,
  spawnAdapter: TunnelSpawn = defaultSpawn,
  onExit?: (code: number | null) => void,
): TunnelHandle {
  const child = spawnAdapter('ssh', buildReverseTunnelArgs(o));
  if (onExit) child.on('close', (code: number | null) => onExit(code));
  return { stop: () => child.kill() };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && pnpm vitest run test/lib/flutter-tunnel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/flutter-tunnel.ts packages/cli/test/lib/flutter-tunnel.test.ts
git commit -m "feat(flutter): reverse SSH tunnel arg builder + injectable lifecycle"
```

---

## Task 3: VM Service JSON-RPC-over-WebSocket client

**Files:**
- Create: `packages/cli/src/agent/flutter/vm-client.ts`
- Test: `packages/cli/test/agent/flutter/vm-client.test.ts`
- Modify: `packages/cli/package.json` (add `ws`, `@types/ws`)

Install deps first:

- [ ] **Step 0: Add deps**

Run: `cd packages/cli && pnpm add ws && pnpm add -D @types/ws`

- [ ] **Step 1: Write the failing test**

The client is constructed with an injected socket factory so we can drive it with a fake WebSocket (no real network). The fake echoes a result for each request id.

```ts
// packages/cli/test/agent/flutter/vm-client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { VmServiceClient, findFlutterIsolate } from '../../../src/agent/flutter/vm-client.ts';

class FakeSocket {
  handlers: Record<string, ((data: unknown) => void)[]> = {};
  sent: string[] = [];
  on(ev: string, cb: (data: unknown) => void) { (this.handlers[ev] ??= []).push(cb); }
  emit(ev: string, data?: unknown) { (this.handlers[ev] ?? []).forEach((h) => h(data)); }
  send(s: string) {
    this.sent.push(s);
    const msg = JSON.parse(s);
    // Echo a JSON-RPC result keyed by the request id on the next tick.
    queueMicrotask(() => this.emit('message', JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { echoed: msg.method } })));
  }
  close() { this.emit('close'); }
}

describe('VmServiceClient', () => {
  it('resolves a call with the result matched by id', async () => {
    const sock = new FakeSocket();
    const client = new VmServiceClient(() => sock as never);
    await client.ready();           // resolves when the fake emits 'open'
    sock.emit('open');
    const res = await client.call('getVM', {});
    expect(res).toEqual({ echoed: 'getVM' });
    expect(JSON.parse(sock.sent[0]!)).toMatchObject({ method: 'getVM', jsonrpc: '2.0' });
  });

  it('rejects a call when the response carries an error', async () => {
    const sock = new FakeSocket();
    sock.send = (s: string) => {
      const msg = JSON.parse(s);
      queueMicrotask(() => sock.emit('message', JSON.stringify({ id: msg.id, error: { code: 1, message: 'boom' } })));
    };
    const client = new VmServiceClient(() => sock as never);
    sock.emit('open');
    await expect(client.call('getVM', {})).rejects.toThrow('boom');
  });
});

describe('findFlutterIsolate', () => {
  it('returns the isolate id that has a flutter extension registered', () => {
    const vm = { isolates: [
      { id: 'iso-1', extensionRPCs: [] },
      { id: 'iso-2', extensionRPCs: ['ext.flutter.reassemble', 'ext.flutter.inspector.getRootWidgetSummaryTree'] },
    ] };
    expect(findFlutterIsolate(vm)).toBe('iso-2');
  });
  it('returns undefined when no flutter isolate exists', () => {
    expect(findFlutterIsolate({ isolates: [{ id: 'x', extensionRPCs: [] }] })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && pnpm vitest run test/agent/flutter/vm-client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/agent/flutter/vm-client.ts
import WebSocket from 'ws';

interface Socket {
  on(ev: 'open' | 'message' | 'close' | 'error', cb: (data: unknown) => void): void;
  send(data: string): void;
  close(): void;
}
export type SocketFactory = () => Socket;

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; }

/** Minimal JSON-RPC 2.0 client over the Dart VM Service WebSocket. */
export class VmServiceClient {
  private sock: Socket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private opened: Promise<void>;
  /** Per-stream listener registry for streamed events (e.g. 'Stdout'). */
  readonly onStreamEvent: ((streamId: string, event: Record<string, unknown>) => void)[] = [];

  constructor(factory: SocketFactory) {
    this.sock = factory();
    this.opened = new Promise<void>((res) => this.sock.on('open', () => res()));
    this.sock.on('message', (data) => this.handleMessage(String(data)));
  }

  ready(): Promise<void> { return this.opened; }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw); } catch { return; }
    if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error((msg.error as { message?: string }).message ?? 'VM Service error'));
      else p.resolve(msg.result);
      return;
    }
    // Streamed event: { method: 'streamNotify', params: { streamId, event } }
    if (msg.method === 'streamNotify' && msg.params) {
      const { streamId, event } = msg.params as { streamId: string; event: Record<string, unknown> };
      this.onStreamEvent.forEach((h) => h(streamId, event));
    }
  }

  call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sock.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  close(): void { this.sock.close(); }
}

/** Default factory: a real `ws` WebSocket adapted to the Socket interface. */
export function realSocketFactory(url: string): SocketFactory {
  return () => {
    const ws = new WebSocket(url);
    return {
      on: (ev, cb) => ws.on(ev, cb as never),
      send: (d) => ws.send(d),
      close: () => ws.close(),
    };
  };
}

interface VmIsolateRef { id: string; extensionRPCs?: string[] }
/** Pick the isolate that has Flutter service extensions registered. */
export function findFlutterIsolate(vm: { isolates: VmIsolateRef[] }): string | undefined {
  const iso = vm.isolates.find((i) => (i.extensionRPCs ?? []).some((e) => e.startsWith('ext.flutter.')));
  return iso?.id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/cli && pnpm vitest run test/agent/flutter/vm-client.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/flutter/vm-client.ts packages/cli/test/agent/flutter/vm-client.test.ts packages/cli/package.json pnpm-lock.yaml
git commit -m "feat(flutter): VM Service JSON-RPC/WebSocket client + isolate picker"
```

---

## Task 4: `patchwire-flutter` MCP server (4 tools, target gating)

**Files:**
- Create: `packages/cli/src/agent/flutter/mcp-server.ts`
- Create: `packages/cli/src/commands/flutter-mcp.ts`
- Test: `packages/cli/test/agent/flutter/mcp-server.test.ts`
- Modify: `packages/cli/package.json` (add `@modelcontextprotocol/sdk`)
- Modify: `packages/cli/src/cli.ts` (register subcommand)

The MCP server logic is factored so the **tool handlers** are pure functions over an injected `VmServiceClient`-shaped dependency and a `TargetKind` — that is what we test. The SDK wiring (stdio transport) is a thin shell.

- [ ] **Step 0: Add dep**

Run: `cd packages/cli && pnpm add @modelcontextprotocol/sdk`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/agent/flutter/mcp-server.test.ts
import { describe, it, expect, vi } from 'vitest';
import { makeFlutterTools } from '../../../src/agent/flutter/mcp-server.ts';

function fakeVm(overrides: Record<string, unknown> = {}) {
  return {
    call: vi.fn(async (method: string) => {
      if (method === 'getVM') return { isolates: [{ id: 'iso', extensionRPCs: ['ext.flutter.reassemble'] }] };
      if (method === 'reloadSources') return { success: true };
      if (method === 'ext.flutter.reassemble') return {};
      if (method === '_flutter.screenshot') return { screenshot: 'UE5HBASE64' };
      if (method === 'ext.flutter.inspector.getRootWidgetSummaryTree') return { result: { description: 'Root' } };
      return {};
    }),
    onStreamEvent: [] as ((s: string, e: Record<string, unknown>) => void)[],
    ...overrides,
  };
}

describe('makeFlutterTools', () => {
  it('hot reload calls reloadSources then reassemble on the flutter isolate', async () => {
    const vm = fakeVm();
    const tools = makeFlutterTools(vm as never, 'device');
    const out = await tools.hotReload({ restart: false });
    expect(vm.call).toHaveBeenCalledWith('reloadSources', expect.objectContaining({ isolateId: 'iso' }));
    expect(vm.call).toHaveBeenCalledWith('ext.flutter.reassemble', expect.objectContaining({ isolateId: 'iso' }));
    expect(out.ok).toBe(true);
  });

  it('screenshot returns a base64 PNG image on device', async () => {
    const vm = fakeVm();
    const tools = makeFlutterTools(vm as never, 'device');
    const out = await tools.screenshot();
    expect(out).toEqual({ ok: true, mimeType: 'image/png', base64: 'UE5HBASE64' });
  });

  it('screenshot is unsupported on web (no _flutter.screenshot call made)', async () => {
    const vm = fakeVm();
    const tools = makeFlutterTools(vm as never, 'web');
    const out = await tools.screenshot();
    expect(out).toEqual({ ok: false, error: 'screenshot unsupported on web target' });
    expect(vm.call).not.toHaveBeenCalledWith('_flutter.screenshot', expect.anything());
  });

  it('inspect returns the summary widget tree', async () => {
    const vm = fakeVm();
    const tools = makeFlutterTools(vm as never, 'device');
    const out = await tools.inspect({});
    expect(out.ok).toBe(true);
    expect(out.tree).toEqual({ description: 'Root' });
  });

  it('logs returns buffered stream events', async () => {
    const vm = fakeVm();
    const tools = makeFlutterTools(vm as never, 'device');
    // Simulate a Stdout stream event arriving.
    vm.onStreamEvent.forEach((h) => h('Stdout', { kind: 'WriteEvent', bytes: Buffer.from('hello\n').toString('base64') }));
    const out = await tools.logs({ limit: 10 });
    expect(out.ok).toBe(true);
    expect(out.lines.join('')).toContain('hello');
  });

  it('does NOT expose an evaluate tool', () => {
    const vm = fakeVm();
    const tools = makeFlutterTools(vm as never, 'device') as Record<string, unknown>;
    expect(tools.evaluate).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/cli && pnpm vitest run test/agent/flutter/mcp-server.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/cli/src/agent/flutter/mcp-server.ts
import type { TargetKind } from '../../lib/flutter-vmservice.ts';
import { capabilitiesFor, wsUrlFor, parseVmServiceUri } from '../../lib/flutter-vmservice.ts';
import { VmServiceClient, findFlutterIsolate, realSocketFactory } from './vm-client.ts';

/** The VM dependency the tool handlers need (subset of VmServiceClient). */
export interface VmDep {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
  onStreamEvent: ((streamId: string, event: Record<string, unknown>) => void)[];
}

async function flutterIsolateId(vm: VmDep): Promise<string> {
  const v = (await vm.call('getVM', {})) as { isolates: { id: string; extensionRPCs?: string[] }[] };
  const id = findFlutterIsolate(v);
  if (!id) throw new Error('no Flutter isolate found (is a Flutter app running in debug mode?)');
  return id;
}

export interface FlutterTools {
  hotReload(args: { restart?: boolean }): Promise<{ ok: boolean; error?: string }>;
  screenshot(): Promise<{ ok: boolean; mimeType?: string; base64?: string; error?: string }>;
  inspect(args: { subtree?: string }): Promise<{ ok: boolean; tree?: unknown; error?: string }>;
  logs(args: { limit?: number }): Promise<{ ok: boolean; lines: string[] }>;
}

/**
 * Build the four scoped tool handlers over a VM dependency and target kind.
 * NOTE: there is deliberately NO `evaluate`/arbitrary-eval handler (threat model).
 */
export function makeFlutterTools(vm: VmDep, target: TargetKind): FlutterTools {
  const caps = capabilitiesFor(target);
  const logBuffer: string[] = [];
  vm.onStreamEvent.push((streamId, event) => {
    if (streamId === 'Stdout' || streamId === 'Stderr' || streamId === 'Logging' || streamId === 'Extension') {
      const bytes = event.bytes as string | undefined;
      if (bytes) logBuffer.push(Buffer.from(bytes, 'base64').toString('utf8'));
    }
  });

  return {
    async hotReload({ restart }) {
      const isolateId = await flutterIsolateId(vm);
      const r = (await vm.call('reloadSources', { isolateId, force: !!restart })) as { success?: boolean };
      await vm.call('ext.flutter.reassemble', { isolateId });
      return { ok: r.success !== false };
    },
    async screenshot() {
      if (!caps.screenshot) return { ok: false, error: `screenshot unsupported on ${target} target` };
      const r = (await vm.call('_flutter.screenshot', {})) as { screenshot?: string };
      if (!r.screenshot) return { ok: false, error: 'no screenshot returned' };
      return { ok: true, mimeType: 'image/png', base64: r.screenshot };
    },
    async inspect({ subtree } = {}) {
      const isolateId = await flutterIsolateId(vm);
      const r = (await vm.call('ext.flutter.inspector.getRootWidgetSummaryTree', {
        isolateId, groupName: 'patchwire', ...(subtree ? { subtreeDepth: subtree } : {}),
      })) as { result?: unknown };
      return { ok: true, tree: r.result };
    },
    async logs({ limit } = {}) {
      const n = limit ?? 200;
      return { ok: true, lines: logBuffer.slice(-n) };
    },
  };
}

/**
 * Boot a stdio MCP server named `patchwire-flutter` that connects to the
 * tunnelled VM Service (from env) and registers the four scoped tools.
 * Env: PW_FLUTTER_VM_URL (full tunnelled http url incl. token path),
 *      PW_FLUTTER_TARGET ('device'|'web'|'desktop').
 */
export async function runFlutterMcpServer(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { z } = await import('zod');

  const url = env.PW_FLUTTER_VM_URL;
  const target = (env.PW_FLUTTER_TARGET ?? 'device') as TargetKind;
  if (!url) throw new Error('PW_FLUTTER_VM_URL not set');
  const parsed = parseVmServiceUri(url);
  if (!parsed.ok) throw new Error(`bad PW_FLUTTER_VM_URL: ${parsed.error}`);
  const wsUrl = wsUrlFor(parsed.value, parsed.value.host, parsed.value.port);

  const client = new VmServiceClient(realSocketFactory(wsUrl));
  await client.ready();
  // Subscribe to log streams so the `logs` tool has data.
  for (const s of ['Stdout', 'Stderr', 'Logging', 'Extension']) {
    await client.call('streamListen', { streamId: s }).catch(() => {});
  }
  const tools = makeFlutterTools(client, target);

  const server = new McpServer({ name: 'patchwire-flutter', version: '0.1.0' });
  server.tool('flutter_hot_reload', { restart: z.boolean().optional() }, async (a: { restart?: boolean }) => {
    const r = await tools.hotReload(a);
    return { content: [{ type: 'text', text: JSON.stringify(r) }] };
  });
  server.tool('flutter_screenshot', {}, async () => {
    const r = await tools.screenshot();
    if (r.ok && r.base64) return { content: [{ type: 'image', data: r.base64, mimeType: r.mimeType! }] };
    return { content: [{ type: 'text', text: JSON.stringify(r) }], isError: !r.ok };
  });
  server.tool('flutter_inspect', { subtree: z.string().optional() }, async (a: { subtree?: string }) => {
    const r = await tools.inspect(a);
    return { content: [{ type: 'text', text: JSON.stringify(r.tree ?? r) }] };
  });
  server.tool('flutter_logs', { limit: z.number().optional() }, async (a: { limit?: number }) => {
    const r = await tools.logs(a);
    return { content: [{ type: 'text', text: r.lines.join('') }] };
  });

  await server.connect(new StdioServerTransport());
}
```

```ts
// packages/cli/src/commands/flutter-mcp.ts
import type { Command } from 'commander';
import { runFlutterMcpServer } from '../agent/flutter/mcp-server.ts';

/** Hidden subcommand launched by `claude` via --mcp-config. Reads PW_FLUTTER_* env. */
export function registerFlutterMcpCommand(program: Command): void {
  program
    .command('flutter-mcp', { hidden: true })
    .description('Run the patchwire-flutter MCP server (stdio) against a tunnelled VM Service')
    .action(async () => {
      await runFlutterMcpServer();
    });
}
```

- [ ] **Step 4: Wire the subcommand into the CLI**

In `packages/cli/src/cli.ts`, add the import and registration alongside the existing `register*Command` calls:

```ts
import { registerFlutterMcpCommand } from './commands/flutter-mcp.ts';
// ... after other register*Command(program) calls:
registerFlutterMcpCommand(program);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/cli && pnpm vitest run test/agent/flutter/mcp-server.test.ts`
Expected: PASS (6 tests). Then `pnpm --filter @rebink/patchwire typecheck` — Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/agent/flutter/mcp-server.ts packages/cli/src/commands/flutter-mcp.ts packages/cli/src/cli.ts packages/cli/test/agent/flutter/mcp-server.test.ts packages/cli/package.json pnpm-lock.yaml
git commit -m "feat(flutter): patchwire-flutter MCP server with 4 scoped tools, no evaluate"
```

---

## Task 5: Protocol event + agent session store + MCP-config injection

**Files:**
- Modify: `packages/protocol/src/events.ts`
- Create: `packages/cli/src/agent/flutter/session-store.ts`
- Create: `packages/cli/src/agent/flutter/mcp-config.ts`
- Modify: `packages/cli/src/agent/ai-runner.ts`
- Modify: `packages/cli/src/agent/server.ts`
- Test: `packages/cli/test/agent/flutter/session-store.test.ts`, `packages/cli/test/agent/flutter/mcp-config.test.ts`, `packages/cli/test/agent/flutter-session-route.test.ts`

### 5a — Protocol types

- [ ] **Step 1: Add types to `packages/protocol/src/events.ts`** (append at end)

```ts
export type FlutterTarget = 'device' | 'web' | 'desktop';

/** A registered live Flutter session for a project (tunnelled VM Service). */
export interface FlutterSession {
  project: string;
  /** Tunnelled VM Service URL on the agent host loopback, incl. token path. */
  url: string;
  target: FlutterTarget;
}

/** Request body for `POST /flutter/session` (attach). */
export interface FlutterSessionBody {
  project: string;
  url: string;
  target: FlutterTarget;
}
```

- [ ] **Step 2: Commit the protocol change**

```bash
git add packages/protocol/src/events.ts
git commit -m "feat(protocol): FlutterSession + FlutterSessionBody types"
```

### 5b — Session store (in-memory)

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/agent/flutter/session-store.test.ts
import { describe, it, expect } from 'vitest';
import { FlutterSessionStore } from '../../../src/agent/flutter/session-store.ts';

describe('FlutterSessionStore', () => {
  it('stores and retrieves a session per (user, project)', () => {
    const s = new FlutterSessionStore();
    s.set('alice', { project: 'app', url: 'http://127.0.0.1:9123/t=/', target: 'device' });
    expect(s.get('alice', 'app')?.target).toBe('device');
    expect(s.get('alice', 'other')).toBeUndefined();
    expect(s.get('bob', 'app')).toBeUndefined();
  });

  it('clears a session', () => {
    const s = new FlutterSessionStore();
    s.set('alice', { project: 'app', url: 'http://x/', target: 'web' });
    s.clear('alice', 'app');
    expect(s.get('alice', 'app')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test → FAIL** (`cd packages/cli && pnpm vitest run test/agent/flutter/session-store.test.ts`).

- [ ] **Step 3: Implement**

```ts
// packages/cli/src/agent/flutter/session-store.ts
import type { FlutterSession } from '@patchwire/protocol';

/** In-memory per-(user, project) registry of live Flutter sessions. Ephemeral by design. */
export class FlutterSessionStore {
  private map = new Map<string, FlutterSession>();
  private key(user: string, project: string): string { return `${user} ${project}`; }

  set(user: string, session: FlutterSession): void { this.map.set(this.key(user, session.project), session); }
  get(user: string, project: string): FlutterSession | undefined { return this.map.get(this.key(user, project)); }
  clear(user: string, project: string): void { this.map.delete(this.key(user, project)); }
}
```

- [ ] **Step 4: Run test → PASS.**

### 5c — MCP config builder (pure)

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/agent/flutter/mcp-config.test.ts
import { describe, it, expect } from 'vitest';
import { buildMcpConfig } from '../../../src/agent/flutter/mcp-config.ts';

describe('buildMcpConfig', () => {
  it('builds an mcp config that launches the patchwire flutter-mcp subcommand with VM env', () => {
    const cfg = buildMcpConfig({ project: 'app', url: 'http://127.0.0.1:9123/tok=/', target: 'web' }, '/usr/local/bin/patchwire');
    expect(cfg).toEqual({
      mcpServers: {
        'patchwire-flutter': {
          command: '/usr/local/bin/patchwire',
          args: ['flutter-mcp'],
          env: { PW_FLUTTER_VM_URL: 'http://127.0.0.1:9123/tok=/', PW_FLUTTER_TARGET: 'web' },
        },
      },
    });
  });
});
```

- [ ] **Step 2: Run test → FAIL.**

- [ ] **Step 3: Implement**

```ts
// packages/cli/src/agent/flutter/mcp-config.ts
import type { FlutterSession } from '@patchwire/protocol';

export interface McpConfig {
  mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
}

/** Build the `--mcp-config` JSON that wires the patchwire-flutter MCP server for a session. */
export function buildMcpConfig(session: FlutterSession, patchwireBin: string): McpConfig {
  return {
    mcpServers: {
      'patchwire-flutter': {
        command: patchwireBin,
        args: ['flutter-mcp'],
        env: { PW_FLUTTER_VM_URL: session.url, PW_FLUTTER_TARGET: session.target },
      },
    },
  };
}
```

- [ ] **Step 4: Run test → PASS.**

### 5d — ai-runner accepts an MCP config path

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/ai-runner-mcp.test.ts
import { describe, it, expect } from 'vitest';
import { withMcpArgs } from '../src/agent/ai-runner.ts';

describe('withMcpArgs', () => {
  it('appends --mcp-config and --strict-mcp-config when a path is given', () => {
    expect(withMcpArgs(['--print'], '/tmp/mcp.json')).toEqual(
      ['--print', '--mcp-config', '/tmp/mcp.json', '--strict-mcp-config']);
  });
  it('returns the args unchanged when no path is given', () => {
    expect(withMcpArgs(['--print'], undefined)).toEqual(['--print']);
  });
});
```

- [ ] **Step 2: Run test → FAIL** (`pnpm vitest run test/ai-runner-mcp.test.ts`).

- [ ] **Step 3: Implement — add to `packages/cli/src/agent/ai-runner.ts`** (top-level export)

```ts
/** Append Claude MCP-config flags when a per-session config path is provided. */
export function withMcpArgs(args: string[], mcpConfigPath?: string): string[] {
  if (!mcpConfigPath) return args;
  return [...args, '--mcp-config', mcpConfigPath, '--strict-mcp-config'];
}
```

Then thread it through `runAi`: add `mcpConfigPath?: string` to its `opts`, and compute the effective args before spawn:

```ts
// inside runAi, replace `opts.args` usage in the `run`/spawn line with:
const effectiveArgs = withMcpArgs(opts.args, opts.mcpConfigPath);
const run = opts.egressProfilePath
  ? wrapWithEgress(opts.command, effectiveArgs, opts.egressProfilePath)
  : { command: opts.command, args: effectiveArgs };
```

(Add `mcpConfigPath?: string;` to the `runAi` options interface.)

- [ ] **Step 4: Run test → PASS.**

### 5e — Mount routes + write the config in `/ask`

- [ ] **Step 1: Write the failing route test**

```ts
// packages/cli/test/agent/flutter-session-route.test.ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import { FlutterSessionStore } from '../../src/agent/flutter/session-store.ts';
import { registerFlutterSessionRoutes } from '../../src/agent/server.ts';

function appWith(store: FlutterSessionStore) {
  const app = Fastify();
  app.addHook('onRequest', async (req) => { (req as { username?: string }).username = 'alice'; });
  registerFlutterSessionRoutes(app, store);
  return app;
}

describe('flutter session routes', () => {
  it('attaches via POST and stores the session', async () => {
    const store = new FlutterSessionStore();
    const app = appWith(store);
    const res = await app.inject({ method: 'POST', url: '/flutter/session',
      payload: { project: 'app', url: 'http://127.0.0.1:9123/t=/', target: 'device' } });
    expect(res.statusCode).toBe(204);
    expect(store.get('alice', 'app')?.target).toBe('device');
  });

  it('rejects an invalid target', async () => {
    const app = appWith(new FlutterSessionStore());
    const res = await app.inject({ method: 'POST', url: '/flutter/session',
      payload: { project: 'app', url: 'http://x/', target: 'phone' } });
    expect(res.statusCode).toBe(400);
  });

  it('detaches via DELETE', async () => {
    const store = new FlutterSessionStore();
    store.set('alice', { project: 'app', url: 'http://x/', target: 'web' });
    const app = appWith(store);
    const res = await app.inject({ method: 'DELETE', url: '/flutter/session/app' });
    expect(res.statusCode).toBe(204);
    expect(store.get('alice', 'app')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test → FAIL** (`registerFlutterSessionRoutes` not exported).

- [ ] **Step 3: Implement — add to `packages/cli/src/agent/server.ts`**

Add imports near the top:

```ts
import { FlutterSessionStore } from './flutter/session-store.ts';
import { buildMcpConfig } from './flutter/mcp-config.ts';
import type { FlutterTarget } from '@patchwire/protocol';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
```

Add the route registrar (mirrors `registerDeleteSession`):

```ts
const FlutterSessionPostBody = z.object({
  project: z.string().min(1).regex(/^[a-zA-Z0-9_.-]+$/, 'invalid project name'),
  url: z.string().url(),
  target: z.enum(['device', 'web', 'desktop']),
});

/** Mount POST /flutter/session (attach) + DELETE /flutter/session/:project (detach). */
export function registerFlutterSessionRoutes(app: FastifyInstance, store: FlutterSessionStore): void {
  app.post('/flutter/session', async (req: FastifyRequest, reply) => {
    const parsed = FlutterSessionPostBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid body', issues: parsed.error.issues });
    store.set(req.username!, parsed.data);
    return reply.status(204).send();
  });
  app.delete('/flutter/session/:project', async (req: FastifyRequest<{ Params: { project: string } }>, reply) => {
    store.clear(req.username!, req.params.project);
    return reply.status(204).send();
  });
}
```

In `buildServer`, construct the store and mount the routes (after `registerSessionStatus(app, turns);`):

```ts
const flutterSessions = new FlutterSessionStore();
registerFlutterSessionRoutes(app, flutterSessions);
```

In the `/ask` handler, before calling `runAi`, build a per-session MCP config file when a session exists:

```ts
let mcpConfigPath: string | undefined;
const fsession = flutterSessions.get(username, project);
if (fsession) {
  const dir = mkdtempSync(join(tmpdir(), 'pw-flutter-'));
  mcpConfigPath = join(dir, 'mcp.json');
  // `process.execPath`-installed CLI: the agent is launched as the patchwire bin.
  writeFileSync(mcpConfigPath, JSON.stringify(buildMcpConfig(fsession, process.argv[1] ?? 'patchwire')), { mode: 0o600 });
}
```

…and pass it into `runAi`:

```ts
claudeResult = await runAi({
  command: opts.aiCommand,
  args: opts.aiArgs,
  prompt,
  cwd: projectDir,
  timeoutMs: opts.timeoutSec * 1000,
  ...(mcpConfigPath ? { mcpConfigPath } : {}),
  ...(opts.egressProfilePath ? { egressProfilePath: opts.egressProfilePath } : {}),
});
```

- [ ] **Step 4: Run all Task-5 tests → PASS**

Run: `cd packages/cli && pnpm vitest run test/agent/flutter test/ai-runner-mcp.test.ts test/agent/flutter-session-route.test.ts`
Then: `pnpm --filter @rebink/patchwire typecheck`
Expected: all PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/flutter/session-store.ts packages/cli/src/agent/flutter/mcp-config.ts \
  packages/cli/src/agent/ai-runner.ts packages/cli/src/agent/server.ts \
  packages/cli/test/agent/flutter/session-store.test.ts packages/cli/test/agent/flutter/mcp-config.test.ts \
  packages/cli/test/ai-runner-mcp.test.ts packages/cli/test/agent/flutter-session-route.test.ts
git commit -m "feat(flutter): agent session store + routes + per-session MCP config injection"
```

---

## Task 6: Desktop Flutter panel (attach state machine + UI)

**Files:**
- Create: `packages/desktop/src/lib/flutter-attach.ts`
- Test: `packages/desktop/src/lib/flutter-attach.test.ts`
- Modify: `packages/desktop/src/lib/ipc.ts`
- Create: `packages/desktop/src/components/FlutterPanel.svelte` + `FlutterPanel.test.ts`
- Modify: `packages/desktop/src/screens/Workspace.svelte`

### 6a — Attach state machine (pure, mirrors `lib/sync-events.ts`)

- [ ] **Step 1: Write the failing test**

```ts
// packages/desktop/src/lib/flutter-attach.test.ts
import { describe, it, expect } from 'vitest';
import { reduceAttach, initialAttach, type AttachState } from './flutter-attach';

describe('reduceAttach', () => {
  it('starts detached', () => {
    expect(initialAttach.kind).toBe('detached');
  });
  it('attach request → attaching', () => {
    const s = reduceAttach(initialAttach, { type: 'attach_requested' });
    expect(s.kind).toBe('attaching');
  });
  it('attached event carries target + capabilities', () => {
    const s = reduceAttach({ kind: 'attaching' } as AttachState, { type: 'attached', target: 'web' });
    expect(s.kind).toBe('attached');
    if (s.kind === 'attached') {
      expect(s.target).toBe('web');
      expect(s.capabilities.screenshot).toBe(false);
    }
  });
  it('error event carries a message', () => {
    const s = reduceAttach({ kind: 'attaching' } as AttachState, { type: 'error', message: 'bad uri' });
    expect(s).toEqual({ kind: 'error', message: 'bad uri' });
  });
  it('vm closed while attached → detached', () => {
    const s = reduceAttach({ kind: 'attached', target: 'device', capabilities: { hotReload: true, screenshot: true, inspect: true, logs: true } }, { type: 'vm_closed' });
    expect(s.kind).toBe('detached');
  });
});
```

- [ ] **Step 2: Run test → FAIL** (`cd packages/desktop && pnpm vitest run src/lib/flutter-attach.test.ts`).

- [ ] **Step 3: Implement**

```ts
// packages/desktop/src/lib/flutter-attach.ts
export type FlutterTarget = 'device' | 'web' | 'desktop';

export interface Capabilities { hotReload: boolean; screenshot: boolean; inspect: boolean; logs: boolean; }

export function capabilitiesFor(target: FlutterTarget): Capabilities {
  return { hotReload: true, screenshot: target === 'device', inspect: true, logs: true };
}

export type AttachState =
  | { kind: 'detached' }
  | { kind: 'attaching' }
  | { kind: 'attached'; target: FlutterTarget; capabilities: Capabilities }
  | { kind: 'error'; message: string };

export type AttachEvent =
  | { type: 'attach_requested' }
  | { type: 'attached'; target: FlutterTarget }
  | { type: 'vm_closed' }
  | { type: 'detach_requested' }
  | { type: 'error'; message: string };

export const initialAttach: AttachState = { kind: 'detached' };

export function reduceAttach(_state: AttachState, ev: AttachEvent): AttachState {
  switch (ev.type) {
    case 'attach_requested': return { kind: 'attaching' };
    case 'attached': return { kind: 'attached', target: ev.target, capabilities: capabilitiesFor(ev.target) };
    case 'error': return { kind: 'error', message: ev.message };
    case 'vm_closed':
    case 'detach_requested': return { kind: 'detached' };
  }
}
```

- [ ] **Step 4: Run test → PASS.**

### 6b — IPC surface

- [ ] **Step 1: Add to `packages/desktop/src/lib/ipc.ts`** (follow the existing `invoke`/`listen` pattern)

```ts
import type { FlutterTarget } from "./flutter-attach";

/** Best-effort detection of a running VM Service URI (clipboard scan in the Rust cmd). Returns null if none. */
export async function detectVmUri(): Promise<string | null> {
  const r = await invoke<string | null>("detect_vm_uri");
  return typeof r === "string" && r ? r : null;
}

/** Validate the URI, open the reverse tunnel, register the session with the agent. Returns the detected target. */
export async function startFlutterAttach(projectDir: string, vmUri: string): Promise<FlutterTarget> {
  return invoke<FlutterTarget>("start_flutter_attach", { projectDir, vmUri });
}

export async function stopFlutterAttach(projectDir: string): Promise<void> {
  await invoke("stop_flutter_attach", { projectDir });
}

/** Fires when the tunnelled VM Service WebSocket closes (app restart). */
export async function onFlutterVmClosed(handler: () => void): Promise<UnlistenFn> {
  return listen<string>("pw://flutter-vm-closed", () => handler());
}
```

> **Note (Rust/Tauri side — live-verified, not unit-tested):** add matching `#[tauri::command]` handlers `detect_vm_uri`, `start_flutter_attach`, `stop_flutter_attach` in `src-tauri`, following the existing `sync_command` / `open_terminal` handlers. `start_flutter_attach` runs the CLI to: parse the URI (`flutter-vmservice`), pick a free remote port, `openReverseTunnel`, probe the VM for its target kind + confirm a Flutter isolate, then `POST /flutter/session`. On WebSocket close it emits `pw://flutter-vm-closed`. This edge is covered by the manual live-verification checklist (Task 7), consistent with the spec's honest-scope note.

- [ ] **Step 2: Typecheck** — `cd packages/desktop && pnpm typecheck` (Expected: clean; no unit test for the thin IPC wrappers, matching existing `ipc.ts` which is untested).

### 6c — Panel component

- [ ] **Step 1: Write the failing test** (mirrors `components/ChatPane.test.ts` render+interaction style)

```ts
// packages/desktop/src/components/FlutterPanel.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import FlutterPanel from './FlutterPanel.svelte';

describe('FlutterPanel', () => {
  it('shows a detached pill and an Attach button initially', () => {
    const { getByText, getByPlaceholderText } = render(FlutterPanel, { props: { projectDir: '/p' } });
    expect(getByText(/detached/i)).toBeTruthy();
    expect(getByPlaceholderText(/Dart VM Service/i)).toBeTruthy();
  });

  it('disables Attach when the URI field is empty', () => {
    const { getByRole } = render(FlutterPanel, { props: { projectDir: '/p' } });
    const btn = getByRole('button', { name: /attach/i }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test → FAIL** (`cd packages/desktop && pnpm vitest run src/components/FlutterPanel.test.ts`).

- [ ] **Step 3: Implement the component**

```svelte
<!-- packages/desktop/src/components/FlutterPanel.svelte -->
<script lang="ts">
  import { reduceAttach, initialAttach, type AttachState } from "../lib/flutter-attach";
  import { detectVmUri, startFlutterAttach, stopFlutterAttach, onFlutterVmClosed } from "../lib/ipc";
  import { onMount } from "svelte";

  export let projectDir: string;
  let vmUri = "";
  let state: AttachState = initialAttach;

  onMount(() => {
    let un: (() => void) | undefined;
    onFlutterVmClosed(() => { state = reduceAttach(state, { type: "vm_closed" }); }).then((u) => (un = u));
    return () => un?.();
  });

  async function detect() {
    const u = await detectVmUri();
    if (u) vmUri = u;
  }
  async function attach() {
    state = reduceAttach(state, { type: "attach_requested" });
    try {
      const target = await startFlutterAttach(projectDir, vmUri);
      state = reduceAttach(state, { type: "attached", target });
    } catch (e) {
      state = reduceAttach(state, { type: "error", message: (e as Error).message ?? String(e) });
    }
  }
  async function detach() {
    await stopFlutterAttach(projectDir);
    state = reduceAttach(state, { type: "detach_requested" });
  }
</script>

<div class="flutter-panel">
  <header>
    <span class="pill pill-{state.kind}">{state.kind}</span>
    {#if state.kind === "attached"}
      <span class="target">{state.target}{state.capabilities.screenshot ? "" : " · screenshot N/A"}</span>
    {/if}
    {#if state.kind === "error"}<span class="err">{state.message}</span>{/if}
  </header>

  {#if state.kind === "attached"}
    <button on:click={detach}>Detach</button>
  {:else}
    <input placeholder="Dart VM Service URI (http://127.0.0.1:…/token=/)" bind:value={vmUri} />
    <button on:click={detect}>Detect</button>
    <button on:click={attach} disabled={!vmUri || state.kind === "attaching"}>Attach</button>
  {/if}
</div>
```

- [ ] **Step 4: Run test → PASS.**

- [ ] **Step 5: Mount in `screens/Workspace.svelte`** — import and render `<FlutterPanel projectDir={...} />` in the open-project view, alongside the existing chat/changes panels (follow how `ChatPane`/`ChangesPanel` are placed). Run `pnpm vitest run src/screens/Workspace.test.ts` to confirm no regression.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/lib/flutter-attach.ts packages/desktop/src/lib/flutter-attach.test.ts \
  packages/desktop/src/lib/ipc.ts packages/desktop/src/components/FlutterPanel.svelte \
  packages/desktop/src/components/FlutterPanel.test.ts packages/desktop/src/screens/Workspace.svelte
git commit -m "feat(desktop): Flutter panel — attach state machine, IPC, status pill"
```

---

## Task 7: Docs — feature page, threat model, stance caveat, live-verify checklist

**Files:**
- Create: `packages/website/src/content/docs/flutter.md`
- Modify: `packages/website/src/pages/index.astro`

> **Website note:** per the `website-pr-workflow` memory, website changes go through a PR, never a direct push to main. Make these edits on a branch and open a PR.

- [ ] **Step 1: Write `packages/website/src/content/docs/flutter.md`**

Content must cover (prose, following the existing docs voice in `content/docs/*.md`):
- **What it does:** dev runs `flutter run` locally; Patchwire attaches to the Dart VM Service; the remote agent gets four scoped tools (hot reload, screenshot, inspect, logs). Compile + run stay local.
- **Not the device bridge:** distinguish from the deleted M4 (which ran Flutter remotely).
- **Capability matrix** (copy the table from the spec): device = full; web = no screenshot; desktop = no screenshot.
- **Threat model:** opt-in, per-session, dev-initiated; reverse tunnel bound to remote loopback; no raw `evaluate` tool exposed; ephemeral (dies on app restart). This is reverse *ingress*, orthogonal to the M3 egress seatbelt.
- **Manual live-verification checklist** (the honest-scope steps below).

- [ ] **Step 2: Add the manual live-verification checklist to that page**

```markdown
## Live verification (manual — requires a real device/sim)

1. `flutter run` a debug build locally on a simulator or device; copy the printed VM Service URI.
2. In the desktop app, open the project → Flutter panel → paste the URI → Attach. Pill shows `attached` + target.
3. Ask the remote agent to call `flutter_screenshot`; confirm it returns the current frame.
4. Ask it to make a small UI edit, sync, then `flutter_hot_reload`; confirm the running app updates.
5. Hot-restart the app locally; confirm the pill flips to `detached` (tunnel/WS closed) and re-attach works.
6. Attach a **web** target; confirm `flutter_screenshot` reports "unsupported on web" while inspect/logs work.
```

- [ ] **Step 3: Add the M5 stance caveat to `packages/website/src/pages/index.astro`**

Find the `04 · the stance` / "Only the code you share crosses the wire" copy (added in the M5 realignment) and append one honest clause, e.g.:

> "…never leave your laptop — unless you explicitly attach a live Flutter session, which opens a scoped, opt-in debug channel to your running app (and nothing else)."

- [ ] **Step 4: Build the site to confirm no breakage**

Run: `pnpm --filter patchwire-docs build`
Expected: build succeeds.

- [ ] **Step 5: Commit on a branch + open PR**

```bash
git checkout -b docs/flutter-live-attach
git add packages/website/src/content/docs/flutter.md packages/website/src/pages/index.astro
git commit -m "docs(website): Flutter live-attach feature page + M5 stance caveat"
# open a PR per website-pr-workflow (do not push to main)
```

---

## Final verification (whole feature)

- [ ] Run the full CLI suite: `pnpm --filter @rebink/patchwire test` — Expected: all green (no regressions).
- [ ] Run the desktop suite: `pnpm --filter patchwire-desktop test` — Expected: all green.
- [ ] Typecheck the workspace: `pnpm typecheck` — Expected: clean.
- [ ] Walk the manual live-verification checklist (Task 7) against a real `flutter run`. This is the only place the end-to-end loop is proven; CI covers the pure cores + faked-dep orchestration only (honest scope, per spec).

---

## Self-Review notes (coverage map spec → tasks)

- VM Service URI parse / ws url / capability matrix → **Task 1**.
- Reverse SSH tunnel (loopback bind, reuse SSH creds) → **Task 2**.
- VM Service client + Flutter isolate selection → **Task 3**.
- MCP server with 4 scoped tools, target gating (web no screenshot), **no evaluate** → **Task 4**.
- Protocol `flutterSession` event, agent session store, ai-runner MCP injection, attach/detach routes → **Task 5**.
- Per-project ephemeral attach UX, status pill, capability display, re-attach on restart → **Task 6**.
- Threat model, M5 stance caveat, capability matrix docs, honest-scope live-verify checklist → **Task 7**.
- Hot-restart→detached handling → Task 6 state machine (`vm_closed`) + Task 6b Rust emit + checklist step 5.
- Remote port allocation (open item from brainstorm) → resolved in Task 6b Rust handler (probe a free port); the pure arg builder (Task 2) takes `remotePort` as input so it stays testable.
