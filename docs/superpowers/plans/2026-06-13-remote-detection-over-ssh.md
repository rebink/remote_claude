# Remote Detection over SSH Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Detect a remote host's `ServerPlatform` (OS, arch, capabilities) over SSH, reusing the landed pure `detectServerPlatform()` — Node-independent, and honest about unsupported (Windows) remotes.

**Architecture:** A new `packages/cli/src/agent/provision/remote-detect.ts` runs one POSIX probe over SSH (`uname -sm` + `command -v` per capability tool), parses it into the existing `DetectDeps` seam, and feeds that into the pure `detectServerPlatform()`. The SSH call is behind an injected `ProbeRunner` so unit tests run with zero real SSH. Node presence is just a `has('node')` probe, never a precondition.

**Tech Stack:** TypeScript, vitest (`@rebink/patchwire`, tests under `packages/cli/test/`). Reuses `server-platform/detect.ts` and `lib/ssh-runner.ts`.

**Spec:** `docs/superpowers/specs/2026-06-13-remote-ssh-provisioning-design.md` (§1 Remote detection over SSH).

---

## File structure

- Create: `packages/cli/src/agent/provision/remote-detect.ts` — `PROBE_TOOLS`, `buildProbeScript`, `parseProbe`, `detectRemoteServerPlatform`.
- Test: `packages/cli/test/agent/provision/remote-detect.test.ts`.

Note: `runSsh` lives in `packages/cli/src/lib/ssh-runner.ts` and returns `{ code, stdout, stderr }`; its `SshOpts` is `{ host, user, port, keyPath, command }`. `DetectDeps` is `{ platform: NodeJS.Platform; arch: string; has(cmd): boolean }` and `detectServerPlatform(deps): DetectedServerPlatform` is already implemented and tested in `packages/cli/src/agent/server-platform/`.

---

### Task 1: Probe script + parser (pure, TDD)

**Files:**
- Create: `packages/cli/src/agent/provision/remote-detect.ts`
- Test: `packages/cli/test/agent/provision/remote-detect.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildProbeScript, parseProbe, PROBE_TOOLS } from '../../../src/agent/provision/remote-detect.ts';

describe('buildProbeScript', () => {
  it('emits a uname line then a command -v loop over the probe tools', () => {
    const s = buildProbeScript();
    expect(s).toMatch(/^uname -sm;/);
    expect(s).toContain('for c in node corepack pnpm');
    expect(s).toContain('command -v "$c"');
    for (const t of PROBE_TOOLS) expect(s).toContain(t);
  });
});

describe('parseProbe', () => {
  it('parses a macOS arm64 probe with present tools', () => {
    const deps = parseProbe('Darwin arm64\nhas:node\nhas:launchctl\nhas:zsh\nhas:brew');
    expect(deps).not.toBeNull();
    expect(deps!.platform).toBe('darwin');
    expect(deps!.arch).toBe('arm64');
    expect(deps!.has('launchctl')).toBe(true);
    expect(deps!.has('nft')).toBe(false);
  });

  it('maps Linux x86_64 → linux/x64 and aarch64 → arm64', () => {
    expect(parseProbe('Linux x86_64\nhas:systemctl')!.platform).toBe('linux');
    expect(parseProbe('Linux x86_64')!.arch).toBe('x64');
    expect(parseProbe('Linux aarch64')!.arch).toBe('arm64');
  });

  it('is Node-independent: absence of has:node is not a parse failure', () => {
    const deps = parseProbe('Darwin arm64\nhas:zsh');
    expect(deps).not.toBeNull();
    expect(deps!.has('node')).toBe(false);
  });

  it('returns null when the first line is not a recognized uname (e.g. Windows shell)', () => {
    expect(parseProbe("'uname' is not recognized as a command")).toBeNull();
    expect(parseProbe('')).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- remote-detect`
Expected: FAIL — `remote-detect.ts` not found.

- [ ] **Step 3: Write `packages/cli/src/agent/provision/remote-detect.ts` (script + parser only)**

```ts
import type { DetectDeps } from '../server-platform/types.ts';

/** Capability tools probed on the remote (mirrors the local detector's signals). */
export const PROBE_TOOLS = [
  'node', 'corepack', 'pnpm',
  'sandbox-exec', 'launchctl', 'systemctl', 'nft',
  'brew', 'apt-get', 'zsh', 'secret-tool',
] as const;

/** One POSIX probe: prints `<sysname> <machine>`, then `has:<tool>` for each present tool. */
export function buildProbeScript(tools: readonly string[] = PROBE_TOOLS): string {
  return `uname -sm; for c in ${tools.join(' ')}; do command -v "$c" >/dev/null 2>&1 && echo "has:$c"; done`;
}

function mapPlatform(sysname: string): NodeJS.Platform | null {
  const s = sysname.toLowerCase();
  if (s === 'darwin') return 'darwin';
  if (s === 'linux') return 'linux';
  return null; // unrecognized / non-POSIX (e.g. Windows)
}

function mapArch(machine: string): string {
  const m = machine.toLowerCase();
  if (m === 'x86_64' || m === 'amd64') return 'x64';
  if (m === 'aarch64' || m === 'arm64') return 'arm64';
  return m;
}

/** Parse POSIX probe output into DetectDeps, or null if the first line isn't a uname result. */
export function parseProbe(stdout: string): DetectDeps | null {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const parts = lines[0]!.split(/\s+/);
  const platform = mapPlatform(parts[0] ?? '');
  if (!platform) return null;
  const present = new Set(lines.filter((l) => l.startsWith('has:')).map((l) => l.slice(4)));
  return { platform, arch: mapArch(parts[1] ?? ''), has: (c) => present.has(c) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- remote-detect`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/provision/remote-detect.ts packages/cli/test/agent/provision/remote-detect.test.ts
git commit -m "feat(agent): SSH probe script + parser for remote detection"
```

---

### Task 2: detectRemoteServerPlatform orchestrator (TDD)

**Files:**
- Modify: `packages/cli/src/agent/provision/remote-detect.ts`
- Test: `packages/cli/test/agent/provision/remote-detect.test.ts`

- [ ] **Step 1: Append the failing tests**

```ts
import { detectRemoteServerPlatform } from '../../../src/agent/provision/remote-detect.ts';

const CONN = { host: 'h', user: 'u', port: 22, keyPath: '/k' };

describe('detectRemoteServerPlatform', () => {
  it('runs the probe and maps a macOS host to real capabilities', async () => {
    const runner = async () => ({ stdout: 'Darwin arm64\nhas:sandbox-exec\nhas:launchctl\nhas:zsh\nhas:brew\nhas:node', code: 0 });
    const d = await detectRemoteServerPlatform(CONN, runner);
    expect(d.os).toBe('macos');
    expect(d.arch).toBe('arm64');
    expect(d.capabilities.egress.type).toBe('seatbelt');
    expect(d.capabilities.service.type).toBe('launchd');
  });

  it('is Node-independent: a host with no node still detects fine', async () => {
    const runner = async () => ({ stdout: 'Linux x86_64\nhas:systemctl\nhas:apt-get', code: 0 });
    const d = await detectRemoteServerPlatform(CONN, runner);
    expect(d.os).toBe('linux');
    expect(d.capabilities.service.type).toBe('systemd-user');
    // (the caller treats missing node as a plan-time prerequisite, not a detection error)
  });

  it('throws an actionable error when the remote is not a recognized POSIX host', async () => {
    const runner = async () => ({ stdout: "'uname' is not recognized", code: 1 });
    await expect(detectRemoteServerPlatform(CONN, runner)).rejects.toThrow(/Windows remote provisioning is not yet supported/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- remote-detect`
Expected: FAIL — `detectRemoteServerPlatform` not exported.

- [ ] **Step 3: Extend `remote-detect.ts` with the orchestrator**

Add these imports at the top (alongside the existing `DetectDeps` import):

```ts
import type { DetectedServerPlatform } from '../server-platform/types.ts';
import { detectServerPlatform } from '../server-platform/detect.ts';
import { runSsh, type SshOpts } from '../../lib/ssh-runner.ts';
```

Append to the file:

```ts
/** SSH connection params without the per-call `command`. */
export type RemoteConn = Omit<SshOpts, 'command'>;

/** Runs a probe script on the remote and returns its stdout + exit code. Injected for testing. */
export type ProbeRunner = (script: string) => Promise<{ stdout: string; code: number | null }>;

function sshProbeRunner(conn: RemoteConn): ProbeRunner {
  return async (script) => {
    const r = await runSsh({ ...conn, command: script });
    return { stdout: r.stdout, code: r.code };
  };
}

/**
 * Detect the remote host's ServerPlatform over SSH. Node-independent: a missing Node
 * is `has('node') === false`, surfaced as a plan-time prerequisite — never a detection failure.
 */
export async function detectRemoteServerPlatform(
  conn: RemoteConn,
  runner: ProbeRunner = sshProbeRunner(conn),
): Promise<DetectedServerPlatform> {
  const { stdout } = await runner(buildProbeScript());
  const deps = parseProbe(stdout);
  if (!deps) {
    throw new Error(
      'Could not detect the remote OS (no POSIX `uname`). ' +
        'Windows remote provisioning is not yet supported.',
    );
  }
  return detectServerPlatform(deps);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- remote-detect`
Expected: PASS (9 tests total).

- [ ] **Step 5: Full verify**

Run: `pnpm --filter @rebink/patchwire typecheck && pnpm -r typecheck`
Expected: exit 0, no regressions.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/agent/provision/remote-detect.ts packages/cli/test/agent/provision/remote-detect.test.ts
git commit -m "feat(agent): detectRemoteServerPlatform (Node-independent, SSH-probed)"
```

---

## What this plan leaves to follow-on plans (per the spec roadmap, slice 1)

- `AgentInstaller` interface + `CorepackPnpmInstaller`.
- `RemoteExecutor` (per-OS step dispatch) + the macOS executors.
- Plan **preview** + **consent** wiring; **verify** (non-fatal health report).
- `StepResult.degraded?` + `ProvisionOutcome.degraded[]` engine extension.
- Refactoring `runProvisionAgent` onto `runProvision` + remote detection.
- Windows remote detection (ships with the Windows executor slice; today it throws an actionable error).

## Self-review notes

- **Spec coverage (§1):** SSH probe, reuse of the pure `detectServerPlatform`, Node-independence, and the Windows "not yet supported" honesty are all covered by Tasks 1–2. Other spec sections are explicitly deferred above.
- **Type consistency:** `DetectDeps`/`DetectedServerPlatform` reused unchanged; `parseProbe → DetectDeps` feeds `detectServerPlatform` exactly; `RemoteConn = Omit<SshOpts,'command'>` matches `runSsh`'s `SshOpts`; `ProbeRunner` signature stable across tasks.
- **Placeholder scan:** none — all code complete. The "Windows not yet supported" throw is intentional honest behavior, not a stub.
