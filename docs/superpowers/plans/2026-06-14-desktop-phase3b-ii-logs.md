# Desktop Phase 3b-ii — host log viewer (SSH) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the desktop view a provisioned host's agent audit log — a **Logs** button on each inventory card that opens a log view, fetched over SSH via a new `host-logs` CLI command.

**Architecture:** A new `host-logs` CLI command (sibling of `host-check`/`host-uninstall`) SSHes to the host and runs the agent's own `patchwire-agent log --json --limit N` (reads `~/.patchwire/agent.log`; no network/port needed), parses the NDJSON entries, and emits one `{ok, entries}` JSON line. The desktop adds a `host_logs` one-shot sidecar command and a third view ('logs') reachable from a host card, rendering entries via a pure formatter. Reuses the Phase-3b host-op scaffolding (`badHostField`, `runSsh`, `HostArgs`, `validate_host`).

**Tech Stack:** TypeScript (CLI + desktop UI), Rust (Tauri command), Tauri v2 `tauri-plugin-shell`, vitest. No token/secret (key-based SSH; reads a local file on the host). POSIX (the agent + its log live on mac/linux hosts; Windows host log-fetch deferred with the other Windows host-probing).

**Scope:** 3b-ii = **log viewing only**. **Deferred:** stronghold (3c); release sidecar + signing (3d); live log streaming/tailing (this is a point-in-time fetch of the last N entries).

**Prerequisites:** Phase 3b (host-ops: `host-check`/`host-uninstall`, `HostArgs`, `validate_host`, `badHostField`) is merged to `main`. Work on a branch off `main`. Rust on PATH via `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin`.

---

## File structure

```
packages/cli/src/commands/host-ops.ts        # + runHostLogs (SSH `patchwire-agent log --json`)  [TDD]
packages/cli/test/commands/host-ops.test.ts   # + runHostLogs tests
packages/cli/src/cli.ts                       # register host-logs command
packages/desktop/src-tauri/src/lib.rs         # + host_logs command
packages/desktop/src/host-logs.ts             # PURE parseHostLogs() + formatLogEntry()  [TDD]
packages/desktop/src/host-logs.test.ts
packages/desktop/src/ipc.ts                   # + hostLogs()
packages/desktop/src/main.ts                  # 'logs' view + Logs button on cards
packages/desktop/src/styles.css               # log view styles
```

---

### Task 1: CLI `runHostLogs` (SSH → `patchwire-agent log --json`) — TDD

**Files:** Modify `packages/cli/src/commands/host-ops.ts`, `packages/cli/test/commands/host-ops.test.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/cli/test/commands/host-ops.test.ts` (reuses the file's `captureStdout` + `INPUT`):
```ts
describe('runHostLogs', () => {
  it('parses NDJSON entries → {ok:true, entries}', async () => {
    const stdout = '{"ts":"2026-06-14T00:00:00Z","user":"admin","project":"demo","route":"/ask"}\n{"ts":"2026-06-14T00:01:00Z","user":"admin","project":"demo","route":"/chat"}';
    let cmd = '';
    const ssh = async (o: { command: string }) => { cmd = o.command; return { code: 0, stdout, stderr: '' }; };
    const { runHostLogs } = await import('../../src/commands/host-ops.ts');
    const out = await captureStdout(() => runHostLogs(INPUT, { limit: 50 }, { ssh }));
    const parsed = JSON.parse(out) as { ok: boolean; entries: unknown[] };
    expect(parsed.ok).toBe(true);
    expect(parsed.entries).toHaveLength(2);
    expect(cmd).toContain('patchwire-agent log --json --limit 50');
  });
  it('empty log ("(no entries)") → ok with []', async () => {
    const ssh = async () => ({ code: 0, stdout: '(no entries)', stderr: '' });
    const { runHostLogs } = await import('../../src/commands/host-ops.ts');
    const out = await captureStdout(() => runHostLogs(INPUT, {}, { ssh }));
    expect(JSON.parse(out)).toEqual({ ok: true, entries: [] });
  });
  it('ssh failure → {ok:false, code:log_failed}', async () => {
    const ssh = async () => ({ code: 255, stdout: '', stderr: 'Connection refused' });
    const { runHostLogs } = await import('../../src/commands/host-ops.ts');
    const out = await captureStdout(() => runHostLogs(INPUT, {}, { ssh }));
    expect(JSON.parse(out)).toMatchObject({ ok: false, code: 'log_failed' });
  });
  it('defaults limit to 100 and rejects non-positive', async () => {
    let cmd = '';
    const ssh = async (o: { command: string }) => { cmd = o.command; return { code: 0, stdout: '(no entries)', stderr: '' }; };
    const { runHostLogs } = await import('../../src/commands/host-ops.ts');
    await captureStdout(() => runHostLogs(INPUT, { limit: -5 }, { ssh }));
    expect(cmd).toContain('--limit 100');
  });
  it('rejects bad input before ssh', async () => {
    let called = false;
    const ssh = async () => { called = true; return { code: 0, stdout: '', stderr: '' }; };
    const { runHostLogs } = await import('../../src/commands/host-ops.ts');
    await captureStdout(() => runHostLogs({ ...INPUT, host: '-x' }, {}, { ssh }));
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd packages/cli && node_modules/.bin/vitest run test/commands/host-ops.test.ts -t "runHostLogs"`
Expected: FAIL (`runHostLogs` not exported).

- [ ] **Step 3: Implement (append to `host-ops.ts`)**

```ts
export async function runHostLogs(
  input: HostOpInput,
  opts: { limit?: number } = {},
  deps: { ssh?: SshRunner } = {},
): Promise<void> {
  const bad = badHostField(input);
  if (bad) { emit({ ok: false, code: 'invalid_input', detail: `unsafe ${bad}` }); return; }
  const limit = Number.isInteger(opts.limit) && (opts.limit as number) > 0 && (opts.limit as number) <= 1000
    ? (opts.limit as number) : 100;
  const ssh = deps.ssh ?? runSsh;
  const command = `bash -lc '${POSIX_PATH_PREFIX}${POSIX_PNPM_ENV}patchwire-agent log --json --limit ${limit}'`;
  const r = await ssh({ host: input.host, user: input.user, port: input.port, keyPath: input.keyPath, command });
  if (r.code !== 0) { emit({ ok: false, code: 'log_failed', detail: (r.stderr || r.stdout || 'log fetch failed').trim() }); return; }
  const entries = r.stdout.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{'))
    .map((l) => { try { return JSON.parse(l) as unknown; } catch { return null; } })
    .filter((e): e is unknown => e !== null);
  emit({ ok: true, entries });
}
```
(`limit` is range-validated to a positive integer ≤1000, so its interpolation into the command is injection-safe.)

- [ ] **Step 4: Run, expect PASS**

Run: `cd packages/cli && node_modules/.bin/vitest run test/commands/host-ops.test.ts`
Expected: PASS (the 7 existing + 5 new = 12).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/host-ops.ts packages/cli/test/commands/host-ops.test.ts
git commit -m "feat(cli): host-logs core — SSH patchwire-agent log --json with tests"
```

---

### Task 2: Register `host-logs` CLI command

**Files:** Modify `packages/cli/src/cli.ts`.

- [ ] **Step 1: Add the command (mirrors host-check, plus --limit)**

In `packages/cli/src/cli.ts`, alongside `host-check`/`host-uninstall` on `program`:
```ts
program
  .command('host-logs')
  .description('SSH to a provisioned host and fetch the agent audit log as JSON {ok,entries}')
  .requiredOption('--host <host>')
  .requiredOption('--user <user>')
  .option('--ssh-port <n>', 'SSH port', (v: string) => Number(v), 22)
  .requiredOption('--key-path <path>')
  .option('--agent-port <n>', 'agent HTTP port', (v: string) => Number(v), 7878)
  .option('--limit <n>', 'last N log entries', (v: string) => Number(v), 100)
  .action(async (o) => {
    const { runHostLogs } = await import('./commands/host-ops.ts');
    await runHostLogs(
      { host: o.host, user: o.user, port: o.sshPort, keyPath: o.keyPath, agentPort: o.agentPort },
      { limit: o.limit },
    );
  });
```

- [ ] **Step 2: Typecheck + help**

Run: `cd packages/cli && node_modules/.bin/tsc --noEmit && pnpm build >/dev/null && node dist/cli.js --help | grep host-logs`
Expected: tsc clean; `host-logs` listed.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/cli.ts
git commit -m "feat(cli): expose host-logs command"
```

---

### Task 3: Desktop Rust `host_logs`

**Files:** Modify `packages/desktop/src-tauri/src/lib.rs`.

- [ ] **Step 1: Add the command**

In `packages/desktop/src-tauri/src/lib.rs` add (reuses `HostArgs` + `validate_host` from Phase 3b):
```rust
#[tauri::command]
async fn host_logs(app: tauri::AppHandle, args: HostArgs, limit: u32) -> Result<String, String> {
    let key = validate_host(&args)?;
    let out = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?
        .args([
            "host-logs",
            "--host", &args.host,
            "--user", &args.user,
            "--ssh-port", &args.port.to_string(),
            "--key-path", &key,
            "--agent-port", &args.agent_port.to_string(),
            "--limit", &limit.to_string(),
        ])
        .output().await.map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}
```
Register `host_logs` in `tauri::generate_handler![...]`.

- [ ] **Step 2: cargo check**

Run: `export PATH="/opt/homebrew/bin:$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && cd packages/desktop/src-tauri && cargo check`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): host_logs Tauri command (one-shot sidecar)"
```

---

### Task 4: Pure `parseHostLogs` + `formatLogEntry` (TDD) + IPC

**Files:** Create `packages/desktop/src/host-logs.ts`, Test `packages/desktop/src/host-logs.test.ts`; Modify `packages/desktop/src/ipc.ts`.

- [ ] **Step 1: Write the failing tests**

Create `packages/desktop/src/host-logs.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseHostLogs, formatLogEntry } from './host-logs.ts';

describe('parseHostLogs', () => {
  it('ok with entries', () => {
    const line = JSON.stringify({ ok: true, entries: [{ ts: 't1', user: 'u', project: 'p', route: '/ask' }] });
    expect(parseHostLogs(line)).toEqual({ ok: true, entries: [{ ts: 't1', user: 'u', project: 'p', route: '/ask' }] });
  });
  it('failure line → ok:false', () => {
    expect(parseHostLogs('{"ok":false,"code":"log_failed","detail":"x"}')).toMatchObject({ ok: false });
  });
  it('garbage → ok:false', () => {
    expect(parseHostLogs('not json')).toEqual({ ok: false, entries: [] });
  });
});

describe('formatLogEntry', () => {
  it('formats ts/user/project/route', () => {
    expect(formatLogEntry({ ts: '2026-06-14T00:00:00Z', user: 'admin', project: 'demo', route: '/ask' }))
      .toBe('2026-06-14T00:00:00Z  admin  demo  /ask');
  });
  it('tolerates missing fields', () => {
    expect(formatLogEntry({ ts: 't' })).toBe('t  ?  ?  ?');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd packages/desktop && node_modules/.bin/vitest run src/host-logs.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `host-logs.ts`**

```ts
export interface LogEntry { ts?: string; user?: string; project?: string; route?: string; [k: string]: unknown }

export function parseHostLogs(line: string): { ok: boolean; entries: LogEntry[]; detail?: string } {
  try {
    const r = JSON.parse(line) as { ok?: boolean; entries?: LogEntry[]; detail?: string };
    if (r.ok) return { ok: true, entries: r.entries ?? [] };
    return { ok: false, entries: [], detail: r.detail };
  } catch {
    return { ok: false, entries: [] };
  }
}

export function formatLogEntry(e: LogEntry): string {
  return `${e.ts ?? '?'}  ${e.user ?? '?'}  ${e.project ?? '?'}  ${e.route ?? '?'}`;
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd packages/desktop && node_modules/.bin/vitest run src/host-logs.test.ts`
Expected: PASS (5).

- [ ] **Step 5: IPC wrapper**

In `packages/desktop/src/ipc.ts` add:
```ts
export const hostLogs = (args: HostArgs, limit: number) => invoke<string>('host_logs', { args, limit });
```

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/host-logs.ts packages/desktop/src/host-logs.test.ts packages/desktop/src/ipc.ts
git commit -m "feat(desktop): parseHostLogs/formatLogEntry helpers + hostLogs IPC"
```

---

### Task 5: UI — 'logs' view + Logs button on cards

**Files:** Modify `packages/desktop/src/main.ts`, `packages/desktop/src/styles.css`.

- [ ] **Step 1: Add logs view state + loader**

In `packages/desktop/src/main.ts` add imports `hostLogs` from './ipc.ts' and `parseHostLogs, formatLogEntry, type LogEntry` from './host-logs.ts'. Extend the `view` type to include `'logs'` and add state + a loader:
```ts
// change: let view: 'wizard' | 'hosts' | 'logs' = 'wizard';
let logHost: HostRecord | undefined;
let logState: { loading: boolean; error?: string; entries: LogEntry[] } = { loading: false, entries: [] };

async function openLogs(r: HostRecord) {
  logHost = r;
  logState = { loading: true, entries: [] };
  view = 'logs';
  render();
  try {
    const res = parseHostLogs(await hostLogs(hostArgsOf(r), 100));
    logState = res.ok ? { loading: false, entries: res.entries } : { loading: false, error: res.detail ?? 'failed to fetch logs', entries: [] };
  } catch (e) {
    logState = { loading: false, error: String(e), entries: [] };
  }
  render();
}
```

- [ ] **Step 2: Render the logs view + a Logs button on each card**

In `render()`, add a branch before the wizard branch:
```ts
  if (view === 'logs') { renderLogs(); return; }
```
Add `renderLogs()`:
```ts
function renderLogs() {
  root.append(
    h('button', { events: { click: () => { view = 'hosts'; render(); } } }, '← Back to hosts'),
    h('h3', {}, `Logs — ${logHost?.label ?? ''}`),
    logState.loading ? h('p', {}, 'Loading…') : null,
    logState.error ? h('p', { className: 'result-rolled-back' }, logState.error) : null,
    !logState.loading && !logState.error && !logState.entries.length ? h('p', { className: 'empty' }, 'No log entries.') : null,
    logState.entries.length
      ? h('pre', { className: 'logview' }, logState.entries.map(formatLogEntry).join('\n'))
      : null,
  );
}
```
In `renderHosts()`'s card, add a Logs button (after Check):
```ts
        h('button', { events: { click: () => openLogs(r) } }, 'Logs'),
```
(Final card buttons: Check, Logs, Re-run, Remove, Uninstall.)

- [ ] **Step 3: Styles**

Append to `packages/desktop/src/styles.css`:
```css
.logview { font-family: ui-monospace, monospace; font-size: 0.8em; white-space: pre-wrap; max-height: 60vh; overflow: auto; background: #111; padding: 8px; border-radius: 6px; }
```

- [ ] **Step 4: Typecheck + tests**

Run: `cd packages/desktop && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run`
Expected: tsc clean; all pass (stage-sidecar 6, provision-state 6, host-record 1, inventory 4, host-health 4, host-logs 5 = 26).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main.ts packages/desktop/src/styles.css
git commit -m "feat(desktop): host log viewer ('logs' view + Logs button on cards)"
```

---

### Task 6: End-to-end verification (real CLI, localhost)

**Files:** none (manual; document).

- [ ] **Step 1: Rebuild CLI + restage sidecar**

```bash
export PATH="/opt/homebrew/bin:$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"
cd /Users/apple/Documents/Workspace/patchwire
pnpm --filter @rebink/patchwire build
cd packages/desktop && node scripts/stage-sidecar.mjs
```

- [ ] **Step 2: host-logs against localhost**

```bash
cd packages/desktop
./src-tauri/binaries/patchwire-aarch64-apple-darwin host-logs \
  --host 127.0.0.1 --user "$USER" --key-path "$HOME/.ssh/pw_validate" --ssh-port 22 --limit 20
```
Expected: a single JSON line `{"ok":true,"entries":[…]}`. With no agent ever run on this box, `patchwire-agent` is absent → `bash: patchwire-agent: command not found` → exit nonzero → `{"ok":false,"code":"log_failed",…}` (graceful). If `~/.patchwire/agent.log` exists from a prior agent and patchwire-agent is installed → real entries (or empty `entries:[]`). Either proves the SSH log-fetch path.

- [ ] **Step 3: App launch**

`pnpm tauri dev` → builds + launches with the logs view, no panic. (Interactive Logs-button click left to the operator.)

- [ ] **Step 4: Record + commit**

Append a "Phase 3b-ii verified" note (date + the host-logs JSON observed) to a new `docs/superpowers/validation/2026-06-14-desktop-phase3b-ii.md`. Commit.

---

## Self-review notes

- **Spec coverage:** implements the deferred **log viewing** for the inventory (`host-logs` CLI + `host_logs` Tauri command + a 'logs' view reached from a Logs button). Stronghold (3c) and release/signing (3d) remain out of scope; live tailing is out of scope (point-in-time last-N fetch).
- **Placeholder scan:** every code step is complete. The `agent-port` flag on `host-logs` is unused by `patchwire-agent log` (which reads a file) but kept for a uniform host-op flag set + `HostArgs` reuse — harmless, noted.
- **Type consistency:** `runHostLogs(input,opts,deps)` reuses `HostOpInput`/`badHostField`/`SshRunner` (Phase 3b); the subcommand is `patchwire-agent log` (registered as `log`, verified — NOT `agent-log`); `host_logs` (Rust) ↔ `hostLogs` (ipc, `{args,limit}`) ↔ `HostArgs` camelCase; `parseHostLogs`/`formatLogEntry`/`LogEntry` consume the `{ok,entries}` shape `runHostLogs` emits; `view` union extended to include `'logs'`; card button set Check/Logs/Re-run/Remove/Uninstall.
- **Risk:** Rust (Task 3) + UI (Task 5) aren't unit-tested (Tauri context) — covered by `cargo check`, `tsc`, the Task 6 live run. TDD'd units: `runHostLogs` (CLI), `parseHostLogs`/`formatLogEntry` (desktop). `limit` is range-validated (≤1000, positive) so its interpolation is injection-safe.
