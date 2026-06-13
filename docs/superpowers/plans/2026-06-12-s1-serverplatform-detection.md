# S1 — ServerPlatform Capability Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the agent-side `ServerPlatform` capability model and a dependency-injected `detectServerPlatform()` that maps an OS + tool probes into a typed `ServerCapabilities` object (capability descriptors), with the macOS implementation real and Linux/Windows reporting descriptors (their behavior impls deferred to S2/S3).

**Architecture:** A new `packages/cli/src/agent/server-platform/` module. Detection is a pure function over an injected `DetectDeps` seam (platform/arch/`has(cmd)`), so it is fully unit-testable with no real OS probing; a thin `nodeDetectDeps()` adapter does the real PATH probing. This is the seam every `darwin`-gated agent behavior (egress, keychain, launchd) will later route through, per the Agent & Protocol spec.

**Tech Stack:** TypeScript, vitest (CLI package `@rebink/patchwire`, tests under `packages/cli/test/`).

**Spec:** `docs/specs/2026-06-12-agent-protocol-spec.md` (Pillar 1 — ServerPlatform; note `filesystemIsolation` capability added per the Projection spec).

---

## File structure

- Create: `packages/cli/src/agent/server-platform/types.ts` — `OsKind`, `CapabilityDescriptor`, `ServerCapabilities`, `DetectedServerPlatform`, `DetectDeps`.
- Create: `packages/cli/src/agent/server-platform/detect.ts` — pure `detectServerPlatform(deps)`.
- Create: `packages/cli/src/agent/server-platform/node-detect.ts` — real `nodeDetectDeps()` + `detectNodeServerPlatform()`.
- Test: `packages/cli/test/agent/server-platform/detect.test.ts`.

---

### Task 1: Capability types

**Files:** Create `packages/cli/src/agent/server-platform/types.ts`

- [ ] **Step 1: Write the file**

```ts
export type OsKind = 'macos' | 'linux' | 'windows';

/** A capability is described by its implementation type + version, not just a string. */
export interface CapabilityDescriptor {
  /** Implementation, e.g. 'seatbelt' | 'nftables' | 'keychain' | 'launchd' | 'none'. */
  type: string;
  /** Implementation/schema version, when meaningful. */
  version?: string;
  /** True if applying this capability needs sudo/admin. */
  requiresElevation: boolean;
}

export interface ServerCapabilities {
  egress: CapabilityDescriptor;
  filesystemIsolation: CapabilityDescriptor;
  secrets: CapabilityDescriptor;
  service: CapabilityDescriptor;
  shell: CapabilityDescriptor;
  packageManager: CapabilityDescriptor;
}

export interface DetectedServerPlatform {
  os: OsKind;
  arch: string;
  pathStyle: 'posix' | 'win';
  capabilities: ServerCapabilities;
}

/** Injected probes for detectServerPlatform — keeps detection pure and testable. */
export interface DetectDeps {
  platform: NodeJS.Platform;
  arch: string;
  /** True if `cmd` is present/runnable on this host. */
  has(cmd: string): boolean;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @rebink/patchwire typecheck`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/agent/server-platform/types.ts
git commit -m "feat(agent): add ServerPlatform capability types"
```

---

### Task 2: detectServerPlatform — macOS + fail-closed (TDD)

**Files:** Create `packages/cli/src/agent/server-platform/detect.ts`; Test `packages/cli/test/agent/server-platform/detect.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { detectServerPlatform } from '../../../src/agent/server-platform/detect.ts';
import type { DetectDeps } from '../../../src/agent/server-platform/types.ts';

function deps(platform: NodeJS.Platform, arch: string, present: string[]): DetectDeps {
  const set = new Set(present);
  return { platform, arch, has: (c) => set.has(c) };
}

describe('detectServerPlatform — macOS', () => {
  it('maps a full macOS host to real capabilities', () => {
    const d = detectServerPlatform(deps('darwin', 'arm64', ['sandbox-exec', 'launchctl', 'brew', 'zsh']));
    expect(d.os).toBe('macos');
    expect(d.arch).toBe('arm64');
    expect(d.pathStyle).toBe('posix');
    expect(d.capabilities.egress).toEqual({ type: 'seatbelt', requiresElevation: false });
    expect(d.capabilities.filesystemIsolation).toEqual({ type: 'seatbelt', requiresElevation: false });
    expect(d.capabilities.secrets.type).toBe('keychain');
    expect(d.capabilities.service.type).toBe('launchd');
    expect(d.capabilities.shell.type).toBe('zsh');
    expect(d.capabilities.packageManager.type).toBe('brew');
  });

  it('reports egress + filesystemIsolation as none when sandbox-exec is absent (fail-closed signal)', () => {
    const d = detectServerPlatform(deps('darwin', 'x64', ['launchctl']));
    expect(d.capabilities.egress.type).toBe('none');
    expect(d.capabilities.filesystemIsolation.type).toBe('none');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- server-platform`
Expected: FAIL — `detect.ts` not found.

- [ ] **Step 3: Write the implementation**

```ts
import type {
  DetectDeps,
  DetectedServerPlatform,
  OsKind,
  CapabilityDescriptor,
  ServerCapabilities,
} from './types.ts';

function osKind(platform: NodeJS.Platform): OsKind {
  if (platform === 'darwin') return 'macos';
  if (platform === 'win32') return 'windows';
  return 'linux'; // other unixes are treated as linux-like for capability purposes
}

const NONE: CapabilityDescriptor = { type: 'none', requiresElevation: false };

/** Map an OS + tool probes into a typed capability set. Pure. */
export function detectServerPlatform(deps: DetectDeps): DetectedServerPlatform {
  const os = osKind(deps.platform);
  const win = os === 'windows';
  const seatbelt = os === 'macos' && deps.has('sandbox-exec');

  const egress: CapabilityDescriptor = seatbelt
    ? { type: 'seatbelt', requiresElevation: false }
    : os === 'linux' && deps.has('nft')
      ? { type: 'nftables', requiresElevation: true }
      : NONE;

  // Filesystem isolation reuses seatbelt on macOS; Linux namespaces / Windows impls are S2/S3.
  const filesystemIsolation: CapabilityDescriptor = seatbelt
    ? { type: 'seatbelt', requiresElevation: false }
    : NONE;

  const secrets: CapabilityDescriptor =
    os === 'macos'
      ? { type: 'keychain', requiresElevation: false }
      : win
        ? { type: 'dpapi', requiresElevation: false }
        : deps.has('secret-tool')
          ? { type: 'libsecret', requiresElevation: false }
          : { type: 'file', requiresElevation: false };

  const service: CapabilityDescriptor =
    os === 'macos' && deps.has('launchctl')
      ? { type: 'launchd', requiresElevation: false }
      : os === 'linux' && deps.has('systemctl')
        ? { type: 'systemd-user', requiresElevation: false }
        : win && deps.has('sc')
          ? { type: 'windows-service', requiresElevation: true }
          : NONE;

  const shell: CapabilityDescriptor = win
    ? { type: 'pwsh', requiresElevation: false }
    : deps.has('zsh')
      ? { type: 'zsh', requiresElevation: false }
      : { type: 'bash', requiresElevation: false };

  const packageManager: CapabilityDescriptor = deps.has('brew')
    ? { type: 'brew', requiresElevation: false }
    : deps.has('apt-get')
      ? { type: 'apt', requiresElevation: true }
      : win && deps.has('winget')
        ? { type: 'winget', requiresElevation: false }
        : { type: 'manual', requiresElevation: false };

  const capabilities: ServerCapabilities = {
    egress,
    filesystemIsolation,
    secrets,
    service,
    shell,
    packageManager,
  };

  return { os, arch: deps.arch, pathStyle: win ? 'win' : 'posix', capabilities };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- server-platform`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/server-platform/detect.ts packages/cli/test/agent/server-platform/detect.test.ts
git commit -m "feat(agent): detectServerPlatform maps macOS host to capabilities"
```

---

### Task 3: detection for Linux + Windows (TDD)

**Files:** Test `packages/cli/test/agent/server-platform/detect.test.ts` (append)

- [ ] **Step 1: Append failing tests**

```ts
describe('detectServerPlatform — Linux', () => {
  it('maps nftables egress (needs elevation), systemd, apt, bash', () => {
    const d = detectServerPlatform(deps('linux', 'x64', ['nft', 'systemctl', 'apt-get']));
    expect(d.os).toBe('linux');
    expect(d.pathStyle).toBe('posix');
    expect(d.capabilities.egress).toEqual({ type: 'nftables', requiresElevation: true });
    expect(d.capabilities.filesystemIsolation.type).toBe('none'); // namespaces deferred to S2
    expect(d.capabilities.service.type).toBe('systemd-user');
    expect(d.capabilities.packageManager).toEqual({ type: 'apt', requiresElevation: true });
    expect(d.capabilities.secrets.type).toBe('file');
    expect(d.capabilities.shell.type).toBe('bash');
  });
  it('uses libsecret when secret-tool is present', () => {
    const d = detectServerPlatform(deps('linux', 'x64', ['secret-tool']));
    expect(d.capabilities.secrets.type).toBe('libsecret');
  });
});

describe('detectServerPlatform — Windows', () => {
  it('maps win path style, pwsh, dpapi, windows-service, winget', () => {
    const d = detectServerPlatform(deps('win32', 'x64', ['sc', 'winget']));
    expect(d.os).toBe('windows');
    expect(d.pathStyle).toBe('win');
    expect(d.capabilities.shell.type).toBe('pwsh');
    expect(d.capabilities.secrets.type).toBe('dpapi');
    expect(d.capabilities.service).toEqual({ type: 'windows-service', requiresElevation: true });
    expect(d.capabilities.packageManager.type).toBe('winget');
    expect(d.capabilities.egress.type).toBe('none'); // WFP impl deferred to S3
    expect(d.capabilities.filesystemIsolation.type).toBe('none');
  });
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @rebink/patchwire test -- server-platform`
Expected: PASS (4 tests) — the implementation from Task 2 already covers these branches.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/test/agent/server-platform/detect.test.ts
git commit -m "test(agent): cover Linux + Windows capability detection"
```

---

### Task 4: Node adapter + convenience entry

**Files:** Create `packages/cli/src/agent/server-platform/node-detect.ts`; Test append

- [ ] **Step 1: Write the failing test (append to detect.test.ts)**

```ts
import { detectNodeServerPlatform, nodeDetectDeps } from '../../../src/agent/server-platform/node-detect.ts';

describe('node detection adapter', () => {
  it('reports this host with consistent os/arch and a full capability set', () => {
    const dd = nodeDetectDeps();
    expect(dd.arch).toBe(process.arch);
    const d = detectNodeServerPlatform();
    expect(['macos', 'linux', 'windows']).toContain(d.os);
    expect(d.arch).toBe(process.arch);
    for (const cap of Object.values(d.capabilities)) {
      expect(typeof cap.type).toBe('string');
      expect(typeof cap.requiresElevation).toBe('boolean');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- server-platform`
Expected: FAIL — `node-detect.ts` not found.

- [ ] **Step 3: Write `node-detect.ts`**

```ts
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { detectServerPlatform } from './detect.ts';
import type { DetectDeps, DetectedServerPlatform } from './types.ts';

/** True if `cmd` is on PATH (no subprocess spawned). */
function onPath(cmd: string): boolean {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) if (existsSync(join(dir, cmd + ext))) return true;
  }
  return false;
}

export function nodeDetectDeps(): DetectDeps {
  return { platform: process.platform, arch: process.arch, has: onPath };
}

/** Detect this host's ServerPlatform using real PATH probing. */
export function detectNodeServerPlatform(): DetectedServerPlatform {
  return detectServerPlatform(nodeDetectDeps());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- server-platform`
Expected: PASS (5 tests).

- [ ] **Step 5: Full verify**

Run: `pnpm --filter @rebink/patchwire typecheck && pnpm -r typecheck`
Expected: exit 0, no regressions.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/agent/server-platform/node-detect.ts packages/cli/test/agent/server-platform/detect.test.ts
git commit -m "feat(agent): add Node ServerPlatform detection adapter"
```

---

## What this slice leaves to follow-on S1 slices

- **Behavior methods** on `ServerPlatform` (serviceInstall/Start/Stop, secretsPut/Get, egressApply, sessionLaunch) — wiring the macOS impls to existing `egress.ts`/`keychain.ts`/`daemon.ts`.
- The **provisioning state machine** (detect → plan → consent → execute → verify + compensating-action rollback).
- **Protocol v2** (requestId envelope, identity.type, capability handshake, duplex WS, event taxonomy).
- **Multi-AI session model** (SessionState, worktree-per-session, archive/retention).

## Self-review notes

- **Spec coverage:** Agent spec Pillar 1 capability descriptors + detection (macOS real; Linux/Windows descriptors with behavior deferred) — covered by Tasks 1–4. `filesystemIsolation` is present per the Projection spec's cross-spec impact. Behavior methods + handshake are explicitly deferred above.
- **Type consistency:** `DetectDeps`/`DetectedServerPlatform`/`CapabilityDescriptor`/`ServerCapabilities` are identical across types.ts (Task 1), detect.ts (Task 2), and node-detect.ts (Task 4); `detectServerPlatform(deps)` signature stable.
- **Placeholder scan:** none — all code complete; `none` descriptors are intentional fail-closed signals, not placeholders.
