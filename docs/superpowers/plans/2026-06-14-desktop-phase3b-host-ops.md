# Desktop Phase 3b — live health + remote uninstall (SSH host ops) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop inventory's host cards actionable — a live **Check** (re-probe the agent's health over SSH) and an **Uninstall** (tear the agent down on the remote over SSH) — via two new CLI commands the desktop drives as a sidecar.

**Architecture:** Two new CLI commands (`host-check`, `host-uninstall`) SSH to an already-provisioned host using its saved key and (a) probe the agent's `/health` on the host **loopback** (`curl` on the host — the agent stays loopback-bound, never network-exposed), or (b) run `patchwire-agent uninstall`. Both emit one JSON line and are TDD'd with an injected SSH runner. The desktop adds `host_health`/`host_uninstall` Tauri commands (one-shot sidecar `.output()`) and wires a Check button (updates the card's live badge) + an Uninstall button (confirm → run → refresh) into the existing Hosts view.

**Tech Stack:** TypeScript (CLI + desktop UI), Rust (Tauri commands), Tauri v2 `tauri-plugin-shell`, vitest. Reuses `runSsh` (`src/lib/ssh-runner.ts`) and `POSIX_PATH_PREFIX`/`POSIX_PNPM_ENV` (`src/agent/provision/primitives.ts`). No token/secret needed (health is unauthenticated; uninstall is key-based).

**Scope:** Phase 3b = **live health + remote uninstall** only. **Deferred:** log viewing (**3b-ii** — needs a log-viewer view + `agent-log`-over-SSH); stronghold (**3c**); release sidecar + signing (**3d**). Health probe is **POSIX (`curl`)**; Windows host probing is deferred to the team Windows validation.

**Prerequisites:** Phase 3a (inventory) is merged to `main`. Work on a branch off `main`. Rust on PATH via `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin`.

---

## File structure

```
packages/cli/src/commands/host-ops.ts        # runHostCheck + runHostUninstall (injected SSH runner)  [TDD]
packages/cli/test/commands/host-ops.test.ts
packages/cli/src/cli.ts                       # register host-check + host-uninstall commands
packages/desktop/src-tauri/src/lib.rs         # HostArgs + host_health + host_uninstall commands
packages/desktop/src/host-health.ts           # PURE parseHostHealth() -> badge  [TDD]
packages/desktop/src/host-health.test.ts
packages/desktop/src/ipc.ts                   # + hostHealth(), hostUninstall()
packages/desktop/src/main.ts                  # Check + Uninstall buttons on host cards
packages/desktop/src/styles.css               # live-badge / uninstall styles
```

---

### Task 1: CLI `runHostCheck` (SSH → agent /health) — TDD

**Files:** Create `packages/cli/src/commands/host-ops.ts`, Test `packages/cli/test/commands/host-ops.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/cli/test/commands/host-ops.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

function captureStdout(fn: () => Promise<void>): Promise<string> {
  const writes: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((c: unknown) => { writes.push(String(c)); return true; }) as typeof process.stdout.write;
  return fn().finally(() => { process.stdout.write = orig; }).then(() => writes.join(''));
}
const INPUT = { host: '10.0.0.2', user: 'admin', port: 22, keyPath: '/k', agentPort: 7878 };

describe('runHostCheck', () => {
  it('healthy agent → {ok:true, healthy:true, version}', async () => {
    const ssh = async () => ({ code: 0, stdout: '{"ok":true,"version":"0.3.18","claude":{"found":true}}', stderr: '' });
    const { runHostCheck } = await import('../../src/commands/host-ops.ts');
    const out = await captureStdout(() => runHostCheck(INPUT, { ssh }));
    expect(JSON.parse(out)).toMatchObject({ ok: true, healthy: true, version: '0.3.18' });
  });
  it('agent unreachable → {ok:false, code:unreachable}', async () => {
    const ssh = async () => ({ code: 0, stdout: 'PW_UNREACHABLE', stderr: '' });
    const { runHostCheck } = await import('../../src/commands/host-ops.ts');
    const out = await captureStdout(() => runHostCheck(INPUT, { ssh }));
    expect(JSON.parse(out)).toMatchObject({ ok: false, code: 'unreachable' });
  });
  it('ssh failure (nonzero) → unreachable', async () => {
    const ssh = async () => ({ code: 255, stdout: '', stderr: 'Connection refused' });
    const { runHostCheck } = await import('../../src/commands/host-ops.ts');
    const out = await captureStdout(() => runHostCheck(INPUT, { ssh }));
    expect(JSON.parse(out)).toMatchObject({ ok: false, code: 'unreachable' });
  });
  it('rejects an option-injection host → invalid_input, no ssh', async () => {
    let called = false;
    const ssh = async () => { called = true; return { code: 0, stdout: '', stderr: '' }; };
    const { runHostCheck } = await import('../../src/commands/host-ops.ts');
    const out = await captureStdout(() => runHostCheck({ ...INPUT, host: '-oProxyCommand=x' }, { ssh }));
    expect(called).toBe(false);
    expect(JSON.parse(out)).toMatchObject({ ok: false, code: 'invalid_input' });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd packages/cli && node_modules/.bin/vitest run test/commands/host-ops.test.ts -t "runHostCheck"`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `host-ops.ts` (host-check half)**

Create `packages/cli/src/commands/host-ops.ts`:
```ts
import { runSsh, type SshOpts } from '../lib/ssh-runner.ts';
import { POSIX_PATH_PREFIX, POSIX_PNPM_ENV } from '../agent/provision/primitives.ts';

export interface HostOpInput { host: string; user: string; port: number; keyPath: string; agentPort: number; }
export type SshRunner = (opts: SshOpts) => Promise<{ code: number | null; stdout: string; stderr: string }>;

const HOST_RE = /^[A-Za-z0-9._:-]+$/;
const USER_RE = /^[A-Za-z0-9._-]+$/;
/** Reject option-injection / malformed connection fields before building the ssh argv. */
export function badHostField(i: HostOpInput): string | null {
  if (i.host.startsWith('-') || !HOST_RE.test(i.host)) return 'host';
  if (i.user.startsWith('-') || !USER_RE.test(i.user)) return 'user';
  if (i.keyPath.startsWith('-') || i.keyPath === '') return 'keyPath';
  if (!Number.isInteger(i.port) || i.port < 1 || i.port > 65535) return 'port';
  if (!Number.isInteger(i.agentPort) || i.agentPort < 1 || i.agentPort > 65535) return 'agentPort';
  return null;
}

function emit(o: unknown) { process.stdout.write(JSON.stringify(o) + '\n'); }

export async function runHostCheck(input: HostOpInput, deps: { ssh?: SshRunner } = {}): Promise<void> {
  const bad = badHostField(input);
  if (bad) { emit({ ok: false, code: 'invalid_input', detail: `unsafe ${bad}` }); return; }
  const ssh = deps.ssh ?? runSsh;
  // Probe the agent on the host's loopback (the agent is never network-exposed).
  const command = `curl -fsS -m 5 http://127.0.0.1:${input.agentPort}/health 2>/dev/null || echo PW_UNREACHABLE`;
  const r = await ssh({ host: input.host, user: input.user, port: input.port, keyPath: input.keyPath, command });
  const out = r.stdout.trim();
  if (r.code !== 0 || out === '' || out.includes('PW_UNREACHABLE')) {
    emit({ ok: false, code: 'unreachable', detail: (r.stderr || 'agent not reachable on the host').trim() });
    return;
  }
  try {
    const h = JSON.parse(out) as { ok?: boolean; version?: string };
    emit({ ok: true, healthy: h.ok === true, version: h.version });
  } catch {
    emit({ ok: false, code: 'bad_response', detail: out.slice(0, 120) });
  }
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd packages/cli && node_modules/.bin/vitest run test/commands/host-ops.test.ts -t "runHostCheck"`
Expected: PASS (4).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/host-ops.ts packages/cli/test/commands/host-ops.test.ts
git commit -m "feat(cli): host-check — SSH probe of agent /health (JSON) with tests"
```

---

### Task 2: CLI `runHostUninstall` (SSH → patchwire-agent uninstall) — TDD

**Files:** Modify `packages/cli/src/commands/host-ops.ts`, `packages/cli/test/commands/host-ops.test.ts`.

- [ ] **Step 1: Write the failing test**

Append to `host-ops.test.ts`:
```ts
describe('runHostUninstall', () => {
  it('ssh ok → {ok:true} and runs patchwire-agent uninstall', async () => {
    let cmd = '';
    const ssh = async (o: { command: string }) => { cmd = o.command; return { code: 0, stdout: 'removed', stderr: '' }; };
    const { runHostUninstall } = await import('../../src/commands/host-ops.ts');
    const out = await captureStdout(() => runHostUninstall(INPUT, { ssh }));
    expect(JSON.parse(out)).toMatchObject({ ok: true });
    expect(cmd).toContain('patchwire-agent uninstall');
  });
  it('ssh nonzero → {ok:false, code:uninstall_failed}', async () => {
    const ssh = async () => ({ code: 1, stdout: '', stderr: 'no service' });
    const { runHostUninstall } = await import('../../src/commands/host-ops.ts');
    const out = await captureStdout(() => runHostUninstall(INPUT, { ssh }));
    expect(JSON.parse(out)).toMatchObject({ ok: false, code: 'uninstall_failed', detail: 'no service' });
  });
  it('rejects bad input', async () => {
    let called = false;
    const ssh = async () => { called = true; return { code: 0, stdout: '', stderr: '' }; };
    const { runHostUninstall } = await import('../../src/commands/host-ops.ts');
    await captureStdout(() => runHostUninstall({ ...INPUT, keyPath: '-x' }, { ssh }));
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd packages/cli && node_modules/.bin/vitest run test/commands/host-ops.test.ts -t "runHostUninstall"`
Expected: FAIL (`runHostUninstall` not exported).

- [ ] **Step 3: Implement (append to `host-ops.ts`)**

```ts
export async function runHostUninstall(input: HostOpInput, deps: { ssh?: SshRunner } = {}): Promise<void> {
  const bad = badHostField(input);
  if (bad) { emit({ ok: false, code: 'invalid_input', detail: `unsafe ${bad}` }); return; }
  const ssh = deps.ssh ?? runSsh;
  // login shell + the same PATH/pnpm env the provisioner used, so patchwire-agent is found.
  const command = `bash -lc '${POSIX_PATH_PREFIX}${POSIX_PNPM_ENV}patchwire-agent uninstall'`;
  const r = await ssh({ host: input.host, user: input.user, port: input.port, keyPath: input.keyPath, command });
  if (r.code === 0) emit({ ok: true });
  else emit({ ok: false, code: 'uninstall_failed', detail: (r.stderr || r.stdout || 'uninstall failed').trim() });
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd packages/cli && node_modules/.bin/vitest run test/commands/host-ops.test.ts`
Expected: PASS (all 7).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/host-ops.ts packages/cli/test/commands/host-ops.test.ts
git commit -m "feat(cli): host-uninstall — SSH patchwire-agent uninstall (JSON) with tests"
```

---

### Task 3: Register `host-check` + `host-uninstall` CLI commands

**Files:** Modify `packages/cli/src/cli.ts`.

- [ ] **Step 1: Add both commands**

In `packages/cli/src/cli.ts` (follow the existing `.command(...).option(...).action(...)` style), add:
```ts
program
  .command('host-check')
  .description('SSH to a provisioned host and report the agent /health as JSON')
  .requiredOption('--host <host>')
  .requiredOption('--user <user>')
  .option('--ssh-port <n>', 'SSH port', (v: string) => Number(v), 22)
  .requiredOption('--key-path <path>')
  .option('--agent-port <n>', 'agent HTTP port', (v: string) => Number(v), 7878)
  .action(async (o) => {
    const { runHostCheck } = await import('./commands/host-ops.ts');
    await runHostCheck({ host: o.host, user: o.user, port: o.sshPort, keyPath: o.keyPath, agentPort: o.agentPort });
  });

program
  .command('host-uninstall')
  .description('SSH to a provisioned host and uninstall the agent; reports JSON')
  .requiredOption('--host <host>')
  .requiredOption('--user <user>')
  .option('--ssh-port <n>', 'SSH port', (v: string) => Number(v), 22)
  .requiredOption('--key-path <path>')
  .option('--agent-port <n>', 'agent HTTP port', (v: string) => Number(v), 7878)
  .action(async (o) => {
    const { runHostUninstall } = await import('./commands/host-ops.ts');
    await runHostUninstall({ host: o.host, user: o.user, port: o.sshPort, keyPath: o.keyPath, agentPort: o.agentPort });
  });
```
(`program` is the existing Commander root in cli.ts; match how other commands reference it — if they use a different local name, use that.)

- [ ] **Step 2: Typecheck + smoke**

Run: `cd packages/cli && node_modules/.bin/tsc --noEmit && node dist/cli.js --help 2>/dev/null | grep -E "host-check|host-uninstall" || (pnpm build >/dev/null && node dist/cli.js --help | grep host-)`
Expected: tsc clean; `host-check` + `host-uninstall` listed in help.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/cli.ts
git commit -m "feat(cli): expose host-check + host-uninstall commands"
```

---

### Task 4: Desktop Rust — `host_health` + `host_uninstall`

**Files:** Modify `packages/desktop/src-tauri/src/lib.rs`.

- [ ] **Step 1: Add a HostArgs struct + a key-resolving validator, and the two commands**

In `packages/desktop/src-tauri/src/lib.rs` add (reuses the `~/` expansion + option-injection guards from `validate_and_resolve`, minus the token):
```rust
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct HostArgs {
    host: String,
    user: String,
    port: u16,
    key_path: String,
    agent_port: u16,
}

fn validate_host(args: &HostArgs) -> Result<String, String> {
    if args.host.is_empty() || args.host.starts_with('-')
        || !args.host.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '[' | ']')) {
        return Err("invalid host".into());
    }
    let mut uc = args.user.chars();
    let user_ok = matches!(uc.next(), Some(c) if c.is_ascii_alphabetic() || c == '_')
        && args.user.len() <= 32
        && args.user.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'));
    if !user_ok { return Err("invalid user".into()); }
    if args.key_path.starts_with('-') { return Err("invalid key_path".into()); }
    let resolved = if let Some(rest) = args.key_path.strip_prefix("~/") {
        format!("{}/{}", std::env::var("HOME").map_err(|_| "HOME not set".to_string())?, rest)
    } else { args.key_path.clone() };
    if !std::path::Path::new(&resolved).exists() { return Err(format!("key_path does not exist: {resolved}")); }
    Ok(resolved)
}

async fn run_host_op(app: &tauri::AppHandle, verb: &str, args: &HostArgs) -> Result<String, String> {
    let key = validate_host(args)?;
    let out = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?
        .args([
            verb,
            "--host", &args.host,
            "--user", &args.user,
            "--ssh-port", &args.port.to_string(),
            "--key-path", &key,
            "--agent-port", &args.agent_port.to_string(),
        ])
        .output().await.map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[tauri::command]
async fn host_health(app: tauri::AppHandle, args: HostArgs) -> Result<String, String> {
    run_host_op(&app, "host-check", &args).await
}

#[tauri::command]
async fn host_uninstall(app: tauri::AppHandle, args: HostArgs) -> Result<String, String> {
    run_host_op(&app, "host-uninstall", &args).await
}
```
Register both: add `host_health, host_uninstall` to `tauri::generate_handler![...]`. (`.output()` needs `tauri_plugin_shell::ShellExt` — already imported.)

- [ ] **Step 2: cargo check**

Run: `export PATH="/opt/homebrew/bin:$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && cd packages/desktop/src-tauri && cargo check`
Expected: clean. (If `.output()` resolves to a different method name in this tauri-plugin-shell version, use the documented one-shot API; the streaming `.spawn()` from Phase 1 confirms the sidecar wiring.)

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): host_health + host_uninstall Tauri commands (one-shot sidecar)"
```

---

### Task 5: Pure `parseHostHealth` + IPC wrappers

**Files:** Create `packages/desktop/src/host-health.ts`, Test `packages/desktop/src/host-health.test.ts`; Modify `packages/desktop/src/ipc.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/desktop/src/host-health.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseHostHealth } from './host-health.ts';

describe('parseHostHealth', () => {
  it('healthy → ok badge', () => {
    expect(parseHostHealth('{"ok":true,"healthy":true,"version":"0.3.18"}')).toEqual({ text: 'healthy 0.3.18', cls: 'badge-ok' });
  });
  it('reachable but unhealthy → warn', () => {
    expect(parseHostHealth('{"ok":true,"healthy":false}')).toEqual({ text: 'unhealthy', cls: 'badge-warn' });
  });
  it('unreachable → failed', () => {
    expect(parseHostHealth('{"ok":false,"code":"unreachable"}')).toEqual({ text: 'unreachable', cls: 'badge-failed' });
  });
  it('garbage → failed', () => {
    expect(parseHostHealth('not json')).toEqual({ text: 'error', cls: 'badge-failed' });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd packages/desktop && node_modules/.bin/vitest run src/host-health.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `host-health.ts`**

```ts
/** Map a host-check JSON line to a live status badge. */
export function parseHostHealth(line: string): { text: string; cls: string } {
  try {
    const r = JSON.parse(line) as { ok?: boolean; healthy?: boolean; version?: string; code?: string };
    if (r.ok && r.healthy) return { text: `healthy${r.version ? ` ${r.version}` : ''}`, cls: 'badge-ok' };
    if (r.ok && !r.healthy) return { text: 'unhealthy', cls: 'badge-warn' };
    return { text: r.code ?? 'unreachable', cls: 'badge-failed' };
  } catch {
    return { text: 'error', cls: 'badge-failed' };
  }
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd packages/desktop && node_modules/.bin/vitest run src/host-health.test.ts`
Expected: PASS (4).

- [ ] **Step 5: IPC wrappers**

In `packages/desktop/src/ipc.ts` add (HostArgs in Rust is camelCase; pass the same shape):
```ts
export interface HostArgs { host: string; user: string; port: number; keyPath: string; agentPort: number; }
export const hostHealth = (args: HostArgs) => invoke<string>('host_health', { args });
export const hostUninstall = (args: HostArgs) => invoke<string>('host_uninstall', { args });
```

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/host-health.ts packages/desktop/src/host-health.test.ts packages/desktop/src/ipc.ts
git commit -m "feat(desktop): parseHostHealth helper + hostHealth/hostUninstall IPC"
```

---

### Task 6: UI — Check + Uninstall buttons on host cards

**Files:** Modify `packages/desktop/src/main.ts`, `packages/desktop/src/styles.css`.

- [ ] **Step 1: Add a live-health cache + handlers**

In `packages/desktop/src/main.ts` add imports `hostHealth, hostUninstall, type HostArgs` from './ipc.ts' and `parseHostHealth` from './host-health.ts'. Add module state + handlers:
```ts
const liveHealth: Record<string, { text: string; cls: string }> = {};

function hostArgsOf(r: HostRecord): HostArgs {
  return { host: r.host, user: r.user, port: r.port, keyPath: r.keyPath, agentPort: r.agentPort };
}
async function checkHost(r: HostRecord) {
  liveHealth[r.id] = { text: 'checking…', cls: 'badge-warn' };
  render();
  try { liveHealth[r.id] = parseHostHealth(await hostHealth(hostArgsOf(r))); }
  catch (e) { liveHealth[r.id] = { text: 'error', cls: 'badge-failed' }; console.error('hostHealth failed', e); }
  render();
}
async function uninstallHost(r: HostRecord) {
  if (!confirm(`Uninstall the agent on ${r.label}? This stops + removes it on the remote.`)) return;
  liveHealth[r.id] = { text: 'uninstalling…', cls: 'badge-warn' };
  render();
  try {
    const res = JSON.parse(await hostUninstall(hostArgsOf(r))) as { ok?: boolean; detail?: string };
    liveHealth[r.id] = res.ok ? { text: 'uninstalled', cls: 'badge-failed' } : { text: 'uninstall failed', cls: 'badge-failed' };
  } catch (e) { liveHealth[r.id] = { text: 'error', cls: 'badge-failed' }; console.error('hostUninstall failed', e); }
  render();
}
```

- [ ] **Step 2: Render the buttons + live badge on each card**

In `renderHosts()`, change each card to prefer the live badge when present and add the two buttons. Replace the card construction in the `.map((r) => …)` with:
```ts
      const live = liveHealth[r.id];
      const b = live ?? hostBadge(r);
      return h('li', { className: 'host-card' },
        h('span', { className: `badge ${b.cls}` }, b.text),
        h('span', { className: 'host-label' }, r.label),
        h('span', { className: 'host-meta' }, `${r.lastStatus} · ${r.lastProvisionedAt}`),
        h('button', { events: { click: () => checkHost(r) } }, 'Check'),
        h('button', { events: { click: () => rerun(r) } }, 'Re-run'),
        h('button', { className: 'danger', events: { click: () => uninstallHost(r) } }, 'Uninstall'),
      );
```

- [ ] **Step 3: Styles**

Append to `packages/desktop/src/styles.css`:
```css
.host-card button.danger { color: #ff6b6b; }
```

- [ ] **Step 4: Typecheck + unit tests**

Run: `cd packages/desktop && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run`
Expected: tsc clean; all pass (stage-sidecar 6, provision-state 6, host-record 1, inventory 4, host-health 4 = 21).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main.ts packages/desktop/src/styles.css
git commit -m "feat(desktop): Check (live health) + Uninstall buttons on host cards"
```

---

### Task 7: End-to-end verification (real CLI, localhost)

**Files:** none (manual; document).

- [ ] **Step 1: Rebuild CLI + restage sidecar; ensure a localhost agent to probe**

```bash
export PATH="/opt/homebrew/bin:$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"
cd /Users/apple/Documents/Workspace/patchwire
pnpm --filter @rebink/patchwire build
cd packages/desktop && node scripts/stage-sidecar.mjs
```

- [ ] **Step 2: host-check against localhost (CLI directly)**

```bash
cd packages/desktop
./src-tauri/binaries/patchwire-aarch64-apple-darwin host-check \
  --host 127.0.0.1 --user "$USER" --key-path "$HOME/.ssh/pw_validate" --ssh-port 22 --agent-port 7878
```
Expected: a single JSON line. With **no agent running** on `:7878` → `{"ok":false,"code":"unreachable",…}` (correct). If you have an agent up on loopback → `{"ok":true,"healthy":true,"version":"0.3.18"}`. Either proves the SSH probe path end-to-end.

- [ ] **Step 3: host-uninstall safety (no agent installed → reports failure, not a crash)**

```bash
./src-tauri/binaries/patchwire-aarch64-apple-darwin host-uninstall \
  --host 127.0.0.1 --user "$USER" --key-path "$HOME/.ssh/pw_validate" --ssh-port 22 --agent-port 7878
```
Expected: `{"ok":false,"code":"uninstall_failed",…}` when nothing is installed (graceful), or `{"ok":true}` if an agent was present. No crash.

- [ ] **Step 4: App launch**

`pnpm tauri dev` → builds + launches, no panic. (Interactive Check/Uninstall clicks are left to the operator.)

- [ ] **Step 5: Record + commit**

Append a "Phase 3b verified" note (date + the host-check/host-uninstall JSON observed) to a new `docs/superpowers/validation/2026-06-14-desktop-phase3b.md`. Commit.

---

## Self-review notes

- **Spec coverage:** implements the networked-inventory actions the spec deferred — **live health** (`host-check`) and **remote uninstall** (`host-uninstall`), surfaced as card buttons. Both keep the agent **loopback-bound** (probe via SSH, no network exposure). **Log viewing is explicitly deferred to 3b-ii**; stronghold (3c) and release/signing (3d) are out of scope.
- **Placeholder scan:** every code step is complete. The Task 4 note about `.output()` is a version-API confirmation (the one-shot sidecar call), not a placeholder — the method is `tauri-plugin-shell`'s documented one-shot; fall back only if the exact name differs.
- **Type consistency:** `HostOpInput` (CLI) and `HostArgs` (Rust + ipc.ts) carry the same fields (host/user/port/keyPath/agentPort, no token); CLI flags `--host/--user/--ssh-port/--key-path/--agent-port` map to those; Rust `host_health`/`host_uninstall` ↔ ipc `hostHealth`/`hostUninstall`; badge classes (`badge-ok/warn/failed`) reuse the Phase-3a CSS; `parseHostHealth` consumes the `host-check` JSON shape (`{ok,healthy,version,code}`) exactly as emitted by `runHostCheck`.
- **Risk:** Rust (Task 4) + UI (Task 6) aren't unit-tested (Tauri needs app context) — covered by `cargo check`, `tsc`, and the Task 7 live run. TDD'd units: `runHostCheck`/`runHostUninstall` (CLI) + `parseHostHealth` (desktop). Windows host probing (curl) is out of scope (POSIX-only this phase).
