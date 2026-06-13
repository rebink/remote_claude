# Shared Provisioning Primitives (converge wizard + orchestrator) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extract the provisioning logic that the wizard (`runProvisionAgent`) and the orchestrator path (`remote-executor`/`installer`) currently duplicate into shared primitives — the agent-env content, the atomic env-write command, and the Corepack+pnpm install command — and route both paths through them, converging the wizard off `npm i -g` onto Corepack+pnpm.

**Architecture:** New `packages/cli/src/agent/provision/primitives.ts` exports `buildAgentEnv(opts)`, `WRITE_AGENT_ENV_CMD`, `AGENT_INSTALL_CMD` (+ `AGENT_PACKAGE`, `PNPM_VERSION`). `remote-executor` (write-secret) and `installer` (corepackPnpmInstaller) consume them with no behavior change; `runProvisionAgent` (setup.ts) consumes them, replacing its inline `npm i -g`/env-write/payload. Keeps both entry points (hybrid), per the decision: the wizard stays the optimized single-round-trip path; shared primitives prevent drift.

**Tech Stack:** TypeScript, vitest (`@rebink/patchwire`). Touches `provision/primitives.ts` (new), `remote-executor.ts`, `installer.ts`, `commands/setup.ts` + tests.

**Spec:** `docs/superpowers/specs/2026-06-13-remote-ssh-provisioning-design.md`.

---

### Task 1: primitives module (TDD)

**Files:**
- Create: `packages/cli/src/agent/provision/primitives.ts`
- Test: `packages/cli/test/agent/provision/primitives.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildAgentEnv, WRITE_AGENT_ENV_CMD, AGENT_INSTALL_CMD, AGENT_PACKAGE } from '../../../src/agent/provision/primitives.ts';
import { quoteForShell } from '../../../src/lib/ssh-runner.ts';

describe('buildAgentEnv', () => {
  it('emits PW_AGENT_TOKEN + config, shell-quoted, with defaults', () => {
    const env = buildAgentEnv({ token: 'TKN-123' });
    expect(env).toContain(`export PW_AGENT_TOKEN=${quoteForShell('TKN-123')}`);
    expect(env).toContain(`export PW_AGENT_HOST=${quoteForShell('127.0.0.1')}`);
    expect(env).toContain(`export PW_AGENT_PORT=${quoteForShell('7878')}`);
    expect(env).toContain(`export PW_AI_BIN=${quoteForShell('claude')}`);
    expect(env).not.toContain('PW_TOKEN='); // client var must not leak into the agent env
  });
  it('honors explicit host/port/aiBin', () => {
    const env = buildAgentEnv({ token: 't', host: '100.64.0.1', port: 9999, aiBin: 'claude-next' });
    expect(env).toContain(`export PW_AGENT_HOST=${quoteForShell('100.64.0.1')}`);
    expect(env).toContain(`export PW_AGENT_PORT=${quoteForShell('9999')}`);
    expect(env).toContain(`export PW_AI_BIN=${quoteForShell('claude-next')}`);
  });
});

describe('install + write primitives', () => {
  it('AGENT_INSTALL_CMD uses corepack + pnpm to install the agent package', () => {
    expect(AGENT_INSTALL_CMD).toContain('corepack enable');
    expect(AGENT_INSTALL_CMD).toContain('corepack prepare pnpm@');
    expect(AGENT_INSTALL_CMD).toContain(`pnpm add -g ${AGENT_PACKAGE}`);
    expect(AGENT_INSTALL_CMD).not.toContain('npm i -g'); // converged off npm
  });
  it('WRITE_AGENT_ENV_CMD is an atomic temp→rename into ~/.patchwire/agent.env', () => {
    expect(WRITE_AGENT_ENV_CMD).toContain('umask 077');
    expect(WRITE_AGENT_ENV_CMD).toMatch(/cat > .*agent\.env\.tmp/);
    expect(WRITE_AGENT_ENV_CMD).toMatch(/mv -f .*agent\.env\.tmp.* .*\/\.patchwire\/agent\.env/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- provision/primitives`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `packages/cli/src/agent/provision/primitives.ts`**

```ts
import { quoteForShell } from '../../lib/ssh-runner.ts';

export const AGENT_PACKAGE = '@rebink/patchwire';
export const PNPM_VERSION = '10.26.1';

/** Install the agent globally via Corepack-activated pnpm (Node >=20 is the only prerequisite). */
export const AGENT_INSTALL_CMD =
  `corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate && pnpm add -g ${AGENT_PACKAGE}`;

/** Atomic, mode-600 write of stdin into ~/.patchwire/agent.env (temp → rename). */
export const WRITE_AGENT_ENV_CMD =
  'umask 077; mkdir -p "$HOME/.patchwire" && cat > "$HOME/.patchwire/agent.env.tmp" && mv -f "$HOME/.patchwire/agent.env.tmp" "$HOME/.patchwire/agent.env"';

export interface AgentEnvOpts {
  token: string;
  host?: string;
  port?: number;
  aiBin?: string;
}

/** The remote agent env file content (PW_AGENT_TOKEN + config), single-quoted for safe sourcing. */
export function buildAgentEnv(opts: AgentEnvOpts): string {
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? 7878;
  const aiBin = opts.aiBin ?? 'claude';
  return (
    '# patchwire-agent environment (managed by patchwire provisioning)\n' +
    `export PW_AGENT_TOKEN=${quoteForShell(opts.token)}\n` +
    `export PW_AGENT_HOST=${quoteForShell(host)}\n` +
    `export PW_AGENT_PORT=${quoteForShell(String(port))}\n` +
    `export PW_AI_BIN=${quoteForShell(aiBin)}\n`
  );
}
```

- [ ] **Step 4: Run test → PASS. Commit.**

Run: `pnpm --filter @rebink/patchwire test -- provision/primitives`
```bash
git add packages/cli/src/agent/provision/primitives.ts packages/cli/test/agent/provision/primitives.test.ts
git commit -m "feat(agent): shared provisioning primitives (agent env, write cmd, install cmd)"
```

---

### Task 2: route remote-executor + installer through the primitives (behavior-preserving)

**Files:**
- Modify: `packages/cli/src/agent/provision/remote-executor.ts`
- Modify: `packages/cli/src/agent/provision/installer.ts`

- [ ] **Step 1: `remote-executor.ts`** — import the primitives and use them in `write-secret`:

Add `import { buildAgentEnv, WRITE_AGENT_ENV_CMD } from './primitives.ts';`. Delete the local `WRITE_ENV_CMD` constant and replace the `write-secret` payload/command with:
```ts
      case 'write-secret': {
        const payload = buildAgentEnv({ token: opts.token, host: opts.host, port: opts.port, aiBin: opts.aiBin });
        const r = await runner(WRITE_AGENT_ENV_CMD, payload);
        if (r.code !== 0) {
          return { result: { ok: false, detail: (r.stderr || r.stdout || 'write-secret failed').trim() } };
        }
        return {
          result: { ok: true, detail: 'agent env written to ~/.patchwire/agent.env (mode 600)' },
          compensate: async () => { await runner('rm -f "$HOME/.patchwire/agent.env"'); },
        };
      }
```
(The `SET_EGRESS_DENY_CMD`/`UNSET_EGRESS_CMD` constants stay.)

- [ ] **Step 2: `installer.ts`** — use `AGENT_INSTALL_CMD` in `corepackPnpmInstaller.install`:

Add `import { AGENT_INSTALL_CMD, AGENT_PACKAGE } from './primitives.ts';`. Replace the local `PNPM_VERSION`/`PACKAGE` constants + the inline install command with `AGENT_INSTALL_CMD`, and use `AGENT_PACKAGE` in `version`/`uninstall` (`pnpm remove -g ${AGENT_PACKAGE}`). The install command becomes `const r = await runner(AGENT_INSTALL_CMD);` (same string as before).

- [ ] **Step 3: Run the affected tests** (must still pass unchanged — output is identical):

Run: `pnpm --filter @rebink/patchwire test -- remote-executor installer`
Expected: PASS (write-secret + installer tests assert the same command/payload, now sourced from the primitive).

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/agent/provision/remote-executor.ts packages/cli/src/agent/provision/installer.ts
git commit -m "refactor(agent): remote-executor + installer use shared provisioning primitives"
```

---

### Task 3: converge `runProvisionAgent` onto the shared primitives

**Files:**
- Modify: `packages/cli/src/commands/setup.ts`
- Test: `packages/cli/test/commands/setup-provision-agent.test.ts`

- [ ] **Step 1: Update the test** — the happy-path assertion currently expects the inline script. Change the install assertion from `npm i -g` to the Corepack/pnpm command, and keep the env-write + no-`--token` assertions:

```ts
    expect(sshArgs.join(' ')).toMatch(/corepack enable/);
    expect(sshArgs.join(' ')).toMatch(/pnpm add -g @rebink\/patchwire/);
    expect(sshArgs.join(' ')).not.toMatch(/npm i -g/);
    expect(sshArgs.join(' ')).toMatch(/agent\.env/);
    expect(sshArgs.join(' ')).not.toContain(TOKEN);       // token via stdin
    expect(sshArgs.join(' ')).toMatch(/patchwire-agent install/);
    expect(sshArgs.join(' ')).not.toMatch(/--token/);
```
Keep the `no_node` and injection-guard tests unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- setup-provision-agent`
Expected: FAIL — script still uses `npm i -g`.

- [ ] **Step 3: Update `runProvisionAgent` in `setup.ts`**

Add `import { buildAgentEnv, WRITE_AGENT_ENV_CMD, AGENT_INSTALL_CMD } from '../agent/provision/primitives.ts';`. Rebuild the `remoteScript` + `envPayload` from the primitives, preserving the `PW_NO_NODE` check and the structure:
```ts
  const remoteScript = [
    'set -e',
    'command -v node >/dev/null || { echo PW_NO_NODE; exit 3; }',
    `command -v patchwire-agent >/dev/null || { ${AGENT_INSTALL_CMD}; }`,
    WRITE_AGENT_ENV_CMD,
    `patchwire-agent install --host ${input.host} --port ${input.agentPort}`,
  ].join(' && ');
  const remoteCmd = `bash -lc '${remoteScript.replace(/'/g, `'\\''`)}'`;
  const envPayload = buildAgentEnv({ token: input.token, host: input.host, port: input.agentPort });
```
Everything else in `runProvisionAgent` (injection guard, ssh spawn with `input: envPayload`, PW_NO_NODE/status handling, local token write, health poll) stays unchanged.

> NOTE on the `&&` chain: `WRITE_AGENT_ENV_CMD` begins `umask 077; mkdir -p … && cat > … && mv …`. Joining it with `&&` yields `… && umask 077; mkdir -p … && …`. The leading `umask 077;` runs unconditionally — harmless (umask can't fail meaningfully). If you prefer strict chaining, wrap it as `( ${WRITE_AGENT_ENV_CMD} )`. Verify the test's `agent.env` regex still matches.

- [ ] **Step 4: Run test → PASS**

Run: `pnpm --filter @rebink/patchwire test -- setup-provision-agent`
Expected: PASS (happy path updated; `no_node` + injection-guard unchanged).

- [ ] **Step 5: Full verify (CLEAN TREE)**

Run: `git status --porcelain` → expect only the intended changes staged/committed; no stray edits.
Run: `pnpm --filter @rebink/patchwire test`
Expected: 0 failed.
Run: `pnpm -r typecheck`
Expected: exit 0 — **confirm ALL packages report Done (4), not fewer.**

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/setup.ts packages/cli/test/commands/setup-provision-agent.test.ts
git commit -m "refactor(agent): runProvisionAgent uses shared primitives (corepack/pnpm, agent env)"
```

---

## What this leaves for later

- `provisionRemote` remains the structured/extension API; once it's proven across macOS/Linux/Windows, the wizard can migrate to it. The shared primitives mean the two stay in lockstep until then.
- Linux executors (systemd `--user`), BinaryInstaller, nftables/Windows.

## Self-review notes

- **Decision adherence:** both entry points kept (hybrid); shared logic extracted downward (`buildAgentEnv`/`WRITE_AGENT_ENV_CMD`/`AGENT_INSTALL_CMD`) so wizard + orchestrator converge; wizard moved off `npm i -g` onto Corepack+pnpm (the divergence fix).
- **Behavior-preserving where intended:** remote-executor/installer outputs are byte-identical (sourced from the same strings); only the wizard's install command changes (npm→pnpm) by design.
- **Verification rigor (lesson applied):** Step 5 explicitly checks a clean tree and all-4-packages typecheck before claiming green.
- **Placeholder scan:** none.
