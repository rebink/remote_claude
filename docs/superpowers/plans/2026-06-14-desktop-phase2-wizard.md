# Desktop Phase 2 — Wizard UX + token-via-stdin + host persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the minimal Phase 1 desktop screen into a real provisioning wizard — per-step progress with status, degraded/failure/rollback handling, and a health result — while removing the agent token from process argv (pass it over the sidecar's stdin) and persisting a host record on success.

**Architecture:** Three cohesive changes. (1) CLI `setup --provision-remote` gains `--token-stdin`: in stream mode it reads a `{"token":"…"}` line from stdin before the consent line, so the token never appears in argv. (2) The desktop Rust `start_provision` drops `--token` argv, passes `--token-stdin`, and writes the token line to the child's stdin immediately after spawn (token still arrives from the UI over in-process IPC — never ps-visible). (3) The pure UI reducer is extended to track per-step status + result/health, the UI renders a step list, and a `save_host` Rust command upserts a secret-free host record into `hosts.json`.

**Tech Stack:** TypeScript (CLI + desktop UI), Rust (Tauri commands), vitest, Tauri v2 `tauri-plugin-shell` + `tauri-plugin-fs`/std fs. Rust on PATH via `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin`.

**Scope:** Phase 2 only. **Deferred to Phase 3:** the inventory UI (list/health-badges/logs/uninstall/re-run) and `tauri-plugin-stronghold` token storage (the persisted token is needed only once health/inventory consume it). Code signing + the release (bun-compiled) sidecar pipeline are later.

**Prerequisites:** Builds on Phase 1 (PR #59) and Phase 0 `--stream` (PR #58). Work on a branch based on `feat/desktop-phase1-tauri-skeleton`.

---

## File structure

```
packages/cli/src/commands/setup.ts        # + token-stdin read in runProvisionRemote
packages/cli/src/cli.ts                    # + --token-stdin option
packages/cli/test/commands/setup-provision-remote.test.ts   # + token-stdin tests
packages/desktop/src-tauri/src/lib.rs      # start_provision: --token-stdin + write token line; + save_host command; hosts.json IO
packages/desktop/src/provision-state.ts    # reducer: per-step status map, degraded[], result/health/failedStep
packages/desktop/src/provision-state.test.ts
packages/desktop/src/host-record.ts        # PURE buildHostRecord() [TDD]
packages/desktop/src/host-record.test.ts
packages/desktop/src/main.ts               # render step list + result; save host on success
packages/desktop/src/ipc.ts                # + saveHost wrapper
```

---

### Task 1: CLI — `--token-stdin` reads the token from stdin (stream mode)

**Files:** Modify `packages/cli/src/commands/setup.ts`, Test `packages/cli/test/commands/setup-provision-remote.test.ts`.

- [ ] **Step 1: Write the failing test**

Append to `packages/cli/test/commands/setup-provision-remote.test.ts`:
```ts
it('stream + tokenStdin → reads {"token":…} from stdin before consent', async () => {
  const lines = ['{"token":"streamedtokenABCDEF123456"}', '{"consent":true}'];
  let seenToken: string | undefined;
  const provision = fakeProvision(async (_conn, opts, deps) => {
    seenToken = opts.token;
    const ok = await deps.confirm({ steps: [] }, []);
    return { status: ok ? 'completed' : 'cancelled', detected: {}, plan: { steps: [] }, outcome: { status: 'completed', degraded: [] } };
  });
  const { runProvisionRemote } = await import('../../src/commands/setup.ts');
  await captureStdout(() =>
    runProvisionRemote(
      { host: 'h', user: 'u', port: 22, keyPath: '/k', agentPort: 7878, token: 'ARGV-IGNORED-000', stream: true, tokenStdin: true },
      { provision, readConsentLine: async () => lines.shift() ?? '' },
    ),
  );
  expect(seenToken).toBe('streamedtokenABCDEF123456');
});

it('tokenStdin with malformed token line → invalid_input, no provision', async () => {
  let called = false;
  const provision = fakeProvision(async () => { called = true; return { status: 'completed', detected: {}, plan: { steps: [] }, outcome: { status: 'completed', degraded: [] } }; });
  const { runProvisionRemote } = await import('../../src/commands/setup.ts');
  const out = await captureStdout(() =>
    runProvisionRemote(
      { host: 'h', user: 'u', port: 22, keyPath: '/k', agentPort: 7878, token: 'x', stream: true, tokenStdin: true },
      { provision, readConsentLine: async () => 'not json' },
    ),
  );
  expect(called).toBe(false);
  expect(out).toContain('invalid_input');
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd packages/cli && node_modules/.bin/vitest run test/commands/setup-provision-remote.test.ts -t "tokenStdin"`
Expected: FAIL (`tokenStdin` unhandled; token unchanged).

- [ ] **Step 3: Add `tokenStdin` to the input type**

In `packages/cli/src/commands/setup.ts`, add to `ProvisionRemoteInput` (next to `stream?`):
```ts
  /** In stream mode, read the agent token from a leading {"token":"…"} stdin line instead of argv. */
  tokenStdin?: boolean;
```

- [ ] **Step 4: Read the token before validation/provision**

In `runProvisionRemote`, AFTER `const readConsentLine = deps.readConsentLine ?? defaultReadConsentLine;` and BEFORE the `unsafeProvisionField` guard, insert:
```ts
  let token = input.token;
  if (input.stream && input.tokenStdin) {
    try {
      const parsed = JSON.parse(await readConsentLine()) as { token?: string };
      if (!parsed.token) throw new Error('no token');
      token = parsed.token;
    } catch {
      process.stdout.write(JSON.stringify({ ok: false, code: 'invalid_input', stderr: 'Refusing to provision: missing/invalid token on stdin.' }) + '\n');
      return;
    }
  }
```
Then change the existing validation + executor to use `token` instead of `input.token`:
- in the `unsafeProvisionField({... token: input.token ...})` call → `token,`
- in `const execOpts: RemoteExecutorOpts = { token: input.token, ... }` → `token,`

- [ ] **Step 5: Run the test, expect PASS**

Run: `cd packages/cli && node_modules/.bin/vitest run test/commands/setup-provision-remote.test.ts -t "tokenStdin"`
Expected: PASS (both).

- [ ] **Step 6: Run the whole provision-remote suite (no regressions)**

Run: `cd packages/cli && node_modules/.bin/vitest run test/commands/setup-provision-remote.test.ts && node_modules/.bin/tsc --noEmit`
Expected: all pass, tsc clean.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/commands/setup.ts packages/cli/test/commands/setup-provision-remote.test.ts
git commit -m "feat(cli): --token-stdin reads agent token from stdin in stream mode"
```

---

### Task 2: CLI — expose `--token-stdin` flag

**Files:** Modify `packages/cli/src/cli.ts`.

- [ ] **Step 1: Add the option + pass-through**

In `packages/cli/src/cli.ts`, on the `setup` command (next to `--stream`), add:
```ts
  .option('--token-stdin', 'read the agent token from a {"token":…} stdin line instead of --token (avoids argv exposure)')
```
In the `--provision-remote` action's `runProvisionRemote({ … })` call, add `tokenStdin: opts.tokenStdin,` and ensure the local opts type includes `tokenStdin?: boolean`.

- [ ] **Step 2: Typecheck**

Run: `cd packages/cli && node_modules/.bin/tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/cli.ts
git commit -m "feat(cli): expose setup --token-stdin flag"
```

---

### Task 3: Desktop Rust — send token over stdin, drop `--token` argv

**Files:** Modify `packages/desktop/src-tauri/src/lib.rs`.

- [ ] **Step 1: Change the spawn args + write the token line**

In `start_provision` (in `packages/desktop/src-tauri/src/lib.rs`): in the `.args([...])` array, **remove** the `"--token", &args.token,` pair and **add** `"--token-stdin",` (after `"--stream"`). Then, immediately after `*state.child.lock().unwrap() = Some(child);`, write the token line to the child's stdin. Because the child was moved into the state mutex, write BEFORE storing it instead — reorder so you hold `child` mutably: after `let (mut rx, mut child) = … .spawn()…?;` and after the busy-claim, do:
```rust
    // send the token over stdin (never via argv) before storing the child
    let token_line = format!("{{\"token\":\"{}\"}}\n", args.token);
    child.write(token_line.as_bytes()).map_err(|e| e.to_string())?;
    *state.child.lock().unwrap() = Some(child);
```
(Keep `child` as `mut`. The token is JSON-safe because `validate_and_resolve`/the CLI guard restricts the token to `[A-Za-z0-9_-]`, so no escaping is needed — but the value still comes from the validated `args.token`. Confirm `validate_and_resolve` already enforces the token grammar; it does.)

- [ ] **Step 2: cargo check**

Run: `export PATH="/opt/homebrew/bin:$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && cd packages/desktop/src-tauri && cargo check`
Expected: clean. (If `child` ownership conflicts with the reader task that needs `rx`, note: `rx` and `child` are separate halves — the reader task moves `rx`/`app`, the command keeps `child`; writing before storing is fine.)

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src-tauri/src/lib.rs
git commit -m "fix(desktop): pass agent token via stdin (--token-stdin), not argv"
```

---

### Task 4: Reducer — per-step status, degraded, result/health, failedStep (TDD)

**Files:** Modify `packages/desktop/src/provision-state.ts`, `packages/desktop/src/provision-state.test.ts`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/desktop/src/provision-state.test.ts`:
```ts
it('tracks per-step status as steps stream', () => {
  let s = reduce(initialState(), '{"type":"preview","plan":{"steps":[{"id":"a"},{"id":"b"}]},"elevation":[]}');
  s = reduce(s, '{"type":"step","step":"a","status":"start"}');
  s = reduce(s, '{"type":"step","step":"a","status":"ok","detail":"done"}');
  s = reduce(s, '{"type":"step","step":"b","status":"degraded","detail":"tailscale down"}');
  expect(s.stepStatus.a).toMatchObject({ status: 'ok', detail: 'done' });
  expect(s.stepStatus.b).toMatchObject({ status: 'degraded', detail: 'tailscale down' });
  expect(s.degraded).toContain('b');
});
it('result carries failedStep on rollback', () => {
  const s = reduce(initialState(), '{"type":"result","status":"rolled-back","outcome":{"status":"rolled-back","failedStep":"bootstrap-agent","degraded":[]}}');
  expect(s.phase).toBe('done');
  expect(s.result).toMatchObject({ status: 'rolled-back', failedStep: 'bootstrap-agent' });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd packages/desktop && node_modules/.bin/vitest run src/provision-state.test.ts -t "per-step|failedStep"`
Expected: FAIL (`stepStatus`/`degraded`/`failedStep` undefined).

- [ ] **Step 3: Extend the state + reducer**

In `packages/desktop/src/provision-state.ts`: extend `ProvisionUiState` and `initialState`, and handle `step` + `result` more fully:
```ts
export interface StepStatus { status: 'start' | 'ok' | 'degraded' | 'failed'; detail?: string }
export interface ProvisionUiState {
  phase: Phase;
  steps: StepRef[];
  elevation: string[];
  events: ProvEvent[];
  awaitingConsent: boolean;
  stepStatus: Record<string, StepStatus>;
  degraded: string[];
  result?: { status: string; failedStep?: string; health?: { tailnet: boolean; agent: string } };
}
export function initialState(): ProvisionUiState {
  return { phase: 'idle', steps: [], elevation: [], events: [], awaitingConsent: false, stepStatus: {}, degraded: [] };
}
```
In `reduce`, replace the `step` and `result` cases:
```ts
    case 'step': {
      next.phase = 'executing';
      next.awaitingConsent = false;
      const id = e.step as string;
      const status = e.status as StepStatus['status'];
      next.stepStatus = { ...state.stepStatus, [id]: { status, detail: e.detail as string | undefined } };
      next.degraded = status === 'degraded' && !state.degraded.includes(id)
        ? [...state.degraded, id] : state.degraded;
      return next;
    }
    case 'result': {
      next.phase = 'done';
      const outcome = e.outcome as { failedStep?: string } | undefined;
      next.result = {
        status: e.status as string,
        failedStep: outcome?.failedStep,
        health: e.health as ProvisionUiState['result']['health'],
      };
      return next;
    }
```
(Keep the existing `preview` case; it already sets steps/elevation/awaitingConsent.)

- [ ] **Step 4: Run, expect PASS (all reducer tests)**

Run: `cd packages/desktop && node_modules/.bin/vitest run src/provision-state.test.ts`
Expected: PASS (existing 4 + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/provision-state.ts packages/desktop/src/provision-state.test.ts
git commit -m "feat(desktop): reducer tracks per-step status, degraded, result/failedStep"
```

---

### Task 5: Host record builder (pure, TDD)

**Files:** Create `packages/desktop/src/host-record.ts`, Test `packages/desktop/src/host-record.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/desktop/src/host-record.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildHostRecord } from './host-record.ts';

describe('buildHostRecord', () => {
  it('builds a secret-free record from args + result', () => {
    const rec = buildHostRecord(
      { host: '10.0.0.2', user: 'admin', port: 22, keyPath: '~/.ssh/k', agentPort: 7878, token: 'SECRET' },
      { status: 'completed', health: { tailnet: false, agent: 'healthy' } },
      'fixed-id', '2026-06-14T00:00:00Z',
    );
    expect(rec).toEqual({
      id: 'fixed-id', label: 'admin@10.0.0.2', host: '10.0.0.2', user: 'admin',
      port: 22, keyPath: '~/.ssh/k', agentPort: 7878,
      lastStatus: 'completed', lastHealth: 'healthy', lastProvisionedAt: '2026-06-14T00:00:00Z',
    });
    expect(JSON.stringify(rec)).not.toContain('SECRET'); // never persist the token
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd packages/desktop && node_modules/.bin/vitest run src/host-record.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `host-record.ts`**

Create `packages/desktop/src/host-record.ts`:
```ts
import type { ProvisionArgs } from './ipc.ts';

export interface HostRecord {
  id: string;
  label: string;
  host: string;
  user: string;
  port: number;
  keyPath: string;
  agentPort: number;
  lastStatus: string;
  lastHealth?: string;
  lastProvisionedAt: string;
}

export function buildHostRecord(
  args: ProvisionArgs,
  result: { status: string; health?: { tailnet: boolean; agent: string } },
  id: string,
  now: string,
): HostRecord {
  return {
    id,
    label: `${args.user}@${args.host}`,
    host: args.host,
    user: args.user,
    port: args.port,
    keyPath: args.keyPath,
    agentPort: args.agentPort,
    lastStatus: result.status,
    lastHealth: result.health?.agent,
    lastProvisionedAt: now,
  };
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd packages/desktop && node_modules/.bin/vitest run src/host-record.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/host-record.ts packages/desktop/src/host-record.test.ts
git commit -m "feat(desktop): pure buildHostRecord (secret-free host record) with test"
```

---

### Task 6: Rust — `save_host` upserts into `hosts.json`

**Files:** Modify `packages/desktop/src-tauri/src/lib.rs`. Add `tauri-plugin-fs`? No — use std fs + the app's data dir via `app.path()`.

- [ ] **Step 1: Implement the command**

In `packages/desktop/src-tauri/src/lib.rs`, add (uses `serde_json` — already transitively available via tauri; if not, add `serde_json = "1"` to Cargo.toml):
```rust
use tauri::path::BaseDirectory;

#[tauri::command]
fn save_host(app: tauri::AppHandle, record: serde_json::Value) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join("hosts.json");
    let mut hosts: Vec<serde_json::Value> = match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    let id = record.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
    hosts.retain(|h| h.get("id").and_then(|v| v.as_str()) != Some(id.as_str()));
    hosts.push(record);
    let json = serde_json::to_string_pretty(&hosts).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}
```
Register it: add `save_host` to `tauri::generate_handler![start_provision, send_consent, save_host]`. Remove the unused `BaseDirectory` import if the compiler flags it (it's only needed if you use `resolve` — the snippet uses `app_data_dir()`, so drop the `use tauri::path::BaseDirectory;` line if unused).

- [ ] **Step 2: cargo check**

Run: `export PATH="/opt/homebrew/bin:$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && cd packages/desktop/src-tauri && cargo check`
Expected: clean. (If `serde_json` isn't resolvable, add `serde_json = "1"` to `[dependencies]` in Cargo.toml and re-run.)

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src-tauri/src/lib.rs packages/desktop/src-tauri/Cargo.toml
git commit -m "feat(desktop): save_host command upserts secret-free record into hosts.json"
```

---

### Task 7: UI — wizard render (step list + result) + save host on success

**Files:** Modify `packages/desktop/src/main.ts`, `packages/desktop/src/ipc.ts`, add a `.step` style to `packages/desktop/src/styles.css`.

- [ ] **Step 1: Add the `saveHost` IPC wrapper + drop token-from-args note**

In `packages/desktop/src/ipc.ts`, add:
```ts
import type { HostRecord } from './host-record.ts';
export const saveHost = (record: HostRecord) => invoke('save_host', { record });
```

- [ ] **Step 2: Render a step list + result; save on completion**

Rewrite the `render()` body and the event subscription in `packages/desktop/src/main.ts` so the raw `<pre>` becomes a step list and a completed run saves the host. Replace the `h('pre', …)` line and the `onProvEvent`/done handling with:
```ts
import { buildHostRecord } from './host-record.ts';
import { startProvision, sendConsent, saveHost, onProvEvent, onProvEnd, type ProvisionArgs } from './ipc.ts';
// ...inside render(), replace the <pre> log + done <p> with:
    state.steps.length
      ? h('ul', { className: 'steps' },
          ...state.steps.map((s) => {
            const st = state.stepStatus[s.id];
            const icon = !st ? '·' : st.status === 'ok' ? '✓' : st.status === 'degraded' ? '⚠' : st.status === 'failed' ? '✗' : '…';
            return h('li', { className: `step step-${st?.status ?? 'pending'}` }, `${icon} ${s.id}${st?.detail ? ` — ${st.detail}` : ''}`);
          }))
      : null,
    state.phase === 'done'
      ? h('p', { className: `result result-${state.result?.status}` },
          `Result: ${state.result?.status}` +
          (state.result?.failedStep ? ` (failed at ${state.result.failedStep})` : '') +
          (state.result?.health ? ` · agent ${state.result.health.agent}` : ''))
      : null,
```
Keep the existing form + Provision/Approve/Cancel. Track the last-used args so the record can be built; add a module variable `let lastArgs: ProvisionArgs | undefined;` set in `onStart`. Update the event handler to save on a completed result:
```ts
onProvEvent(async (line) => {
  state = reduce(state, line);
  render();
  if (state.phase === 'done' && state.result?.status === 'completed' && lastArgs) {
    const rec = buildHostRecord(lastArgs, state.result, crypto.randomUUID(), new Date().toISOString());
    try { await saveHost(rec); } catch (e) { console.error('saveHost failed', e); }
  }
});
onProvEnd(() => { if (state.phase !== 'done') { state.phase = 'done'; render(); } });
```
In `onStart`, set `lastArgs = args;` before `await startProvision(args)`.

NOTE on dates: `new Date().toISOString()` is fine in the browser runtime (this is app code, not a workflow script).

- [ ] **Step 3: Add minimal step styles**

Append to `packages/desktop/src/styles.css`:
```css
.steps { list-style: none; padding: 0; font-family: ui-monospace, monospace; }
.step { padding: 2px 0; }
.step-ok { color: #2e7d32; }
.step-degraded { color: #b26a00; }
.step-failed { color: #c62828; }
.result-completed { color: #2e7d32; font-weight: 600; }
.result-rolled-back { color: #c62828; font-weight: 600; }
```

- [ ] **Step 4: Typecheck**

Run: `cd packages/desktop && node_modules/.bin/tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main.ts packages/desktop/src/ipc.ts packages/desktop/src/styles.css
git commit -m "feat(desktop): wizard step-list + result rendering; persist host on success"
```

---

### Task 8: End-to-end verification (real CLI, localhost, decline + token-stdin)

**Files:** none (manual; document the result).

- [ ] **Step 1: Rebuild CLI + restage sidecar**

```bash
export PATH="/opt/homebrew/bin:$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"
cd /Users/apple/Documents/Workspace/patchwire
pnpm --filter @rebink/patchwire build
cd packages/desktop && node scripts/stage-sidecar.mjs
```

- [ ] **Step 2: Confirm token-stdin works at the CLI directly (no argv token)**

```bash
cd packages/desktop
printf '{"token":"abcdef0123456789ABCDEF"}\n{"consent":false}\n' | \
  ./src-tauri/binaries/patchwire-aarch64-apple-darwin setup --provision-remote --stream --token-stdin \
  --host 127.0.0.1 --user "$USER" --key-path "$HOME/.ssh/pw_validate" --ssh-port 22 --agent-port 7878
```
Expected: a `preview` line then `{"type":"result","status":"cancelled",…}`. No `--token` on argv. Zero mutation.

- [ ] **Step 3: Launch the app + confirm no panic**

`pnpm tauri dev` (Rust on PATH). Confirm it builds + reaches `Running …` with no panic. (Interactive click-through — Provision → Cancel for safe, or Approve to mutate + save a host — is optional and left to the operator.)

- [ ] **Step 4: Record + commit**

Append a "Phase 2 verified" note (date + observed) to `docs/superpowers/validation/2026-06-14-desktop-phase1.md` (or a new `…-phase2.md`). Commit.

---

## Self-review notes

- **Spec coverage:** implements the spec's Phase-2 build-sequence item ("wizard: form → live progress → preview/consent → health result; persist host") and the deferred security item (token off argv → stdin). The host record is secret-free (token NOT persisted) — `tauri-plugin-stronghold` token storage + the inventory UI + health/logs/uninstall remain Phase 3, as does the release sidecar + signing.
- **Placeholder scan:** every code step shows complete code; no placeholders or stray fences.
- **Type consistency:** `tokenStdin` (CLI input + flag), `--token-stdin` (CLI + Rust args), `save_host`/`saveHost`, `buildHostRecord`/`HostRecord`, and reducer fields (`stepStatus`/`degraded`/`result.failedStep`) are used consistently across tasks. `ProvisionArgs` (ipc.ts) is the source type for `buildHostRecord`. The token JSON written from Rust is safe because the token grammar is validated (`[A-Za-z0-9_-]`).
- **Risk:** Rust tasks (3, 6) + UI (7) aren't unit-tested (Tauri needs app context) — covered by `cargo check`, `tsc`, and the Task 8 live run. TDD'd units: CLI token-stdin (Task 1), reducer (Task 4), host record (Task 5).
