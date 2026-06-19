# Service Projection (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core engine + CLI that exposes a developer's local services (Docker DBs, Flutter/Dart servers) to a remotely-running Claude Code agent via supervised reverse SSH tunnels, with same-port mirroring, a manifest, and an MCP services registry.

**Architecture:** Local discoverers find running Docker/Dart services. A transport-agnostic `ServiceProjectionManager` binds each confirmed service through a `Transport` (Approach A: supervised per-service `ssh -R` onto the remote loopback), mirroring the local port when free. Each projection is published to a `0o600` `services.json` manifest; a `patchwire-services` MCP server reads that manifest so the remote agent can discover services at runtime. A `patchwire services` CLI drives the whole loop headless.

**Tech Stack:** TypeScript (ESM, `.ts` import specifiers), Node ≥20, vitest, commander, `@modelcontextprotocol/sdk`. Tests live under `packages/cli/test/**` mirroring `packages/cli/src/**`.

**Spec:** `docs/superpowers/specs/2026-06-19-service-projection-design.md`

---

## File Structure (Phase 1)

| File | Responsibility |
|------|----------------|
| `packages/cli/src/lib/reverse-tunnel.ts` | Generic reverse-tunnel builder/opener (generalized from `flutter-tunnel.ts`) |
| `packages/cli/src/lib/flutter-tunnel.ts` | Re-exports from `reverse-tunnel.ts` (keeps Flutter path working) |
| `packages/cli/src/services/types.ts` | Shared types + `Discoverer`/`Transport`/manager interfaces |
| `packages/cli/src/services/discoverers/docker.ts` | Parse `docker ps` → `DiscoveredService[]` |
| `packages/cli/src/services/discoverers/dart.ts` | Detect Dart VM Service + dev server |
| `packages/cli/src/services/mirror.ts` | Candidate remote ports + first-stable-port selection |
| `packages/cli/src/services/transport-ssh.ts` | `Transport` over `openReverseTunnel` |
| `packages/cli/src/services/manager.ts` | `ServiceProjectionManager`: bind/unbind/status/supervision |
| `packages/cli/src/services/manifest.ts` | Atomic `0o600` `services.json` writer/reader |
| `packages/cli/src/agent/services/mcp-server.ts` | `patchwire-services` MCP (manifest-backed) |
| `packages/cli/src/commands/services.ts` | `patchwire services` subcommands |
| `packages/cli/src/commands/services-mcp.ts` | Hidden `services-mcp` launcher |
| `packages/cli/src/cli.ts` | Register the two commands |

Each `src` file has a sibling test under `packages/cli/test/...` with the same relative path.

---

## Task 1: Generalize the reverse tunnel

**Files:**
- Create: `packages/cli/src/lib/reverse-tunnel.ts`
- Modify: `packages/cli/src/lib/flutter-tunnel.ts` (replace body with re-exports)
- Test: `packages/cli/test/lib/reverse-tunnel.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/lib/reverse-tunnel.test.ts
import { describe, it, expect, vi } from 'vitest';
import { buildReverseTunnelArgs, openReverseTunnel } from '../../src/lib/reverse-tunnel.ts';

const ssh = { host: 'h.example', user: 'admin', port: 22, keyPath: '/k' };

describe('buildReverseTunnelArgs', () => {
  it('binds the remote listener to loopback and forwards to the local port', () => {
    expect(buildReverseTunnelArgs({ ...ssh, remotePort: 9123, localPort: 50123 })).toEqual([
      '-i', '/k', '-p', '22',
      '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'BatchMode=yes',
      '-o', 'ExitOnForwardFailure=yes',
      '-N', '-R', '127.0.0.1:9123:127.0.0.1:50123',
      'admin@h.example',
    ]);
  });
});

describe('openReverseTunnel', () => {
  it('spawns ssh with the built args and stop() kills the child', () => {
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

Run: `pnpm --filter @rebink/patchwire test -- reverse-tunnel`
Expected: FAIL — cannot resolve `../../src/lib/reverse-tunnel.ts`.

- [ ] **Step 3: Create `reverse-tunnel.ts`**

Copy the current contents of `packages/cli/src/lib/flutter-tunnel.ts` into the new file, renaming only the doc comment to be service-agnostic:

```ts
// packages/cli/src/lib/reverse-tunnel.ts
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
 * Build `ssh -R` args for a reverse tunnel that exposes a locally-running
 * service (127.0.0.1:localPort) on the remote's LOOPBACK only
 * (127.0.0.1:remotePort) — so only processes on the agent host can reach it.
 * `-N` = no remote command; `ExitOnForwardFailure` = fail fast if the remote
 * port is taken.
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

- [ ] **Step 4: Replace `flutter-tunnel.ts` body with re-exports**

```ts
// packages/cli/src/lib/flutter-tunnel.ts
// Flutter live-attach uses the generic reverse tunnel. Kept as a re-export so
// existing imports (agent/flutter) stay valid.
export {
  buildReverseTunnelArgs,
  openReverseTunnel,
  type ReverseTunnelOpts,
  type TunnelHandle,
  type TunnelSpawn,
} from './reverse-tunnel.ts';
```

- [ ] **Step 5: Run both tunnel tests + typecheck**

Run: `pnpm --filter @rebink/patchwire test -- tunnel && pnpm --filter @rebink/patchwire typecheck`
Expected: PASS — both `reverse-tunnel.test.ts` and the existing `flutter-tunnel.test.ts` pass; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/lib/reverse-tunnel.ts packages/cli/src/lib/flutter-tunnel.ts packages/cli/test/lib/reverse-tunnel.test.ts
git commit -m "refactor(cli): generalize flutter reverse-tunnel into reverse-tunnel.ts"
```

---

## Task 2: Shared service types

**Files:**
- Create: `packages/cli/src/services/types.ts`
- Test: `packages/cli/test/services/types.test.ts`

- [ ] **Step 1: Write the failing test** (a compile-level guard that the types exist and are shaped right)

```ts
// packages/cli/test/services/types.test.ts
import { describe, it, expect } from 'vitest';
import type { DiscoveredService, Projection, SshTarget, Discoverer, Transport } from '../../src/services/types.ts';

describe('service types', () => {
  it('a Projection composes a DiscoveredService with remote binding info', () => {
    const svc: DiscoveredService = {
      id: 'docker:5432', label: 'Postgres', kind: 'docker', localPort: 5432,
      connectionHint: 'postgres://127.0.0.1:5432',
    };
    const p: Projection = { service: svc, remotePort: 5432, mirrored: true, status: 'active' };
    expect(p.service.localPort).toBe(5432);
    expect(p.mirrored).toBe(true);
  });

  it('SshTarget / Discoverer / Transport are usable shapes', () => {
    const t: SshTarget = { host: 'h', user: 'u', port: 22, keyPath: '/k' };
    const d: Discoverer = { discover: async () => [] };
    const tr: Transport = { open: () => ({ stop() {} }) };
    expect(t.port).toBe(22);
    expect(tr.open({ localPort: 1, remotePort: 1 }, () => {})).toBeTruthy();
    return d.discover();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- services/types`
Expected: FAIL — cannot resolve `../../src/services/types.ts`.

- [ ] **Step 3: Create `types.ts`**

```ts
// packages/cli/src/services/types.ts
import type { TunnelHandle } from '../lib/reverse-tunnel.ts';

export type ServiceKind = 'docker' | 'dart-vm' | 'dart-server' | 'generic';
export type ProjectionStatus = 'binding' | 'active' | 'reconnecting' | 'stale' | 'failed';

export interface DiscoveredService {
  /** Stable across discovery runs: derived from kind + identity + localPort. */
  id: string;
  label: string;
  kind: ServiceKind;
  localPort: number;
  /** References 127.0.0.1 only; never carries credentials. */
  connectionHint: string;
  meta?: Record<string, string>;
}

export interface Projection {
  service: DiscoveredService;
  remotePort: number;
  mirrored: boolean;
  status: ProjectionStatus;
}

export interface SshTarget {
  host: string;
  user: string;
  port: number;
  keyPath: string;
}

export interface Discoverer {
  discover(): Promise<DiscoveredService[]>;
}

export interface Transport {
  /** Open a reverse tunnel; `onClose(code)` fires when ssh exits (null = killed). */
  open(o: { localPort: number; remotePort: number }, onClose: (code: number | null) => void): TunnelHandle;
}

export interface ServiceProjectionManager {
  bind(service: DiscoveredService): Promise<Projection>;
  unbind(id: string): Promise<void>;
  status(): Projection[];
  on(event: 'change', cb: (projections: Projection[]) => void): void;
  stopAll(): void;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- services/types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/services/types.ts packages/cli/test/services/types.test.ts
git commit -m "feat(cli): add service-projection shared types"
```

---

## Task 3: DockerDiscoverer

**Files:**
- Create: `packages/cli/src/services/discoverers/docker.ts`
- Test: `packages/cli/test/services/discoverers/docker.test.ts`

`docker ps --format '{{json .}}'` prints one JSON object per line. Relevant fields: `Names`, `Image`, `Ports` (e.g. `"0.0.0.0:5432->5432/tcp, :::5432->5432/tcp"`). We parse the first published host port and infer kind from the image.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/services/discoverers/docker.test.ts
import { describe, it, expect } from 'vitest';
import { parseDockerPs, makeDockerDiscoverer } from '../../../src/services/discoverers/docker.ts';

const PG_LINE = JSON.stringify({ Names: 'pw-db', Image: 'postgres:16', Ports: '0.0.0.0:5432->5432/tcp, :::5432->5432/tcp' });
const REDIS_LINE = JSON.stringify({ Names: 'cache', Image: 'redis:7', Ports: '0.0.0.0:6379->6379/tcp' });
const NOPORT_LINE = JSON.stringify({ Names: 'worker', Image: 'busybox', Ports: '' });

describe('parseDockerPs', () => {
  it('maps a postgres container to a docker service with the published port + hint', () => {
    const [svc] = parseDockerPs(PG_LINE);
    expect(svc).toMatchObject({
      kind: 'docker', localPort: 5432, label: 'Postgres (pw-db)',
      connectionHint: 'postgres://127.0.0.1:5432',
    });
    expect(svc.id).toBe('docker:pw-db:5432');
  });

  it('infers redis hint and skips containers with no published port', () => {
    const out = parseDockerPs([REDIS_LINE, NOPORT_LINE].join('\n'));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ localPort: 6379, connectionHint: 'redis://127.0.0.1:6379' });
  });

  it('returns [] for empty output', () => {
    expect(parseDockerPs('')).toEqual([]);
  });
});

describe('makeDockerDiscoverer', () => {
  it('returns [] when the docker command fails (daemon down)', async () => {
    const d = makeDockerDiscoverer(async () => { throw new Error('Cannot connect to the Docker daemon'); });
    expect(await d.discover()).toEqual([]);
  });

  it('parses the runner output when docker is up', async () => {
    const d = makeDockerDiscoverer(async () => PG_LINE);
    const out = await d.discover();
    expect(out[0].localPort).toBe(5432);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- services/discoverers/docker`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `docker.ts`**

```ts
// packages/cli/src/services/discoverers/docker.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Discoverer, DiscoveredService } from '../types.ts';

const pexec = promisify(execFile);

interface DockerInfo { kind: string; label: string; scheme: string }

/** Map a Docker image (name[:tag]) to a known service kind + connection scheme. */
function classify(image: string): DockerInfo {
  const base = image.split(':')[0].split('/').pop() ?? image;
  switch (base) {
    case 'postgres': return { kind: 'postgres', label: 'Postgres', scheme: 'postgres' };
    case 'mysql':
    case 'mariadb': return { kind: 'mysql', label: 'MySQL', scheme: 'mysql' };
    case 'redis': return { kind: 'redis', label: 'Redis', scheme: 'redis' };
    case 'mongo': return { kind: 'mongo', label: 'MongoDB', scheme: 'mongodb' };
    default: return { kind: 'generic', label: base, scheme: 'tcp' };
  }
}

/** First published host port from a docker Ports string, or null. */
function firstHostPort(ports: string): number | null {
  // e.g. "0.0.0.0:5432->5432/tcp, :::5432->5432/tcp"
  const m = ports.match(/:(\d+)->/);
  return m ? Number(m[1]) : null;
}

/** Parse `docker ps --format '{{json .}}'` (one JSON object per line). */
export function parseDockerPs(stdout: string): DiscoveredService[] {
  const out: DiscoveredService[] = [];
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let row: { Names?: string; Image?: string; Ports?: string };
    try { row = JSON.parse(t); } catch { continue; }
    const port = firstHostPort(row.Ports ?? '');
    if (port == null) continue;
    const name = row.Names ?? 'container';
    const info = classify(row.Image ?? '');
    out.push({
      id: `docker:${name}:${port}`,
      label: `${info.label} (${name})`,
      kind: 'docker',
      localPort: port,
      connectionHint: `${info.scheme}://127.0.0.1:${port}`,
      meta: { image: row.Image ?? '', container: name },
    });
  }
  return out;
}

export type DockerRunner = () => Promise<string>;

const defaultRunner: DockerRunner = async () => {
  const { stdout } = await pexec('docker', ['ps', '--format', '{{json .}}']);
  return stdout;
};

/** Discoverer that returns [] if Docker is unavailable (never throws). */
export function makeDockerDiscoverer(runner: DockerRunner = defaultRunner): Discoverer {
  return {
    async discover() {
      try { return parseDockerPs(await runner()); }
      catch { return []; }
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- services/discoverers/docker`
Expected: PASS (all 5 assertions).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/services/discoverers/docker.ts packages/cli/test/services/discoverers/docker.test.ts
git commit -m "feat(cli): docker discoverer parses docker ps into services"
```

---

## Task 4: DartDiscoverer

**Files:**
- Create: `packages/cli/src/services/discoverers/dart.ts`
- Test: `packages/cli/test/services/discoverers/dart.test.ts`

The dev provides the lines printed by `flutter run` (captured by the caller). We extract the Dart VM Service from a printed URI (reusing `parseVmServiceUri`) and the dev-server URL if present. This keeps discovery a pure function over text the caller already has.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/services/discoverers/dart.test.ts
import { describe, it, expect } from 'vitest';
import { parseDartOutput } from '../../../src/services/discoverers/dart.ts';

const VM = 'A Dart VM Service on macOS is available at: http://127.0.0.1:50123/abc123=/';
const WEB = 'lib/main.dart is being served at http://127.0.0.1:8080';

describe('parseDartOutput', () => {
  it('extracts the Dart VM Service port as a dart-vm service', () => {
    const out = parseDartOutput(VM);
    const vm = out.find((s) => s.kind === 'dart-vm')!;
    expect(vm.localPort).toBe(50123);
    expect(vm.connectionHint).toBe('http://127.0.0.1:50123');
    expect(vm.id).toBe('dart-vm:50123');
  });

  it('extracts a dev-server port as a dart-server service', () => {
    const out = parseDartOutput([VM, WEB].join('\n'));
    const web = out.find((s) => s.kind === 'dart-server')!;
    expect(web.localPort).toBe(8080);
    expect(web.connectionHint).toBe('http://127.0.0.1:8080');
  });

  it('ignores non-loopback hosts (SSRF guard) and returns [] for noise', () => {
    expect(parseDartOutput('A Dart VM Service is available at: http://10.0.0.5:50123/t=/')).toEqual([]);
    expect(parseDartOutput('nothing here')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- services/discoverers/dart`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `dart.ts`**

```ts
// packages/cli/src/services/discoverers/dart.ts
import { parseVmServiceUri, isLoopbackHost } from '../../lib/flutter-vmservice.ts';
import type { DiscoveredService } from '../types.ts';

/** Parse captured `flutter run` output into Dart VM + dev-server services. */
export function parseDartOutput(text: string): DiscoveredService[] {
  const out: DiscoveredService[] = [];

  const vmMatch = text.match(/Dart VM Service[^]*?(https?:\/\/\S+)/);
  if (vmMatch) {
    const parsed = parseVmServiceUri(vmMatch[1]);
    if (parsed.ok && isLoopbackHost(parsed.value.host)) {
      const port = parsed.value.port;
      out.push({
        id: `dart-vm:${port}`,
        label: `Dart VM Service :${port}`,
        kind: 'dart-vm',
        localPort: port,
        connectionHint: `http://127.0.0.1:${port}`,
        meta: { authPath: parsed.value.authPath },
      });
    }
  }

  const webMatch = text.match(/served at (https?:\/\/\S+)/);
  if (webMatch) {
    try {
      const u = new URL(webMatch[1]);
      if (isLoopbackHost(u.hostname) && u.port) {
        const port = Number(u.port);
        out.push({
          id: `dart-server:${port}`,
          label: `Dart dev server :${port}`,
          kind: 'dart-server',
          localPort: port,
          connectionHint: `http://127.0.0.1:${port}`,
        });
      }
    } catch { /* ignore unparsable */ }
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- services/discoverers/dart`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/services/discoverers/dart.ts packages/cli/test/services/discoverers/dart.test.ts
git commit -m "feat(cli): dart discoverer extracts VM service + dev server"
```

---

## Task 5: Same-port mirror logic

**Files:**
- Create: `packages/cli/src/services/mirror.ts`
- Test: `packages/cli/test/services/mirror.test.ts`

`candidateRemotePorts` is pure: try the local port first, then deterministic fallbacks. `firstStablePort` opens each candidate via the `Transport` and keeps the first whose tunnel stays up past a short probe window (a quick `onClose` with a non-zero code means the remote port was taken — `ExitOnForwardFailure`).

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/services/mirror.test.ts
import { describe, it, expect, vi } from 'vitest';
import { candidateRemotePorts, firstStablePort } from '../../src/services/mirror.ts';
import type { Transport, TunnelHandle } from '../../src/services/types.ts';

describe('candidateRemotePorts', () => {
  it('puts the local port first, then distinct fallbacks', () => {
    const c = candidateRemotePorts(5432, 3);
    expect(c[0]).toBe(5432);
    expect(c).toHaveLength(3);
    expect(new Set(c).size).toBe(3);
  });
});

describe('firstStablePort', () => {
  const noWait = async () => {};

  it('mirrors the local port when its tunnel stays open', async () => {
    const open = vi.fn((_o, _cb) => ({ stop: vi.fn() }) as TunnelHandle);
    const transport: Transport = { open };
    const r = await firstStablePort(transport, 5432, { probe: noWait });
    expect(r).toMatchObject({ remotePort: 5432, mirrored: true });
  });

  it('falls back to the next candidate when the first port is taken', async () => {
    const transport: Transport = {
      open: vi.fn((o, cb) => {
        if (o.remotePort === 5432) queueMicrotask(() => cb(255)); // ExitOnForwardFailure
        return { stop: vi.fn() } as TunnelHandle;
      }),
    };
    const r = await firstStablePort(transport, 5432, { probe: noWait });
    expect(r.remotePort).not.toBe(5432);
    expect(r.mirrored).toBe(false);
  });

  it('throws when every candidate is taken', async () => {
    const transport: Transport = { open: (o, cb) => { queueMicrotask(() => cb(255)); return { stop: () => {} }; } };
    await expect(firstStablePort(transport, 5432, { probe: noWait, candidates: 2 })).rejects.toThrow(/no free remote port/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- services/mirror`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `mirror.ts`**

```ts
// packages/cli/src/services/mirror.ts
import type { Transport, TunnelHandle } from './types.ts';

/** Try the local port first, then deterministic fallbacks in the 49200+ range. */
export function candidateRemotePorts(localPort: number, count = 5): number[] {
  const out = [localPort];
  let p = 49200;
  while (out.length < count) {
    if (p !== localPort) out.push(p);
    p++;
  }
  return out;
}

export interface StableResult {
  handle: TunnelHandle;
  remotePort: number;
  mirrored: boolean;
}

interface FirstStableOpts {
  /** Resolves after the probe window; lets the test inject a no-op wait. */
  probe?: () => Promise<void>;
  candidates?: number;
}

const realProbe = () => new Promise<void>((r) => setTimeout(r, 400));

/**
 * Open candidate remote ports until one tunnel stays up past the probe window.
 * A non-zero `onClose` during the window means the remote port was taken.
 */
export async function firstStablePort(
  transport: Transport,
  localPort: number,
  opts: FirstStableOpts = {},
): Promise<StableResult> {
  const probe = opts.probe ?? realProbe;
  const ports = candidateRemotePorts(localPort, opts.candidates ?? 5);
  for (const remotePort of ports) {
    let closedCode: number | null | undefined;
    const handle = transport.open({ localPort, remotePort }, (code) => { closedCode = code; });
    await probe();
    if (closedCode === undefined) {
      return { handle, remotePort, mirrored: remotePort === localPort };
    }
    handle.stop();
  }
  throw new Error(`no free remote port for local ${localPort}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- services/mirror`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/services/mirror.ts packages/cli/test/services/mirror.test.ts
git commit -m "feat(cli): same-port mirroring with free-port fallback"
```

---

## Task 6: SSH transport

**Files:**
- Create: `packages/cli/src/services/transport-ssh.ts`
- Test: `packages/cli/test/services/transport-ssh.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/services/transport-ssh.test.ts
import { describe, it, expect, vi } from 'vitest';
import { makeSshTransport } from '../../src/services/transport-ssh.ts';

const target = { host: 'h', user: 'u', port: 22, keyPath: '/k' };

describe('makeSshTransport', () => {
  it('opens a reverse tunnel for the requested local/remote ports', () => {
    const kill = vi.fn();
    const spawnAdapter = vi.fn().mockReturnValue({ kill, on: vi.fn() });
    const t = makeSshTransport(target, spawnAdapter);
    const handle = t.open({ localPort: 5432, remotePort: 5432 }, () => {});
    expect(spawnAdapter).toHaveBeenCalledWith('ssh', expect.arrayContaining(['-R', '127.0.0.1:5432:127.0.0.1:5432']));
    handle.stop();
    expect(kill).toHaveBeenCalled();
  });

  it('forwards the ssh exit code to onClose', () => {
    let cb: ((c: number | null) => void) | undefined;
    const spawnAdapter = () => ({ kill: vi.fn(), on: (e: string, f: (c: number | null) => void) => { if (e === 'close') cb = f; } });
    const onClose = vi.fn();
    makeSshTransport(target, spawnAdapter as never).open({ localPort: 1, remotePort: 2 }, onClose);
    cb?.(255);
    expect(onClose).toHaveBeenCalledWith(255);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- services/transport-ssh`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `transport-ssh.ts`**

```ts
// packages/cli/src/services/transport-ssh.ts
import { openReverseTunnel, type TunnelSpawn } from '../lib/reverse-tunnel.ts';
import type { SshTarget, Transport } from './types.ts';

/** A Transport that carries each service over a `ssh -R` reverse tunnel. */
export function makeSshTransport(target: SshTarget, spawnAdapter?: TunnelSpawn): Transport {
  return {
    open(o, onClose) {
      return openReverseTunnel(
        { ...target, remotePort: o.remotePort, localPort: o.localPort },
        spawnAdapter,
        onClose,
      );
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- services/transport-ssh`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/services/transport-ssh.ts packages/cli/test/services/transport-ssh.test.ts
git commit -m "feat(cli): ssh reverse-tunnel transport for service projection"
```

---

## Task 7: ServiceProjection manager

**Files:**
- Create: `packages/cli/src/services/manager.ts`
- Test: `packages/cli/test/services/manager.test.ts`

The manager binds via `firstStablePort`, tracks projections, emits `change`, and supervises each tunnel: on an unexpected close it sets status `reconnecting`, waits a backoff (injected `delay`), and re-opens the same `remotePort`. `unbind`/`stopAll` mark intent so a close after stop does not trigger reconnect.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/services/manager.test.ts
import { describe, it, expect, vi } from 'vitest';
import { makeManager } from '../../src/services/manager.ts';
import type { Transport, DiscoveredService } from '../../src/services/types.ts';

const svc: DiscoveredService = {
  id: 'docker:pw-db:5432', label: 'Postgres (pw-db)', kind: 'docker',
  localPort: 5432, connectionHint: 'postgres://127.0.0.1:5432',
};

function upTransport(): { transport: Transport; closes: ((c: number | null) => void)[] } {
  const closes: ((c: number | null) => void)[] = [];
  const transport: Transport = { open: (_o, cb) => { closes.push(cb); return { stop: vi.fn() }; } };
  return { transport, closes };
}

describe('makeManager', () => {
  const noWait = { probe: async () => {}, delay: async () => {} };

  it('binds a service and reports it active with same-port mirror', async () => {
    const { transport } = upTransport();
    const m = makeManager(transport, noWait);
    const p = await m.bind(svc);
    expect(p).toMatchObject({ remotePort: 5432, mirrored: true, status: 'active' });
    expect(m.status()).toHaveLength(1);
  });

  it('emits change on bind and unbind', async () => {
    const { transport } = upTransport();
    const m = makeManager(transport, noWait);
    const seen: number[] = [];
    m.on('change', (ps) => seen.push(ps.length));
    await m.bind(svc);
    await m.unbind(svc.id);
    expect(seen).toContain(1);
    expect(m.status()).toHaveLength(0);
  });

  it('reconnects when a tunnel closes unexpectedly', async () => {
    const { transport, closes } = upTransport();
    const openSpy = vi.spyOn(transport, 'open');
    const m = makeManager(transport, noWait);
    await m.bind(svc);
    const callsBefore = openSpy.mock.calls.length;
    closes[closes.length - 1](255); // simulate ssh drop
    await new Promise((r) => setTimeout(r, 0));
    expect(m.status()[0].status).toBe('active');
    expect(openSpy.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  it('does not reconnect after unbind', async () => {
    const { transport, closes } = upTransport();
    const m = makeManager(transport, noWait);
    await m.bind(svc);
    const openSpy = vi.spyOn(transport, 'open');
    await m.unbind(svc.id);
    closes[closes.length - 1](0);
    await new Promise((r) => setTimeout(r, 0));
    expect(openSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- services/manager`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `manager.ts`**

```ts
// packages/cli/src/services/manager.ts
import { firstStablePort } from './mirror.ts';
import type {
  DiscoveredService, Projection, ServiceProjectionManager, Transport, TunnelHandle,
} from './types.ts';

interface ManagerDeps {
  /** Probe window passed to firstStablePort (injectable for tests). */
  probe?: () => Promise<void>;
  /** Backoff before a reconnect attempt (injectable for tests). */
  delay?: () => Promise<void>;
}

interface Entry {
  projection: Projection;
  handle: TunnelHandle;
  stopped: boolean;
}

export function makeManager(transport: Transport, deps: ManagerDeps = {}): ServiceProjectionManager {
  const entries = new Map<string, Entry>();
  const listeners: ((p: Projection[]) => void)[] = [];
  const delay = deps.delay ?? (() => new Promise<void>((r) => setTimeout(r, 1000)));

  const snapshot = () => [...entries.values()].map((e) => e.projection);
  const emit = () => { const s = snapshot(); for (const l of listeners) l(s); };

  function supervise(entry: Entry, onClose: (code: number | null) => void) {
    // Re-open the SAME remote port, wiring the same close handler back in.
    entry.handle = transport.open(
      { localPort: entry.projection.service.localPort, remotePort: entry.projection.remotePort },
      onClose,
    );
  }

  function makeOnClose(entry: Entry): (code: number | null) => void {
    const onClose = async () => {
      if (entry.stopped) return;
      entry.projection.status = 'reconnecting';
      emit();
      await delay();
      if (entry.stopped) return;
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
      const entry: Entry = { projection, handle, stopped: false };
      entries.set(service.id, entry);

      // Replace the throwaway probe handle's close wiring with supervision.
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

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- services/manager`
Expected: PASS (all 4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/services/manager.ts packages/cli/test/services/manager.test.ts
git commit -m "feat(cli): service-projection manager with supervised reconnect"
```

---

## Task 8: Manifest writer/reader

**Files:**
- Create: `packages/cli/src/services/manifest.ts`
- Test: `packages/cli/test/services/manifest.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/services/manifest.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeManifest, readManifest, manifestPath } from '../../src/services/manifest.ts';
import type { Projection } from '../../src/services/types.ts';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pw-manifest-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const proj: Projection = {
  service: { id: 'docker:pw-db:5432', label: 'Postgres (pw-db)', kind: 'docker', localPort: 5432, connectionHint: 'postgres://127.0.0.1:5432' },
  remotePort: 5432, mirrored: true, status: 'active',
};

describe('manifest', () => {
  it('writes services.json under .patchwire and reads it back', () => {
    const p = writeManifest(dir, [proj]);
    expect(p).toBe(manifestPath(dir));
    const back = readManifest(dir);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ id: 'docker:pw-db:5432', remotePort: 5432, host: '127.0.0.1', mirrored: true });
  });

  it('writes the file 0o600', () => {
    writeManifest(dir, [proj]);
    const mode = statSync(manifestPath(dir)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('returns [] when no manifest exists', () => {
    expect(readManifest(dir)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- services/manifest`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `manifest.ts`**

```ts
// packages/cli/src/services/manifest.ts
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Projection } from './types.ts';

export interface ManifestEntry {
  id: string;
  label: string;
  kind: string;
  host: '127.0.0.1';
  remotePort: number;
  localPort: number;
  connectionHint: string;
  mirrored: boolean;
  status: string;
}

export function manifestPath(projectDir: string): string {
  return join(projectDir, '.patchwire', 'services.json');
}

function toEntry(p: Projection): ManifestEntry {
  return {
    id: p.service.id,
    label: p.service.label,
    kind: p.service.kind,
    host: '127.0.0.1',
    remotePort: p.remotePort,
    localPort: p.service.localPort,
    connectionHint: p.service.connectionHint,
    mirrored: p.mirrored,
    status: p.status,
  };
}

/** Write the manifest 0o600. Returns the path written. */
export function writeManifest(projectDir: string, projections: Projection[]): string {
  const dir = join(projectDir, '.patchwire');
  mkdirSync(dir, { recursive: true });
  const path = manifestPath(projectDir);
  const body = JSON.stringify({ version: 1, services: projections.map(toEntry) }, null, 2);
  writeFileSync(path, body, { mode: 0o600 });
  return path;
}

export function readManifest(projectDir: string): ManifestEntry[] {
  const path = manifestPath(projectDir);
  if (!existsSync(path)) return [];
  try {
    const o = JSON.parse(readFileSync(path, 'utf8')) as { services?: ManifestEntry[] };
    return o.services ?? [];
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- services/manifest`
Expected: PASS.

> Note: on a fresh `writeFileSync` with `mode`, the umask can clear bits; if the 0o600 assertion fails, add an explicit `chmodSync(path, 0o600)` after the write. Verify with the test, not by assumption.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/services/manifest.ts packages/cli/test/services/manifest.test.ts
git commit -m "feat(cli): services.json manifest writer/reader (0o600)"
```

---

## Task 9: MCP services registry

**Files:**
- Create: `packages/cli/src/agent/services/mcp-server.ts`
- Create: `packages/cli/src/commands/services-mcp.ts`
- Test: `packages/cli/test/agent/services/mcp-server.test.ts`

The MCP server runs on the remote and reads the synced manifest (the manager — local — is the writer). We unit-test the pure tool handlers, not the stdio transport.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/agent/services/mcp-server.test.ts
import { describe, it, expect } from 'vitest';
import { makeServiceTools } from '../../../src/agent/services/mcp-server.ts';
import type { ManifestEntry } from '../../../src/services/manifest.ts';

const entries: ManifestEntry[] = [{
  id: 'docker:pw-db:5432', label: 'Postgres (pw-db)', kind: 'docker', host: '127.0.0.1',
  remotePort: 5432, localPort: 5432, connectionHint: 'postgres://127.0.0.1:5432', mirrored: true, status: 'active',
}];

describe('makeServiceTools', () => {
  it('list_services returns the manifest entries', async () => {
    const tools = makeServiceTools(() => entries);
    const r = await tools.list_services();
    expect(r.services[0]).toMatchObject({ id: 'docker:pw-db:5432', remotePort: 5432 });
  });

  it('get_connection returns the hint for a known id', async () => {
    const tools = makeServiceTools(() => entries);
    expect(await tools.get_connection({ id: 'docker:pw-db:5432' })).toEqual({ ok: true, connectionHint: 'postgres://127.0.0.1:5432', remotePort: 5432 });
  });

  it('get_connection reports not-found for an unknown id', async () => {
    const tools = makeServiceTools(() => entries);
    expect(await tools.get_connection({ id: 'nope' })).toEqual({ ok: false, error: 'no service with id nope' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- agent/services/mcp-server`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tool factory + stdio server**

```ts
// packages/cli/src/agent/services/mcp-server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readManifest, type ManifestEntry } from '../../services/manifest.ts';

export interface ServiceTools {
  list_services(): Promise<{ services: ManifestEntry[] }>;
  get_connection(args: { id: string }): Promise<
    | { ok: true; connectionHint: string; remotePort: number }
    | { ok: false; error: string }
  >;
}

/** Pure tool handlers over a manifest source (injectable for tests). */
export function makeServiceTools(source: () => ManifestEntry[]): ServiceTools {
  return {
    async list_services() {
      return { services: source() };
    },
    async get_connection({ id }) {
      const hit = source().find((e) => e.id === id);
      if (!hit) return { ok: false, error: `no service with id ${id}` };
      return { ok: true, connectionHint: hit.connectionHint, remotePort: hit.remotePort };
    },
  };
}

/**
 * Boot a stdio MCP server named `patchwire-services`.
 * Env: PW_SERVICES_PROJECT_DIR = the remote project dir holding .patchwire/services.json.
 */
export async function runServiceMcpServer(): Promise<void> {
  const projectDir = process.env.PW_SERVICES_PROJECT_DIR ?? process.cwd();
  const tools = makeServiceTools(() => readManifest(projectDir));
  const server = new McpServer({ name: 'patchwire-services', version: '1.0.0' });

  server.tool('list_services', 'List local services projected onto this agent host', {}, async () => ({
    content: [{ type: 'text', text: JSON.stringify(await tools.list_services()) }],
  }));

  server.tool(
    'get_connection',
    'Get the loopback connection hint for a projected service id',
    { id: z.string() },
    async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify(await tools.get_connection({ id })) }] }),
  );

  await server.connect(new StdioServerTransport());
}
```

```ts
// packages/cli/src/commands/services-mcp.ts
import type { Command } from 'commander';
import { runServiceMcpServer } from '../agent/services/mcp-server.ts';

/** Hidden subcommand launched by `claude` via --mcp-config. Reads PW_SERVICES_* env. */
export function registerServicesMcpCommand(program: Command): void {
  program
    .command('services-mcp', { hidden: true })
    .description('Run the patchwire-services MCP server (stdio) backed by the services manifest')
    .action(async () => {
      await runServiceMcpServer();
    });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- agent/services/mcp-server`
Expected: PASS.

> Verify the exact `McpServer`/`server.tool(...)` signature against the existing `packages/cli/src/agent/flutter/mcp-server.ts` boot code (the SDK version is pinned at `^1.29.0`). Match whatever pattern that file uses for registering tools and connecting the transport — adjust the calls above if the installed SDK differs.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/services/mcp-server.ts packages/cli/src/commands/services-mcp.ts packages/cli/test/agent/services/mcp-server.test.ts
git commit -m "feat(cli): patchwire-services MCP registry over the manifest"
```

---

## Task 10: `patchwire services` CLI command

**Files:**
- Create: `packages/cli/src/commands/services.ts`
- Modify: `packages/cli/src/cli.ts` (register `services` + `services-mcp`)
- Test: `packages/cli/test/commands/services.test.ts`

The command composes the pieces: read the SSH target from `patchwire.yml`, run discoverers, and drive the manager. We unit-test the pure `aggregateDiscovered` helper (merging discoverer outputs) and the `renderStatus` formatter; the `action` wiring is thin glue verified by typecheck + the integration task.

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/test/commands/services.test.ts
import { describe, it, expect } from 'vitest';
import { aggregateDiscovered, renderStatus } from '../../src/commands/services.ts';
import type { DiscoveredService, Projection } from '../../src/services/types.ts';

const a: DiscoveredService = { id: 'docker:pw-db:5432', label: 'Postgres', kind: 'docker', localPort: 5432, connectionHint: 'postgres://127.0.0.1:5432' };
const b: DiscoveredService = { id: 'dart-vm:50123', label: 'Dart VM Service :50123', kind: 'dart-vm', localPort: 50123, connectionHint: 'http://127.0.0.1:50123' };

describe('aggregateDiscovered', () => {
  it('merges discoverer outputs and de-dupes by id', () => {
    const out = aggregateDiscovered([[a, b], [a]]);
    expect(out.map((s) => s.id).sort()).toEqual(['dart-vm:50123', 'docker:pw-db:5432']);
  });
});

describe('renderStatus', () => {
  it('renders a one-line-per-projection table', () => {
    const p: Projection = { service: a, remotePort: 5432, mirrored: true, status: 'active' };
    const text = renderStatus([p]);
    expect(text).toContain('docker:pw-db:5432');
    expect(text).toContain('5432');
    expect(text).toContain('active');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- commands/services`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `services.ts`**

```ts
// packages/cli/src/commands/services.ts
import type { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ConfigSchema } from '../lib/config.ts';
import { makeDockerDiscoverer } from '../services/discoverers/docker.ts';
import { parseDartOutput } from '../services/discoverers/dart.ts';
import { makeSshTransport } from '../services/transport-ssh.ts';
import { makeManager } from '../services/manager.ts';
import { writeManifest } from '../services/manifest.ts';
import { log } from '../lib/log.ts';
import type { DiscoveredService, Projection, SshTarget } from '../services/types.ts';

/** Merge discoverer outputs, de-duping by service id. */
export function aggregateDiscovered(lists: DiscoveredService[][]): DiscoveredService[] {
  const byId = new Map<string, DiscoveredService>();
  for (const list of lists) for (const s of list) if (!byId.has(s.id)) byId.set(s.id, s);
  return [...byId.values()];
}

/** One line per projection: id  local→remote  mirrored  status. */
export function renderStatus(projections: Projection[]): string {
  if (projections.length === 0) return 'No services bound.';
  return projections
    .map((p) => `${p.service.id}\t${p.service.localPort}→${p.remotePort}\t${p.mirrored ? 'mirror' : 'remap'}\t${p.status}`)
    .join('\n');
}

/** Read host/user/port/keyPath from patchwire.yml in cwd. */
function loadSshTarget(): SshTarget {
  const raw = parseYaml(readFileSync(resolve(process.cwd(), 'patchwire.yml'), 'utf8'));
  const cfg = ConfigSchema.parse(raw);
  return { host: cfg.host, user: cfg.user, port: cfg.sshPort ?? 22, keyPath: cfg.keyPath ?? '' };
}

export function registerServicesCommand(program: Command): void {
  const cmd = program.command('services').description('Project local services (DBs, Dart servers) onto the remote agent');

  cmd
    .command('discover')
    .description('List local Docker/Dart services that can be projected')
    .action(async () => {
      const docker = await makeDockerDiscoverer().discover();
      const dart = parseDartOutput(process.env.PW_DART_OUTPUT ?? '');
      const all = aggregateDiscovered([docker, dart]);
      for (const s of all) log(`${s.id}\t${s.label}\t${s.connectionHint}`);
      if (all.length === 0) log('No services discovered.');
    });

  cmd
    .command('bind <idOrPort>')
    .description('Bind one discovered service onto the remote loopback')
    .action(async (idOrPort: string) => {
      const docker = await makeDockerDiscoverer().discover();
      const dart = parseDartOutput(process.env.PW_DART_OUTPUT ?? '');
      const all = aggregateDiscovered([docker, dart]);
      const svc = all.find((s) => s.id === idOrPort || String(s.localPort) === idOrPort);
      if (!svc) { log(`No discovered service matches "${idOrPort}".`); process.exitCode = 1; return; }

      const manager = makeManager(makeSshTransport(loadSshTarget()));
      manager.on('change', (ps) => writeManifest(process.cwd(), ps));
      const p = await manager.bind(svc);
      log(`Bound ${p.service.label}: 127.0.0.1:${p.remotePort} on remote (${p.mirrored ? 'mirrored' : 'remapped'}).`);
      log(renderStatus(manager.status()));
    });
}
```

- [ ] **Step 4: Register in `cli.ts`**

Add imports near the other command imports:

```ts
import { registerServicesCommand } from './commands/services.ts';
import { registerServicesMcpCommand } from './commands/services-mcp.ts';
```

After the existing `registerFlutterMcpCommand(program);` call (search for it near the bottom of `cli.ts` where commands are registered), add:

```ts
registerServicesCommand(program);
registerServicesMcpCommand(program);
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @rebink/patchwire test -- commands/services && pnpm --filter @rebink/patchwire typecheck`
Expected: PASS — unit tests green, typecheck clean.

> If `ConfigSchema` field names differ (e.g. `sshPort` vs `port`, `keyPath` presence), open `packages/cli/src/lib/config.ts` and map the real field names in `loadSshTarget`. Verify with `pnpm typecheck`.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/services.ts packages/cli/src/cli.ts packages/cli/test/commands/services.test.ts
git commit -m "feat(cli): patchwire services discover/bind command"
```

---

## Task 11: Full-suite green + manual E2E doc

**Files:**
- Modify: `packages/cli/test/` (no new code — verification gate)
- Create: `docs/superpowers/plans/2026-06-19-service-projection-e2e.md` (manual runbook)

- [ ] **Step 1: Run the full CLI suite + build**

Run: `pnpm --filter @rebink/patchwire test && pnpm --filter @rebink/patchwire typecheck && pnpm --filter @rebink/patchwire build`
Expected: all tests PASS, typecheck clean, build succeeds. The pre-existing `flutter-tunnel.test.ts` must still pass (Task 1 re-export).

- [ ] **Step 2: Write the manual E2E runbook**

```markdown
# Service Projection — Manual E2E Runbook

Prereqs: a provisioned remote agent host reachable via `patchwire.yml`; Docker running locally with a Postgres container published on :5432.

1. `docker run --rm -e POSTGRES_PASSWORD=pw -p 5432:5432 -d postgres:16`
2. `pnpm --filter @rebink/patchwire dev:cli services discover`
   - Expect a line: `docker:...:5432   Postgres (...)   postgres://127.0.0.1:5432`
3. `pnpm --filter @rebink/patchwire dev:cli services bind 5432`
   - Expect: `Bound Postgres ...: 127.0.0.1:5432 on remote (mirrored).`
4. On the remote host: `psql postgres://postgres:pw@127.0.0.1:5432 -c 'select 1'`
   - Expect: `1` — the tunnel carried the query back to the laptop's Postgres.
5. Inspect the manifest: `cat .patchwire/services.json` → one `services[]` entry, host `127.0.0.1`, `mirrored: true`.
6. Kill the local ssh tunnel process; confirm the manager logs `reconnecting` then `active` (auto-heal).
7. Port-conflict check: occupy remote `127.0.0.1:5432`, re-bind, expect `(remapped)` + a non-5432 `remotePort` in the manifest.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-06-19-service-projection-e2e.md
git commit -m "docs: service-projection manual E2E runbook + full-suite gate"
```

---

## Self-Review Notes

- **Spec coverage:** discovery (Tasks 3–4), confirm-before-bind (CLI `bind` is explicit, Task 10), reverse tunnel loopback-only (Tasks 1, 6), same-port mirror (Task 5), MCP registry (Task 9), manifest fallback (Task 8), supervised auto-heal (Task 7), security 0o600 + loopback (Tasks 1, 8), CLI surface (Task 10), real E2E (Task 11). All P1 spec sections map to a task.
- **Workspace lifecycle** (open→bind / leave→unbind) is realized by the P2 desktop UI; P1 exposes the `bind`/`unbind`/`stopAll` primitives the UI will call. Documented as roadmap in the spec — not a P1 gap.
- **Type consistency:** `DiscoveredService`, `Projection`, `SshTarget`, `Transport`, `TunnelHandle`, `ManifestEntry` are defined once (Tasks 2, 8) and imported everywhere; `firstStablePort`, `makeManager`, `makeSshTransport`, `makeDockerDiscoverer`, `parseDartOutput`, `makeServiceTools`, `aggregateDiscovered`, `renderStatus` names are used consistently across tasks.
- **Verification flags:** Tasks 8/9/10 carry explicit "verify against the installed SDK / real config field names / umask" notes rather than assuming — the engineer confirms with `typecheck`/tests, not guesswork.
