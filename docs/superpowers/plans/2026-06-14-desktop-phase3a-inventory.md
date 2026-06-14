# Desktop Phase 3a — Host inventory (list / re-run / remove) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Hosts inventory view to the desktop app — list the hosts persisted by the wizard (`hosts.json`), show each one's last-known status/health, and offer Re-run (prefill the wizard) and Remove (delete the local record).

**Architecture:** Two new Rust commands read/mutate the existing `app_data_dir/hosts.json` (`list_hosts`, `delete_host`) alongside the Phase-2 `save_host`. The UI gains a view toggle (Wizard ⇄ Hosts) and renders host cards from the persisted `HostRecord`s. Two pure functions are TDD'd: a record→form-values mapper (for Re-run) and a status-badge classifier; the Rust IO and DOM wiring are structured + verified by a real list/remove run.

**Tech Stack:** Tauri v2 (Rust commands, std fs + serde_json), vanilla TS + `h()`, vitest. Rust on PATH via `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin`.

**Scope:** 3a is intentionally dependency-light — **no network, no secrets, no CLI changes.** It shows the host's **last-known** status (captured at provision time in the record). **Deferred to Phase 3b:** *live* health re-check, log viewing, and remote uninstall — all of which require SSH to the host (the agent binds the host's loopback, so it isn't reachable directly from the client) and so depend on a `doctor --json`/`agent-log` SSH path (and possibly stronghold). **3c:** stronghold token storage. **3d:** release (bun-compiled) sidecar pipeline + code signing.

**Prerequisites:** Builds on Phase 2 (PR #60) — `save_host` + the `HostRecord` shape (`packages/desktop/src/host-record.ts`) already exist. Work on a branch based on `feat/desktop-phase2-wizard`.

---

## File structure

```
packages/desktop/src-tauri/src/lib.rs   # + list_hosts, delete_host commands (read/write hosts.json)
packages/desktop/src/inventory.ts        # PURE: recordToFormValues(), hostBadge()   [TDD]
packages/desktop/src/inventory.test.ts
packages/desktop/src/ipc.ts              # + listHosts(), deleteHost()
packages/desktop/src/main.ts             # view toggle (Wizard/Hosts) + host cards + re-run/remove wiring
packages/desktop/src/styles.css          # host card styles
```

---

### Task 1: Rust — `list_hosts` + `delete_host`

**Files:** Modify `packages/desktop/src-tauri/src/lib.rs`.

- [ ] **Step 1: Add the two commands**

In `packages/desktop/src-tauri/src/lib.rs`, add (mirrors the existing `save_host` IO; reuses `tauri::Manager` for `app.path()`):
```rust
#[tauri::command]
fn list_hosts(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("hosts.json");
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(serde_json::from_str(&s).unwrap_or_default()),
        Err(_) => Ok(Vec::new()),
    }
}

#[tauri::command]
fn delete_host(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("hosts.json");
    let mut hosts: Vec<serde_json::Value> = match std::fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    hosts.retain(|h| h.get("id").and_then(|v| v.as_str()) != Some(id.as_str()));
    let json = serde_json::to_string_pretty(&hosts).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}
```
Register both in the handler: `tauri::generate_handler![start_provision, send_consent, save_host, list_hosts, delete_host]`.

- [ ] **Step 2: cargo check**

Run: `export PATH="/opt/homebrew/bin:$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && cd packages/desktop/src-tauri && cargo check`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): list_hosts + delete_host commands over hosts.json"
```

---

### Task 2: Pure inventory helpers (TDD)

**Files:** Create `packages/desktop/src/inventory.ts`, Test `packages/desktop/src/inventory.test.ts`.

- [ ] **Step 1: Write the failing tests**

Create `packages/desktop/src/inventory.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { recordToFormValues, hostBadge } from './inventory.ts';
import type { HostRecord } from './host-record.ts';

const rec: HostRecord = {
  id: 'h1', label: 'admin@10.0.0.2', host: '10.0.0.2', user: 'admin',
  port: 22, keyPath: '~/.ssh/k', agentPort: 7878,
  lastStatus: 'completed', lastHealth: 'healthy', lastProvisionedAt: '2026-06-14T00:00:00Z',
};

describe('recordToFormValues', () => {
  it('maps a record to wizard form string values', () => {
    expect(recordToFormValues(rec)).toEqual({
      host: '10.0.0.2', user: 'admin', port: '22', keyPath: '~/.ssh/k', agentPort: '7878',
    });
  });
});

describe('hostBadge', () => {
  it('completed + healthy → ok', () => {
    expect(hostBadge(rec)).toEqual({ text: 'healthy', cls: 'badge-ok' });
  });
  it('rolled-back → failed', () => {
    expect(hostBadge({ ...rec, lastStatus: 'rolled-back', lastHealth: undefined })).toEqual({ text: 'failed', cls: 'badge-failed' });
  });
  it('completed but unhealthy agent → warn', () => {
    expect(hostBadge({ ...rec, lastHealth: 'unhealthy' })).toEqual({ text: 'unhealthy', cls: 'badge-warn' });
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `cd packages/desktop && node_modules/.bin/vitest run src/inventory.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `inventory.ts`**

Create `packages/desktop/src/inventory.ts`:
```ts
import type { HostRecord } from './host-record.ts';
import type { ProvisionArgs } from './ipc.ts';

/** Map a saved host record to wizard form values (strings for <input>). */
export function recordToFormValues(r: HostRecord): { [K in keyof Omit<ProvisionArgs, 'token'>]: string } {
  return {
    host: r.host,
    user: r.user,
    port: String(r.port),
    keyPath: r.keyPath,
    agentPort: String(r.agentPort),
  };
}

/** A display badge for a host's last-known state. */
export function hostBadge(r: HostRecord): { text: string; cls: string } {
  if (r.lastStatus !== 'completed') return { text: 'failed', cls: 'badge-failed' };
  if (r.lastHealth && r.lastHealth !== 'healthy') return { text: r.lastHealth, cls: 'badge-warn' };
  return { text: r.lastHealth ?? 'ok', cls: 'badge-ok' };
}
```

- [ ] **Step 4: Run, expect PASS**

Run: `cd packages/desktop && node_modules/.bin/vitest run src/inventory.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/inventory.ts packages/desktop/src/inventory.test.ts
git commit -m "feat(desktop): pure inventory helpers (recordToFormValues, hostBadge) with tests"
```

---

### Task 3: IPC wrappers — `listHosts` / `deleteHost`

**Files:** Modify `packages/desktop/src/ipc.ts`.

- [ ] **Step 1: Add the wrappers**

In `packages/desktop/src/ipc.ts`, add:
```ts
import type { HostRecord } from './host-record.ts';
export const listHosts = () => invoke<HostRecord[]>('list_hosts');
export const deleteHost = (id: string) => invoke<void>('delete_host', { id });
```
(`saveHost` already imports `HostRecord`; keep a single import line — merge if needed.)

- [ ] **Step 2: Typecheck**

Run: `cd packages/desktop && node_modules/.bin/tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/ipc.ts
git commit -m "feat(desktop): listHosts/deleteHost IPC wrappers"
```

---

### Task 4: UI — view toggle + host cards + re-run/remove

**Files:** Modify `packages/desktop/src/main.ts`, `packages/desktop/src/styles.css`.

- [ ] **Step 1: Add view state + a toggle, and a hosts cache**

In `packages/desktop/src/main.ts`, near the top module state, add:
```ts
import { listHosts, deleteHost } from './ipc.ts';
import { recordToFormValues, hostBadge } from './inventory.ts';
import type { HostRecord } from './host-record.ts';

let view: 'wizard' | 'hosts' = 'wizard';
let hosts: HostRecord[] = [];

async function refreshHosts() {
  try { hosts = await listHosts(); } catch (e) { console.error('listHosts failed', e); hosts = []; }
  render();
}
```

- [ ] **Step 2: Render the toggle + the hosts view**

In `render()`, prepend a nav toggle and branch on `view`. Replace the top of the `render()` body so it builds a header with two buttons, then either the existing wizard nodes (when `view==='wizard'`) or the hosts list (when `view==='hosts'`):
```ts
function render() {
  clear(root);
  const nav = h('div', { className: 'nav' },
    h('button', { className: view === 'wizard' ? 'active' : '', events: { click: () => { view = 'wizard'; render(); } } }, 'Provision'),
    h('button', { className: view === 'hosts' ? 'active' : '', events: { click: () => { view = 'hosts'; refreshHosts(); } } }, 'Hosts'),
  );
  root.append(nav);
  if (view === 'hosts') { renderHosts(); return; }
  // ...existing wizard nodes (form, Provision button, preview/consent, step list, result) appended here...
}

function renderHosts() {
  if (!hosts.length) { root.append(h('p', { className: 'empty' }, 'No hosts yet. Provision one from the Provision tab.')); return; }
  root.append(h('ul', { className: 'hosts' },
    ...hosts.map((r) => {
      const b = hostBadge(r);
      return h('li', { className: 'host-card' },
        h('span', { className: `badge ${b.cls}` }, b.text),
        h('span', { className: 'host-label' }, r.label),
        h('span', { className: 'host-meta' }, `${r.lastStatus} · ${r.lastProvisionedAt}`),
        h('button', { events: { click: () => rerun(r) } }, 'Re-run'),
        h('button', { events: { click: () => removeHost(r.id) } }, 'Remove'),
      );
    })));
}

function rerun(r: HostRecord) {
  const f = recordToFormValues(r);
  view = 'wizard';
  render();
  for (const k of Object.keys(f) as (keyof typeof f)[]) {
    const el = document.getElementById(`f-${k}`) as HTMLInputElement | null;
    if (el) el.value = f[k];
  }
}

async function removeHost(id: string) {
  try { await deleteHost(id); } catch (e) { console.error('deleteHost failed', e); }
  await refreshHosts();
}
```
(Keep the existing wizard rendering code; just move it under the `view === 'wizard'` branch. Ensure the existing `field(...)`/`val(...)`/`onStart`/event handlers stay intact.)

- [ ] **Step 2b: Verify the wizard form ids still match**

`recordToFormValues` returns keys `host/user/port/keyPath/agentPort` — confirm the wizard `field(name,…)` calls use those exact names so `document.getElementById('f-'+name)` resolves in `rerun`. (They do, from Phase 1/2.)

- [ ] **Step 3: Styles**

Append to `packages/desktop/src/styles.css`:
```css
.nav { display: flex; gap: 8px; margin-bottom: 12px; }
.nav button.active { font-weight: 700; text-decoration: underline; }
.hosts { list-style: none; padding: 0; }
.host-card { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #2a2a2a; }
.host-label { font-weight: 600; }
.host-meta { color: #888; font-size: 0.85em; }
.badge { padding: 2px 8px; border-radius: 10px; font-size: 0.8em; }
.badge-ok { background: #1b5e20; color: #fff; }
.badge-warn { background: #b26a00; color: #fff; }
.badge-failed { background: #b71c1c; color: #fff; }
.empty { color: #888; }
```

- [ ] **Step 4: Typecheck + unit tests**

Run: `cd packages/desktop && node_modules/.bin/tsc --noEmit && node_modules/.bin/vitest run`
Expected: tsc clean; all tests pass (stage-sidecar 6, provision-state 6, host-record 1, inventory 4).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/main.ts packages/desktop/src/styles.css
git commit -m "feat(desktop): Hosts inventory view — cards, re-run prefill, remove"
```

---

### Task 5: End-to-end verification (seed a record, list + remove, launch)

**Files:** none (manual; document the result).

- [ ] **Step 1: Seed a host record (no real provision needed)**

Find the app-data dir and write a sample `hosts.json`:
```bash
export PATH="/opt/homebrew/bin:$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"
DIR="$HOME/Library/Application Support/com.patchwire.desktop"
mkdir -p "$DIR"
cat > "$DIR/hosts.json" <<'JSON'
[{"id":"seed-1","label":"admin@10.0.0.2","host":"10.0.0.2","user":"admin","port":22,"keyPath":"~/.ssh/pw_validate","agentPort":7878,"lastStatus":"completed","lastHealth":"healthy","lastProvisionedAt":"2026-06-14T00:00:00Z"}]
JSON
```
(Confirm the dir name matches `identifier` in `tauri.conf.json` = `com.patchwire.desktop`; adjust if different.)

- [ ] **Step 2: Launch + verify the Hosts view**

`cd packages/desktop && pnpm tauri dev`. Click **Hosts** → the seeded card shows `admin@10.0.0.2`, a green `healthy` badge, `completed · 2026-06-14…`. Click **Re-run** → switches to Provision with the form prefilled (host `10.0.0.2`, user `admin`, etc.). Click **Hosts → Remove** → the card disappears; confirm `hosts.json` is now `[]`.
Expected: list renders from `hosts.json`, re-run prefills, remove deletes. No panic.

- [ ] **Step 3: Record + commit**

Append a "Phase 3a verified" note (date + observed) to a new `docs/superpowers/validation/2026-06-14-desktop-phase3a.md`. Commit.

---

## Self-review notes

- **Spec coverage:** implements the inventory portion of the spec's Phase-3 ("host list … re-run/uninstall") minus the networked features. Re-run + Remove are covered; **live health, logs, and remote uninstall are explicitly deferred to 3b** (they need SSH because the agent binds the host loopback — documented in Scope). Stronghold (3c) and release/signing (3d) are out of scope here.
- **Placeholder scan:** every code step shows complete code. Task 4 Step 2 says "keep the existing wizard rendering" — that's an instruction to preserve real existing code (from Phase 1/2), not a placeholder; the new nav/branch structure around it is fully specified.
- **Type consistency:** `list_hosts`/`delete_host` (Rust) ↔ `listHosts`/`deleteHost` (ipc); `recordToFormValues`/`hostBadge` (inventory.ts) consume `HostRecord` (host-record.ts) and the badge classes (`badge-ok/warn/failed`) match the CSS; form ids `f-<host|user|port|keyPath|agentPort>` match the wizard's `field()` names. `deleteHost(id)` arg key `id` matches the Rust command param.
- **Risk:** Rust IO (Task 1) + UI (Task 4) aren't unit-tested (Tauri needs app context) — covered by `cargo check`, `tsc`, and the Task 5 seeded run. TDD'd units: `recordToFormValues` + `hostBadge` (Task 2).
