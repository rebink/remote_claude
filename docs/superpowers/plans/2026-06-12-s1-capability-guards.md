# S1 — Capability Guards + Agent Startup Summary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add reusable capability-guard utilities over the detected `ServerPlatform`, and make the detection seam load-bearing by logging a capability summary at agent startup.

**Architecture:** Pure helpers in `packages/cli/src/agent/server-platform/guards.ts` (`isEnforceable`, `summarizeCapabilities`, `assertEnforceable`), fully unit-tested. A single additive log line group at agent startup exercises `detectNodeServerPlatform()` — zero change to the security-critical egress gate (that wiring is deferred to the egress-behavior slice, because the agent's enforcement is seatbelt-specific and Linux nftables has no impl until S2).

**Tech Stack:** TypeScript, vitest (`@rebink/patchwire`, tests under `packages/cli/test/`).

**Spec:** `docs/specs/2026-06-12-agent-protocol-spec.md` (Pillar 1 — "fail-closed or warn, never silently downgrade").

---

### Task 1: Capability guard utilities (TDD)

**Files:** Create `packages/cli/src/agent/server-platform/guards.ts`; Test `packages/cli/test/agent/server-platform/guards.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { isEnforceable, summarizeCapabilities, assertEnforceable } from '../../../src/agent/server-platform/guards.ts';
import type { DetectedServerPlatform } from '../../../src/agent/server-platform/types.ts';

function platform(over: Partial<DetectedServerPlatform['capabilities']> = {}): DetectedServerPlatform {
  return {
    os: 'macos',
    arch: 'arm64',
    pathStyle: 'posix',
    capabilities: {
      egress: { type: 'seatbelt', requiresElevation: false },
      filesystemIsolation: { type: 'seatbelt', requiresElevation: false },
      secrets: { type: 'keychain', requiresElevation: false },
      service: { type: 'launchd', requiresElevation: false },
      shell: { type: 'zsh', requiresElevation: false },
      packageManager: { type: 'brew', requiresElevation: false },
      ...over,
    },
  };
}

describe('isEnforceable', () => {
  it('is true for a real impl and false for none', () => {
    expect(isEnforceable({ type: 'seatbelt', requiresElevation: false })).toBe(true);
    expect(isEnforceable({ type: 'none', requiresElevation: false })).toBe(false);
  });
});

describe('summarizeCapabilities', () => {
  it('includes an os line and marks a degraded security capability', () => {
    const lines = summarizeCapabilities(platform({ egress: { type: 'none', requiresElevation: false } }));
    expect(lines[0]).toMatch(/os: macos \(arm64, posix paths\)/);
    expect(lines.some((l) => /egress: none — NONE \(degraded/.test(l))).toBe(true);
  });
  it('marks capabilities that require elevation', () => {
    const lines = summarizeCapabilities(platform({ service: { type: 'systemd-system', requiresElevation: true } }));
    expect(lines.some((l) => /service: systemd-system \(requires elevation\)/.test(l))).toBe(true);
  });
});

describe('assertEnforceable', () => {
  it('throws fail-closed when the capability is none', () => {
    const p = platform({ egress: { type: 'none', requiresElevation: false } });
    expect(() => assertEnforceable(p, 'egress')).toThrow(/fail-closed/i);
  });
  it('passes when the capability has an impl', () => {
    expect(() => assertEnforceable(platform(), 'egress')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- guards`
Expected: FAIL — `guards.ts` not found.

- [ ] **Step 3: Write `packages/cli/src/agent/server-platform/guards.ts`**

```ts
import type { DetectedServerPlatform, CapabilityDescriptor, ServerCapabilities } from './types.ts';

/** A capability is enforceable when it has a real implementation (not 'none'). */
export function isEnforceable(cap: CapabilityDescriptor): boolean {
  return cap.type !== 'none';
}

/** Capabilities whose absence is a security downgrade worth flagging loudly. */
const SECURITY_CRITICAL: (keyof ServerCapabilities)[] = ['egress', 'filesystemIsolation'];

/** Human-readable one-line-per-capability summary for logs / diagnostics. */
export function summarizeCapabilities(d: DetectedServerPlatform): string[] {
  const lines = [`os: ${d.os} (${d.arch}, ${d.pathStyle} paths)`];
  for (const [name, cap] of Object.entries(d.capabilities)) {
    const critical = SECURITY_CRITICAL.includes(name as keyof ServerCapabilities);
    const note =
      cap.type === 'none'
        ? critical
          ? ' — NONE (degraded: no OS enforcement)'
          : ' — none'
        : cap.requiresElevation
          ? ' (requires elevation)'
          : '';
    lines.push(`${name}: ${cap.type}${cap.version ? '@' + cap.version : ''}${note}`);
  }
  return lines;
}

/** Throw a clear fail-closed error if a capability has no enforcement mechanism. */
export function assertEnforceable(d: DetectedServerPlatform, key: keyof ServerCapabilities): void {
  if (!isEnforceable(d.capabilities[key])) {
    throw new Error(
      `Capability "${key}" is not enforceable on this ${d.os} host (no OS mechanism available). ` +
        'Refusing to proceed (fail-closed).',
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- guards`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/server-platform/guards.ts packages/cli/test/agent/server-platform/guards.test.ts
git commit -m "feat(agent): add ServerPlatform capability guards + summary"
```

---

### Task 2: Log the capability summary at agent startup

**Files:** Modify `packages/cli/src/agent.ts`

- [ ] **Step 1: Add imports near the other `./agent/...` imports**

```ts
import { detectNodeServerPlatform } from './agent/server-platform/node-detect.ts';
import { summarizeCapabilities } from './agent/server-platform/guards.ts';
```

- [ ] **Step 2: Add the summary log immediately BEFORE the `// Default-deny egress (M3, macOS).` comment block**

Find the line `// Default-deny egress (M3, macOS). When enabled, the AI runs under a seatbelt` and insert, right before it:

```ts
  // Surface the detected server platform + capabilities at startup so degraded
  // security (e.g. egress: NONE) is visible rather than silent.
  for (const line of summarizeCapabilities(detectNodeServerPlatform())) {
    console.error(`[platform] ${line}`);
  }

```

This is additive logging only — it does NOT change the egress decision below it.

- [ ] **Step 3: Verify**

Run: `pnpm --filter @rebink/patchwire typecheck`
Expected: exit 0.

Run: `pnpm --filter @rebink/patchwire test`
Expected: all pass (existing suite + the new guards tests).

Run: `pnpm -r typecheck`
Expected: no regressions.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/agent.ts
git commit -m "feat(agent): log detected ServerPlatform capabilities at startup"
```

---

## What this slice leaves to follow-on S1 slices

- **Routing the egress fail-closed gate through the capability model** — deferred to the egress-behavior slice, because the agent's enforcement is seatbelt-specific; a declared `nftables` capability must not green-light enforcement until its impl exists (S2).
- ServerPlatform behavior methods, provisioning state machine, Protocol v2, sessions.

## Self-review notes

- **Spec coverage:** the "fail-closed or warn, never silently downgrade" principle gets its reusable primitives (`assertEnforceable`, degraded-summary) and a first real consumer (startup summary). Egress-gate rewiring is explicitly and correctly deferred.
- **Type consistency:** `DetectedServerPlatform`/`CapabilityDescriptor`/`ServerCapabilities` reused from `types.ts` unchanged; `assertEnforceable(d, key)` uses `keyof ServerCapabilities`.
- **Placeholder scan:** none; behavior change is limited to additive logging.
