# Provisioning Env-Ownership Reconciliation Implementation Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make `write-secret` the single owner of the remote agent's env file (`~/.patchwire/agent.env`, with the correct `PW_AGENT_TOKEN` + agent config), make `runDaemonInstall` **service-only** (a launchd plist that *sources* `agent.env`, no env-write, no random token), and reconcile the existing `runProvisionAgent` wizard to the new model.

**Why:** A bug in the shipped write-secret slice wrote `PW_TOKEN` (the *client* var) to `~/.patchwire/env`, but the remote agent authenticates against **`PW_AGENT_TOKEN`** (`agent.ts:75`) and its env file is `~/.patchwire/agent.env`. Separately, `runDaemonInstall` embedded the token in the plist and generated a *random* token when none was passed — clobber-prone. This plan fixes all of it and cleanly separates "write the env" (write-secret) from "install the service" (install-service), which ages well for Linux/Windows.

**Tech Stack:** TypeScript, vitest (`@rebink/patchwire`). Touches `agent/provision/remote-executor.ts`, `commands/daemon.ts`, `commands/setup.ts` + their tests.

**Spec:** `docs/superpowers/specs/2026-06-13-remote-ssh-provisioning-design.md` (§4 write-secret + install-service).

---

### Task 1: write-secret writes the full agent env to `~/.patchwire/agent.env` (TDD)

**Files:**
- Modify: `packages/cli/src/agent/provision/remote-executor.ts`
- Test: `packages/cli/test/agent/provision/remote-executor.test.ts`

- [ ] **Step 1: Update the write-secret tests** to expect the agent.env path + `PW_AGENT_TOKEN` + config. Replace the existing `describe('remoteExecutor — write-secret', …)` block with:

```ts
import { quoteForShell } from '../../../src/lib/ssh-runner.ts';

describe('remoteExecutor — write-secret', () => {
  it('writes the FULL agent env (PW_AGENT_TOKEN + config) atomically to ~/.patchwire/agent.env via stdin', async () => {
    const calls: { command: string; input?: string }[] = [];
    const runner = async (command: string, input?: string) => {
      calls.push({ command, input });
      return { stdout: '', stderr: '', code: 0 };
    };
    const exec = remoteExecutor(CONN, detected('linux'), {
      token: 'TKN-123', host: '100.64.0.1', port: 7878, aiBin: 'claude',
      installer: fakeInstaller([]), runner,
    });
    const out = await exec(step('write-secret'));

    expect(out.result.ok).toBe(true);
    const w = calls[0]!;
    // Atomic temp→rename, mode 600, into ~/.patchwire/agent.env
    expect(w.command).toContain('umask 077');
    expect(w.command).toMatch(/cat > .*agent\.env\.tmp/);
    expect(w.command).toMatch(/mv -f .*agent\.env\.tmp.* .*\/\.patchwire\/agent\.env/);
    // The token is in stdin only, never in the command argv.
    expect(w.command).not.toContain('TKN-123');
    // Stdin payload carries the agent's env vars (PW_AGENT_TOKEN — NOT PW_TOKEN).
    expect(w.input).toContain(`export PW_AGENT_TOKEN=${quoteForShell('TKN-123')}`);
    expect(w.input).toContain(`export PW_AGENT_HOST=${quoteForShell('100.64.0.1')}`);
    expect(w.input).toContain(`export PW_AGENT_PORT=${quoteForShell('7878')}`);
    expect(w.input).toContain(`export PW_AI_BIN=${quoteForShell('claude')}`);
    expect(w.input).not.toContain('PW_TOKEN=');

    await out.compensate!();
    expect(calls[1]!.command).toMatch(/rm -f .*\/\.patchwire\/agent\.env/);
  });

  it('defaults host/port/aiBin when not provided', async () => {
    const calls: { command: string; input?: string }[] = [];
    const runner = async (command: string, input?: string) => { calls.push({ command, input }); return { stdout: '', stderr: '', code: 0 }; };
    const exec = remoteExecutor(CONN, detected('macos'), { token: 't', installer: fakeInstaller([]), runner });
    await exec(step('write-secret'));
    expect(calls[0]!.input).toContain(`export PW_AGENT_HOST=${quoteForShell('127.0.0.1')}`);
    expect(calls[0]!.input).toContain(`export PW_AGENT_PORT=${quoteForShell('7878')}`);
    expect(calls[0]!.input).toContain(`export PW_AI_BIN=${quoteForShell('claude')}`);
  });

  it('write-secret reports failure (no compensate) on non-zero exit', async () => {
    const runner = async () => ({ stdout: '', stderr: 'denied', code: 1 });
    const exec = remoteExecutor(CONN, detected('linux'), { token: 't', installer: fakeInstaller([]), runner });
    const out = await exec(step('write-secret'));
    expect(out.result.ok).toBe(false);
    expect(out.compensate).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @rebink/patchwire test -- remote-executor`
Expected: FAIL — current write-secret writes `PW_TOKEN` to `~/.patchwire/env`.

- [ ] **Step 3: Update `remote-executor.ts`**

Extend `RemoteExecutorOpts` with the agent config:
```ts
export interface RemoteExecutorOpts {
  token: string;
  /** Agent network host written into the remote env (default loopback). */
  host?: string;
  /** Agent port (default 7878). */
  port?: number;
  /** AI binary the agent spawns (default 'claude'). */
  aiBin?: string;
  installer?: AgentInstaller;
  runner?: RemoteRunner;
}
```
Replace the `WRITE_ENV_CMD` constant and the `write-secret` case:
```ts
/** Atomic, mode-600 write of the agent env file, driven over stdin (token never on argv). */
const WRITE_ENV_CMD =
  'umask 077; mkdir -p "$HOME/.patchwire" && cat > "$HOME/.patchwire/agent.env.tmp" && mv -f "$HOME/.patchwire/agent.env.tmp" "$HOME/.patchwire/agent.env"';
```
```ts
      case 'write-secret': {
        const host = opts.host ?? '127.0.0.1';
        const port = opts.port ?? 7878;
        const aiBin = opts.aiBin ?? 'claude';
        const payload =
          '# patchwire-agent environment (managed by patchwire provisioning)\n' +
          `export PW_AGENT_TOKEN=${quoteForShell(opts.token)}\n` +
          `export PW_AGENT_HOST=${quoteForShell(host)}\n` +
          `export PW_AGENT_PORT=${quoteForShell(String(port))}\n` +
          `export PW_AI_BIN=${quoteForShell(aiBin)}\n`;
        const r = await runner(WRITE_ENV_CMD, payload);
        if (r.code !== 0) {
          return { result: { ok: false, detail: (r.stderr || r.stdout || 'write-secret failed').trim() } };
        }
        return {
          result: { ok: true, detail: 'agent env written to ~/.patchwire/agent.env (mode 600)' },
          compensate: async () => { await runner('rm -f "$HOME/.patchwire/agent.env"'); },
        };
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @rebink/patchwire test -- remote-executor`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/provision/remote-executor.ts packages/cli/test/agent/provision/remote-executor.test.ts
git commit -m "fix(agent): write-secret writes full agent.env with PW_AGENT_TOKEN (was wrong var/path)"
```

---

### Task 2: `runDaemonInstall` becomes service-only (plist sources agent.env)

**Files:**
- Modify: `packages/cli/src/commands/daemon.ts`
- Test: `packages/cli/test/commands/daemon-start.test.ts` (add an install test) — verify nothing else references the removed behavior.

- [ ] **Step 1: Write a failing test** (append to `daemon-start.test.ts`; it already mocks `node:child_process` and imports from `daemon.ts`). This asserts the new service-only behavior by spying on `node:fs/promises` writeFile.

```ts
import { runDaemonInstall } from '../../src/commands/daemon.ts';
import * as fsp from 'node:fs/promises';

describe('runDaemonInstall (service-only)', () => {
  it('writes a plist that sources ~/.patchwire/agent.env and does NOT write an env file or generate a token', async () => {
    if (process.platform !== 'darwin') return; // launchd path is macOS-only
    const writes: { path: string; content: string }[] = [];
    vi.spyOn(fsp, 'writeFile').mockImplementation(async (p, c) => { writes.push({ path: String(p), content: String(c) }); });
    vi.spyOn(fsp, 'mkdir').mockResolvedValue(undefined as never);
    // existsSync(agent.env) must be true so install proceeds; existsSync(patchwire-agent) for `which`.
    await runDaemonInstall({});
    const plist = writes.find((w) => w.path.endsWith('.plist'));
    expect(plist, 'a plist should be written').toBeTruthy();
    expect(plist!.content).toMatch(/agent\.env/);              // sources the env file
    expect(plist!.content).not.toMatch(/PW_AGENT_TOKEN<\/key>/); // token NOT embedded in the plist
    expect(writes.some((w) => w.path.endsWith('agent.env'))).toBe(false); // no env-file write
  });
});
```
> NOTE: this test depends on `which('patchwire-agent')` and `existsSync(agent.env)` returning truthy. If the existing test file's mock setup doesn't already make those pass, stub them minimally (mock `node:fs` `existsSync` to return true, and the `command -v patchwire-agent` spawnSync to return a path) — mirror the mocking already present in this test file. If wiring these mocks is impractical, instead write the test against an extracted pure `buildAgentPlist(agentBin, logDir)` helper (see Step 2) and assert its output; keep the behavioral intent.

- [ ] **Step 2: Refactor `daemon.ts`**

Replace the plist construction in `runDaemonInstall` so it sources the env file instead of embedding vars, and remove env-writing + token generation:

- Remove the `randomBytes` import and the `token`/`projectsRoot`/`host`/`port`/`aiBin` derivation + the `writeFile(envFile(), …)` + `chmod(envFile())` block.
- Require the env file to exist; bail with guidance if not:
```ts
  if (!existsSync(envFile())) {
    log.err(`No agent env at ${envFile()}. Provision the token first (write-secret) or create it, then re-run.`);
    process.exitCode = 1;
    return;
  }
```
- Build the plist with a sourcing wrapper (extract a pure helper for testability):
```ts
export function buildAgentPlist(agentBin: string, env: string, outLog: string, errLog: string): string {
  const cmd = `. ${env}; exec ${agentBin} serve`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-lc</string>
    <string>${escape(cmd)}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${escape(outLog)}</string>
  <key>StandardErrorPath</key><string>${escape(errLog)}</string>
</dict>
</plist>
`;
}
```
Then in `runDaemonInstall`, after the `existsSync(envFile())` guard:
```ts
  const plist = buildAgentPlist(agentBin, envFile(), join(logDir(), 'agent.out.log'), join(logDir(), 'agent.err.log'));
  await mkdir(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
  await writeFile(plistPath(), plist, { encoding: 'utf8', mode: 0o600 });
  const uid = process.getuid?.() ?? 0;
  const start = startLaunchAgent(plistPath(), uid);
  // ...existing start-failure handling and success logs (drop the "Token (share…)" block).
```
Drop the now-irrelevant `InstallOptions` fields that fed env vars (keep the interface minimal or empty); remove the token-printing section. Keep `startLaunchAgent`, `runDaemonUninstall`, `plistPath`, `envFile`, `logDir`, `escape`, `which` unchanged.

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @rebink/patchwire test -- daemon`
Expected: PASS (existing `startLaunchAgent` tests + the new install/buildAgentPlist test). The `agent.ts` `install` subcommand still calls `runDaemonInstall(opts)` — confirm it compiles (opts may be unused now; that's fine).

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/commands/daemon.ts packages/cli/test/commands/daemon-start.test.ts
git commit -m "refactor(agent): launchd install is service-only (sources agent.env, no token gen)"
```

---

### Task 3: Reconcile `runProvisionAgent` to write agent.env then service-only install

**Files:**
- Modify: `packages/cli/src/commands/setup.ts`
- Test: `packages/cli/test/commands/setup-provision-agent.test.ts`

- [ ] **Step 1: Update the test** `setup-provision-agent.test.ts`. The existing happy-path test asserts the remote ran `patchwire-agent install --token <TOKEN> …`. Change it to expect: (a) the agent env is written over SSH with the token via **stdin** (the ssh command contains `cat > … agent.env` and NOT the token), and (b) `patchwire-agent install` is run **without** `--token`. Update the assertion block:

```ts
    // token written to the remote agent.env via stdin (not on argv)
    expect(sshArgs.join(' ')).toMatch(/agent\.env/);
    expect(sshArgs.join(' ')).not.toContain(TOKEN); // token rides stdin, not the command
    expect(sshArgs.join(' ')).toMatch(/patchwire-agent install/);
    expect(sshArgs.join(' ')).not.toMatch(/--token/);
```
Keep the `no_node` test and the injection-guard test unchanged.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @rebink/patchwire test -- setup-provision-agent`
Expected: FAIL — current code passes `--token` on argv.

- [ ] **Step 3: Update `runProvisionAgent` in `setup.ts`**

Change the remote script so it (1) writes `~/.patchwire/agent.env` atomically from **stdin** and (2) runs the now-service-only `patchwire-agent install` (no `--token`). Pipe the env content via the SSH stdin (the runner used here must forward stdin — use `runSsh` with `input`, or the existing spawn with stdin). Concretely, the remote script becomes:
```ts
  const remoteScript = [
    'umask 077',
    'mkdir -p "$HOME/.patchwire"',
    'cat > "$HOME/.patchwire/agent.env.tmp"',
    'mv -f "$HOME/.patchwire/agent.env.tmp" "$HOME/.patchwire/agent.env"',
    `patchwire-agent install --host ${input.host} --port ${input.agentPort}`,
  ].join(' && ');
  const remoteCmd = `bash -lc '${remoteScript.replace(/'/g, `'\\''`)}'`;
  const envPayload =
    `export PW_AGENT_TOKEN='${input.token}'\n` +
    `export PW_AGENT_HOST='${input.host}'\n` +
    `export PW_AGENT_PORT='${input.agentPort}'\n`;
```
and pass `envPayload` as the SSH process stdin (the existing call spawns ssh — write `envPayload` to its stdin; if it uses `runSsh`, pass `input: envPayload`). The token is no longer interpolated into `remoteScript`. Keep the existing injection guard (reject shell-metachar host/user) and the `no_node` Node-presence check unchanged.

> If `runProvisionAgent` currently writes a LOCAL `~/.patchwire/env` with `PW_TOKEN` for the laptop, KEEP that (the client still needs `PW_TOKEN`); only the REMOTE write changes to `agent.env`/`PW_AGENT_TOKEN`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @rebink/patchwire test -- setup-provision-agent`
Expected: PASS (happy-path updated; `no_node` + injection-guard still pass).

- [ ] **Step 5: Full verify**

Run: `pnpm --filter @rebink/patchwire test`
Expected: 0 failed.

Run: `pnpm --filter @rebink/patchwire typecheck && pnpm -r typecheck`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/setup.ts packages/cli/test/commands/setup-provision-agent.test.ts
git commit -m "refactor(agent): runProvisionAgent writes agent.env via stdin + service-only install"
```

---

## What this plan leaves to Plan B (the executors you asked for)

- `install-service` executor step (macOS → service-only `patchwire-agent install`; Linux → systemd `--user`; Windows → degraded) with compensate `patchwire-agent uninstall`.
- `install-mutagen` executor step (presence-check → ok, else degraded since the agent resolves Mutagen lazily via the core resolver).

## Self-review notes

- **Correctness:** fixes the shipped bug — remote env is now `~/.patchwire/agent.env` with `PW_AGENT_TOKEN` (the var the agent reads at `agent.ts:75`), not the client's `PW_TOKEN`. Token stays off argv (stdin) and out of the plist (sourced from the mode-600 env file).
- **No clobber / no random token:** `runDaemonInstall` no longer generates a random token or writes the env; it requires the env to exist (written by write-secret / runProvisionAgent).
- **Strangler:** `runProvisionAgent` is reconciled to the new model rather than left to break; the client-side `PW_TOKEN` write (if any) is preserved.
- **Type/name consistency:** `RemoteExecutorOpts` gains optional `host`/`port`/`aiBin`; `buildAgentPlist` is a pure exported helper; `WRITE_ENV_CMD` targets `agent.env`.
- **Placeholder scan:** none.
