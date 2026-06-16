# Desktop Developer Client — Phase 5a (Connections foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Connections layer (multiple remote machines) to the desktop app: a Connections list (home), an Add-connection flow that provisions a machine's agent once and saves a Connection, and Projects scoped to the selected connection. Re-scope the P4b `SetupWizard` to Add-connection.

**Architecture:** Connections persist in `connections.json` (array, mirroring the existing `projects.json` pattern). The Add-connection flow reuses the existing provision engine — which is **already agent-only** (`setup --provision-remote` writes no project `patchwire.yml`; verified). `ProvisionArgs`' project fields become optional so provisioning can run without a project. Projects gain a `connectionId` and the Projects screen filters by the selected connection. The real Add-project flow (folder → remote copy + sync) is **P5b**; P5a leaves an Add-project placeholder.

**Tech Stack:** Tauri 2, Svelte 5 runes, Vitest + @testing-library/svelte, Rust (serde_json), the existing provision/wizard engine.

**Spec:** `docs/superpowers/specs/2026-06-16-desktop-connections-and-projects-design.md`. **Builds on** P4a/P4b (current `main`). **Reuses unchanged:** Workspace + chat/diff/apply (P2), all sync (P3), the wizard's machine/key/provision steps + `provision-state` reducer (P4b), `ensure_ssh_key`/`verify_key`/`open_terminal`.

**Key verified facts:**
- `setup --provision-remote --stream` is **provision-only** (installs the agent; writes NO local `patchwire.yml`). So Add-connection needs no new seam — just don't pass project args.
- Rust `ProvisionArgs` currently requires `project_dir`/`project`/`remote_path`; `start_provision` sets `current_dir` + adds `--project/--path`. P5a makes those optional (provision can run agent-only).
- Persistence pattern: `data_file(app, "projects.json")` + `list_projects`/`save_project` (read/upsert-by-id/write JSON array). Mirror for `connections.json`.
- ipc lives in two files: `src/ipc.ts` (provision wrappers + `ProvisionArgs` type) and `src/lib/ipc.ts` (re-exports + project wrappers).

**Working dir:** `packages/desktop`. Tests: `pnpm --filter patchwire-desktop test`.

---

## File Structure
**Rust:** Modify `src-tauri/src/lib.rs` — make `ProvisionArgs` project fields `Option`; conditional `current_dir`/`--project`/`--path` in `start_provision`; add `list_connections`/`save_connection`/`delete_connection`; register them.
**Frontend:**
- Modify `src/lib/types.ts` — add `Connection`; `Project` gains `connectionId`.
- Modify `src/lib/model.ts` (+ test) — `parseConnections`, `buildConnection`; `parseProjects`/`buildProject`/`projectFromConfig` carry `connectionId`.
- Modify `src/ipc.ts` — `ProvisionArgs` project fields optional.
- Modify `src/lib/ipc.ts` (+ test) — `listConnections`/`saveConnection`/`deleteConnection`.
- Modify `src/lib/stores.ts` (+ test) — `connections` store + `activeConnectionId` + `loadConnections`; keep `projects`/`loadProjects`.
- Create `src/screens/Connections.svelte` (+ test) — the list/home.
- Rename/rework `src/screens/SetupWizard.svelte` → Add-connection (+ test).
- Modify `src/screens/Projects.svelte` (+ test) — filter by `connectionId`; back-to-connections.
- Create `src/screens/AddProjectPlaceholder.svelte` (P5b swap point).
- Rewrite `src/App.svelte` (+ test) — Connections → Projects → Workspace routing.

---

### Task 1: Rust — connections persistence + optional provision args

**Files:** Modify `src-tauri/src/lib.rs`

- [ ] **Step 1: Make `ProvisionArgs` project fields optional**
```rust
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProvisionArgs {
    host: String,
    user: String,
    port: u16,
    key_path: String,
    agent_port: u16,
    token: String,
    #[serde(default)] project_dir: Option<String>,
    #[serde(default)] project: Option<String>,
    #[serde(default)] remote_path: Option<String>,
}
```

- [ ] **Step 2: `start_provision` — conditional project args + current_dir**

Build the args as a `Vec<String>` so the project flags are appended only when present, and set `current_dir` only when `project_dir` is given. Read the current `start_provision`; replace the fixed `.args([...])`/`.current_dir(...)` with:
```rust
let mut argv: Vec<String> = vec![
    "setup".into(), "--provision-remote".into(), "--stream".into(), "--token-stdin".into(),
    "--host".into(), args.host.clone(),
    "--user".into(), args.user.clone(),
    "--ssh-port".into(), args.port.to_string(),
    "--key-path".into(), key_path.clone(),
    "--agent-port".into(), args.agent_port.to_string(),
];
if let (Some(p), Some(rp)) = (args.project.as_ref(), args.remote_path.as_ref()) {
    argv.push("--project".into()); argv.push(p.clone());
    argv.push("--path".into()); argv.push(rp.clone());
}
let mut cmd = sidecar;
if let Some(dir) = args.project_dir.as_ref() {
    if !std::path::Path::new(dir).is_dir() { state.busy.store(false, Ordering::SeqCst); return Err("project_dir does not exist".into()); }
    cmd = cmd.current_dir(std::path::PathBuf::from(dir));
}
let (mut rx, child) = match cmd.args(argv).spawn() { /* unchanged */ };
```
(Keep the busy guard, token-stdin write, and `pw://prov`/`pw://prov-end` exactly as they are. Adapt the variable names to the real code — the point is: project args + current_dir only when provided.)

- [ ] **Step 3: Add connections persistence** (mirror `list_projects`/`save_project`)
```rust
#[tauri::command]
fn list_connections(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let path = data_file(&app, "connections.json")?;
    if !path.exists() { return Ok(vec![]); }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_connection(app: tauri::AppHandle, connection: serde_json::Value) -> Result<(), String> {
    let path = data_file(&app, "connections.json")?;
    let mut list: Vec<serde_json::Value> = if path.exists() {
        serde_json::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?
    } else { vec![] };
    let id = connection.get("id").and_then(|v| v.as_str()).unwrap_or("");
    if id.is_empty() { return Err("connection.id is required".into()); }
    list.retain(|c| c.get("id").and_then(|v| v.as_str()) != Some(id));
    list.push(connection);
    fs::write(&path, serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_connection(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = data_file(&app, "connections.json")?;
    if !path.exists() { return Ok(()); }
    let mut list: Vec<serde_json::Value> = serde_json::from_str(&fs::read_to_string(&path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    list.retain(|c| c.get("id").and_then(|v| v.as_str()) != Some(id.as_str()));
    fs::write(&path, serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
```

- [ ] **Step 4: Register** `list_connections, save_connection, delete_connection` in `generate_handler!` (keep all existing; now 23).

- [ ] **Step 5: cargo check**

Run: `export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && pnpm stage-sidecar && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles. (Note: making `ProvisionArgs` fields `Option` means the existing P4b wizard call — which still sends them — keeps working; agent-only callers omit them.)

- [ ] **Step 6: Commit**
```bash
git add packages/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): connections.json persistence; optional provision project args (agent-only)"
```

---

### Task 2: Types + model (TDD)

**Files:** Modify `src/lib/types.ts`, `src/lib/model.ts`, `src/lib/model.test.ts`

- [ ] **Step 1: Add failing tests to `model.test.ts`**
```ts
import { parseConnections, buildConnection, parseProjects, buildProject } from "./model";

describe("buildConnection", () => {
  it("builds a connection with an id and all fields", () => {
    const c = buildConnection({ name: "mini", host: "h", user: "u", sshPort: 22, keyPath: "/k", agentPort: 7878, token: "T", agentVersion: "0.3.17" });
    expect(c).toMatchObject({ name: "mini", host: "h", user: "u", sshPort: 22, keyPath: "/k", agentPort: 7878, token: "T", agentVersion: "0.3.17" });
    expect(c.id.length).toBeGreaterThan(0);
  });
});

describe("parseConnections", () => {
  it("coerces records, drops ones missing id/host/user, defaults optional", () => {
    const out = parseConnections([
      { id: "a", name: "mini", host: "h", user: "u", sshPort: 22, keyPath: "/k", agentPort: 7878, token: "T" },
      { id: "b", host: "h2", user: "u2" },
      { name: "broken" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("mini");
    expect(out[1].name).toBe("b");       // falls back to id
    expect(out[1].sshPort).toBe(22);     // default
    expect(out[1].agentPort).toBe(7878); // default
  });
});

describe("project connectionId", () => {
  it("buildProject carries connectionId", () => {
    const p = buildProject("/l", "/r", "n", "h", "u", "conn-1");
    expect(p.connectionId).toBe("conn-1");
  });
  it("parseProjects carries connectionId (default empty)", () => {
    const out = parseProjects([
      { id: "a", name: "n", localPath: "/l", remotePath: "/r", connectionId: "c1" },
      { id: "b", name: "m", localPath: "/l2", remotePath: "/r2" },
    ]);
    expect(out[0].connectionId).toBe("c1");
    expect(out[1].connectionId).toBe("");
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter patchwire-desktop test src/lib/model.test.ts`.

- [ ] **Step 3: Update `types.ts`**
```ts
export interface Connection {
  id: string;
  name: string;
  host: string;
  user: string;
  sshPort: number;
  keyPath: string;
  agentPort: number;
  token: string;
  agentVersion?: string;
}
```
Add `connectionId: string;` to `Project`.

- [ ] **Step 4: Update `model.ts`**
- `buildProject(localPath, remotePath, name?, host="", user="", connectionId="")` → include `connectionId`.
- `projectFromConfig` → add `connectionId: ""` (P5b will set it).
- `parseProjects` → carry `connectionId: typeof o.connectionId === "string" ? o.connectionId : ""`.
- Add:
```ts
import type { Connection } from "./types";

export function buildConnection(c: Omit<Connection, "id">): Connection {
  return { id: crypto.randomUUID(), ...c };
}

export function parseConnections(raw: unknown): Connection[] {
  if (!Array.isArray(raw)) return [];
  const out: Connection[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    const host = typeof o.host === "string" ? o.host : "";
    const user = typeof o.user === "string" ? o.user : "";
    if (!id || !host || !user) continue;
    out.push({
      id,
      name: typeof o.name === "string" && o.name ? o.name : id,
      host, user,
      sshPort: typeof o.sshPort === "number" ? o.sshPort : 22,
      keyPath: typeof o.keyPath === "string" ? o.keyPath : "",
      agentPort: typeof o.agentPort === "number" ? o.agentPort : 7878,
      token: typeof o.token === "string" ? o.token : "",
      agentVersion: typeof o.agentVersion === "string" ? o.agentVersion : undefined,
    });
  }
  return out;
}
```

- [ ] **Step 5: Run, verify pass** — `pnpm --filter patchwire-desktop test src/lib/model.test.ts` (full suite may be red until later tasks; this file green).

- [ ] **Step 6: Commit**
```bash
git add packages/desktop/src/lib/types.ts packages/desktop/src/lib/model.ts packages/desktop/src/lib/model.test.ts
git commit -m "feat(desktop): Connection type + parse/build; Project gains connectionId"
```

---

### Task 3: IPC + stores (TDD)

**Files:** Modify `src/ipc.ts`, `src/lib/ipc.ts` (+ test), `src/lib/stores.ts` (+ test)

- [ ] **Step 1: `src/ipc.ts`** — make `ProvisionArgs` project fields optional:
```ts
export interface ProvisionArgs {
  host: string; user: string; port: number; keyPath: string; agentPort: number; token: string;
  projectDir?: string; project?: string; remotePath?: string;
}
```

- [ ] **Step 2: Add failing ipc tests to `src/lib/ipc.test.ts`**
```ts
import { listConnections, saveConnection, deleteConnection } from "./ipc";

describe("connections ipc", () => {
  it("listConnections parses records", async () => {
    invokeMock.mockResolvedValue([{ id: "a", name: "mini", host: "h", user: "u", sshPort: 22, keyPath: "/k", agentPort: 7878, token: "T" }]);
    const out = await listConnections();
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("mini");
  });
  it("saveConnection invokes save_connection", async () => {
    invokeMock.mockResolvedValue(undefined);
    const c = { id: "a", name: "m", host: "h", user: "u", sshPort: 22, keyPath: "/k", agentPort: 7878, token: "T" };
    await saveConnection(c);
    expect(invokeMock).toHaveBeenCalledWith("save_connection", { connection: c });
  });
  it("deleteConnection invokes delete_connection", async () => {
    invokeMock.mockResolvedValue(undefined);
    await deleteConnection("a");
    expect(invokeMock).toHaveBeenCalledWith("delete_connection", { id: "a" });
  });
});
```

- [ ] **Step 3: Add to `src/lib/ipc.ts`**
```ts
import { parseConnections } from "./model";
import type { Connection } from "./types";

export async function listConnections(): Promise<Connection[]> {
  return parseConnections(await invoke<unknown>("list_connections"));
}
export async function saveConnection(connection: Connection): Promise<void> {
  await invoke("save_connection", { connection });
}
export async function deleteConnection(id: string): Promise<void> {
  await invoke("delete_connection", { id });
}
```

- [ ] **Step 4: Add failing stores tests to `src/lib/stores.test.ts`**
```ts
import { connections, activeConnectionId, loadConnections, projects } from "./stores";
import { get } from "svelte/store";

it("loadConnections populates the store", async () => {
  invokeMock.mockResolvedValue([{ id: "a", name: "mini", host: "h", user: "u", sshPort: 22, keyPath: "/k", agentPort: 7878, token: "T" }]);
  await loadConnections();
  expect(get(connections)).toHaveLength(1);
});
it("activeConnectionId is settable", () => {
  activeConnectionId.set("a");
  expect(get(activeConnectionId)).toBe("a");
});
```

- [ ] **Step 5: Update `src/lib/stores.ts`**
```ts
import { writable } from "svelte/store";
import type { Project, Connection } from "./types";
import { listProjects, listConnections } from "./ipc";

export const projects = writable<Project[]>([]);
export const connections = writable<Connection[]>([]);
export const activeConnectionId = writable<string | null>(null);

export async function loadProjects(): Promise<void> { projects.set(await listProjects()); }
export async function loadConnections(): Promise<void> { connections.set(await listConnections()); }
```

- [ ] **Step 6: Run, verify pass** — `pnpm --filter patchwire-desktop test src/lib/ipc.test.ts src/lib/stores.test.ts`.

- [ ] **Step 7: Commit**
```bash
git add packages/desktop/src/ipc.ts packages/desktop/src/lib/ipc.ts packages/desktop/src/lib/ipc.test.ts packages/desktop/src/lib/stores.ts packages/desktop/src/lib/stores.test.ts
git commit -m "feat(desktop): connections ipc + store + activeConnectionId; optional provision args type"
```

---

### Task 4: Connections list screen (TDD)

**Files:** Create `src/screens/Connections.svelte` (+ test)

> Lists connections (name, `user@host`, agent version); click a row → select (calls `onselect(connection)`); "＋ Add connection" → `onadd`; per-row delete → `deleteConnection` + reload. Empty state → prompt to add.

- [ ] **Step 1: Write `src/screens/Connections.test.ts`**
```ts
import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
import Connections from "./Connections.svelte";
import { connections } from "../lib/stores";

beforeEach(() => { invokeMock.mockReset(); connections.set([]); });

const conn = { id: "a", name: "studio-mini", host: "100.100.100.100", user: "admin", sshPort: 22, keyPath: "/k", agentPort: 7878, token: "T", agentVersion: "0.3.17" };

describe("Connections", () => {
  it("shows empty state with an add prompt when none", () => {
    const { getByTestId } = render(Connections);
    expect(getByTestId("connections-empty").textContent).toMatch(/connection/i);
  });
  it("renders a row per connection with name + user@host", () => {
    connections.set([conn]);
    const { getByTestId } = render(Connections);
    expect(getByTestId("conn-row-a").textContent).toContain("studio-mini");
    expect(getByTestId("conn-row-a").textContent).toContain("admin@100.100.100.100");
  });
  it("selecting a row fires onselect", async () => {
    connections.set([conn]);
    const onselect = vi.fn();
    const { getByTestId } = render(Connections, { props: { onselect } });
    await fireEvent.click(getByTestId("conn-row-a"));
    expect(onselect).toHaveBeenCalledWith(conn);
  });
  it("Add connection fires onadd", async () => {
    const onadd = vi.fn();
    const { getByTestId } = render(Connections, { props: { onadd } });
    await fireEvent.click(getByTestId("add-connection"));
    expect(onadd).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Write `src/screens/Connections.svelte`**
```svelte
<script lang="ts">
  import { connections, loadConnections } from "../lib/stores";
  import { deleteConnection } from "../lib/ipc";
  import type { Connection } from "../lib/types";

  let { onselect, onadd }: { onselect?: (c: Connection) => void; onadd?: () => void } = $props();

  async function remove(id: string, e: Event) {
    e.stopPropagation();
    await deleteConnection(id);
    await loadConnections();
  }
</script>

<div class="bar"><h2>Connections</h2><button class="new" data-testid="add-connection" onclick={() => onadd?.()}>＋ Add connection</button></div>

{#if $connections.length === 0}
  <div class="empty" data-testid="connections-empty">
    <p>No connections yet</p>
    <p class="sub">Add a machine to provision the agent and start working.</p>
  </div>
{:else}
  <div class="list">
    {#each $connections as c (c.id)}
      <div class="row" data-testid="conn-row-{c.id}" role="button" tabindex="0"
        onclick={() => onselect?.(c)} onkeydown={(e) => e.key === "Enter" && onselect?.(c)}>
        <div class="ic">🖥</div>
        <div class="body">
          <div class="name">{c.name}</div>
          <div class="sub mono">{c.user}@{c.host}{#if c.agentVersion} · agent v{c.agentVersion}{/if}</div>
        </div>
        <button class="del" data-testid="conn-del-{c.id}" onclick={(e) => remove(c.id, e)}>Remove</button>
      </div>
    {/each}
  </div>
{/if}

<style>
  .bar { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px 10px; }
  .bar h2 { font-size: 15px; margin: 0; }
  .new { background: var(--accent-strong); color: #fff; font-size: 12px; padding: 7px 13px; font-weight: 600; }
  .row { display: flex; align-items: center; gap: 14px; padding: 14px 20px; border-top: 1px solid var(--border); cursor: pointer; }
  .row:hover { background: var(--surface-raised); }
  .ic { width: 38px; height: 38px; border-radius: 10px; background: var(--accent-bg); display: flex; align-items: center; justify-content: center; }
  .name { font-weight: 600; }
  .sub { color: var(--text-muted); font-size: 12px; margin-top: 2px; }
  .del { margin-left: auto; background: var(--surface-raised); color: var(--text-muted); font-size: 11px; padding: 5px 10px; }
  .empty { text-align: center; color: var(--text-muted); padding: 48px 20px; }
  .empty .sub { font-size: 13px; }
</style>
```

- [ ] **Step 4: Run, verify pass.**

- [ ] **Step 5: Commit**
```bash
git add packages/desktop/src/screens/Connections.svelte packages/desktop/src/screens/Connections.test.ts
git commit -m "feat(desktop): Connections list screen"
```

---

### Task 5: Re-scope SetupWizard → Add-connection (TDD)

**Files:** Modify `src/screens/SetupWizard.svelte` (+ test)

> Re-scope the existing wizard: add a connection **name** field; provision **agent-only** (omit project/projectDir/remotePath in `startProvision`); on `completed` build + save a **Connection** (not a project) and call `onfinish(connection)`. Keep the 4-step UI, the key install/verify, and the streamed provision intact. Read the current `SetupWizard.svelte` first.

- [ ] **Step 1: Update `src/screens/SetupWizard.test.ts`**

Change the props (no `localPath`; `onfinish` receives a connection). Update the existing tests + add: on `result completed`, `save_connection` is called (not `save_project`) and `onfinish` fires. Keep the Step1/key/verify tests (now Step 1 also has a connection name). The provision call should NOT include `project`/`projectDir`/`remotePath`. Concretely, the Step-4 success test asserts:
```ts
expect(invokeMock).toHaveBeenCalledWith("start_provision", expect.objectContaining({
  args: expect.objectContaining({ host: "studio-mini", user: "rebin" }),
}));
// and NOT project-scoped:
const provCall = invokeMock.mock.calls.find((c) => c[0] === "start_provision")![1] as any;
expect(provCall.args.project).toBeUndefined();
expect(provCall.args.projectDir).toBeUndefined();
// on completed:
expect(invokeMock).toHaveBeenCalledWith("save_connection", expect.objectContaining({
  connection: expect.objectContaining({ name: expect.any(String), host: "studio-mini", user: "rebin", token: expect.any(String) }),
}));
expect(onfinish).toHaveBeenCalled();
```
(Update Step-1 fill to also set a "Connection name" field. Adapt the existing test's prompt walking.)

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Update `src/screens/SetupWizard.svelte`**
- Props: `let { onfinish, onback }: { onfinish?: (c: Connection) => void; onback?: () => void } = $props();` (drop `localPath`).
- Add state `let name = $state("");` and a "Connection name" input in Step 1 (aria-label "Connection name"); gate Step-1 Next also on `name.trim() !== ""` (alongside the existing host/user checks). Remove the `project`/`remotePath` inputs (those belong to Add-project in P5b). The review step shows name + user@host.
- Store the generated token: `let token = $state("");`. In `provision()`: `token = genToken();` then `await startProvision({ host, user, port: sshPort, keyPath, agentPort, token });` (NO project/projectDir/remotePath).
- In the onProvEvent completion handler: replace the buildProject/saveProject block with:
```ts
if (!saved && prov.phase === "done" && prov.result?.status === "completed") {
  saved = true;
  const c = buildConnection({ name, host, user, sshPort, keyPath, agentPort, token,
    agentVersion: prov.result?.health?.agent && prov.result.health.agent !== "" ? undefined : undefined });
  saveConnection(c).then(() => onfinish?.(c));
}
```
(Import `buildConnection` from `../lib/model`, `saveConnection` from `../lib/ipc`, `Connection` type. `agentVersion` may be left undefined for P5a — a later host-check can fill it.)
- Keep Steps 2 (key) + 4 (provision streaming + consent + the failed-detail display from the P4b fix) unchanged.

- [ ] **Step 4: Run, verify pass** (this file).

- [ ] **Step 5: Commit**
```bash
git add packages/desktop/src/screens/SetupWizard.svelte packages/desktop/src/screens/SetupWizard.test.ts
git commit -m "feat(desktop): re-scope SetupWizard to Add-connection (agent-only provision, saves a Connection)"
```

---

### Task 6: App routing + Projects scoping + Add-project placeholder (TDD)

**Files:** Rewrite `src/App.svelte` (+ test); Modify `src/screens/Projects.svelte` (+ test); Create `src/screens/AddProjectPlaceholder.svelte`

> New routing: Connections (home; empty → Add-connection wizard) → select a connection → Projects (filtered by that connection's id) → Workspace. The real Add-project is P5b — for now its button routes to a placeholder.

- [ ] **Step 1: Create `src/screens/AddProjectPlaceholder.svelte`**
```svelte
<script lang="ts">
  import type { Connection } from "../lib/types";
  let { connection, onback }: { connection: Connection; onback?: () => void } = $props();
</script>
<div class="ph" data-testid="addproject-placeholder">
  <h2>Add a project</h2>
  <p class="sub">on {connection.user}@{connection.host}</p>
  <p>The folder → remote copy + sync flow lands in P5b.</p>
  <button class="ghost" onclick={() => onback?.()}>Back</button>
</div>
<style>
  .ph { max-width: 440px; margin: 48px auto; text-align: center; display: flex; flex-direction: column; gap: 10px; }
  .sub { color: var(--text-muted); font-size: 13px; }
  .ghost { background: var(--surface-raised); color: var(--text); padding: 8px 14px; align-self: center; }
</style>
```

- [ ] **Step 2: Update `src/screens/Projects.svelte`** — accept the active connection; filter by `connectionId`; add a back control + show the connection name.

Change props + filter:
```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { projects } from "../lib/stores";
  import { syncCommand } from "../lib/ipc";
  import { syncKindToProjectStatus } from "../lib/sync-events";
  import ProjectRow from "../components/ProjectRow.svelte";
  import type { Project, Connection } from "../lib/types";

  let { connection, onopen, onadd, onback }:
    { connection: Connection; onopen?: (p: Project) => void; onadd?: () => void; onback?: () => void } = $props();
  let query = $state("");
  let mine = $derived($projects.filter((p) => p.connectionId === connection.id));
  let filtered = $derived(mine.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())));

  onMount(async () => {
    for (const p of $projects.filter((x) => x.connectionId === connection.id)) {
      try {
        const line = await syncCommand(p.localPath, "status");
        if (line && line.type === "status") {
          const next = syncKindToProjectStatus(line.status.kind);
          projects.update((list) => list.map((x) => (x.id === p.id ? { ...x, lastStatus: next } : x)));
        }
      } catch { /* best-effort */ }
    }
  });
</script>

<div class="bar">
  <button class="back" data-testid="proj-back" onclick={() => onback?.()}>←</button>
  <h2>{connection.name}</h2>
  <button class="new" data-testid="new-project" onclick={() => onadd?.()}>＋ New</button>
  <input class="search" type="text" placeholder="Search…" bind:value={query} />
</div>

{#if filtered.length === 0}
  <div class="empty" data-testid="projects-empty"><p>No projects yet</p><p class="sub">Add a folder to copy it to {connection.host} and sync.</p></div>
{:else}
  <div class="list">{#each filtered as p (p.id)}<ProjectRow project={p} onopen={(proj) => onopen?.(proj)} />{/each}</div>
{/if}

<style>
  .bar { display: flex; align-items: center; gap: 12px; padding: 16px 20px 10px; }
  .bar h2 { font-size: 15px; margin: 0; flex: 1; }
  .back { background: var(--surface-raised); color: var(--text); padding: 4px 10px; }
  .new { background: var(--accent-strong); color: #fff; font-size: 12px; padding: 7px 13px; font-weight: 600; }
  .search { flex: 1; }
  .empty { text-align: center; color: var(--text-muted); padding: 48px 20px; }
  .empty .sub { font-size: 13px; }
</style>
```
Update `src/screens/Projects.test.ts`: pass a `connection` prop; project fixtures get `connectionId` matching it; assert only matching-connection projects render + the back control.

- [ ] **Step 3: Update `src/App.test.ts`** — new routing:
```ts
import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
import App from "./App.svelte";
import { connections, projects } from "./lib/stores";

beforeEach(() => {
  invokeMock.mockReset(); listenMock.mockReset(); listenMock.mockResolvedValue(() => {});
  connections.set([]); projects.set([]);
});

const conn = { id: "c1", name: "mini", host: "h", user: "u", sshPort: 22, keyPath: "/k", agentPort: 7878, token: "T" };

describe("App routing (connections)", () => {
  it("shows the Connections empty state by default", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_connections") return Promise.resolve([]);
      if (cmd === "list_projects") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const { findByTestId } = render(App);
    expect(await findByTestId("connections-empty")).toBeTruthy();
  });

  it("selecting a connection shows its Projects", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_connections") return Promise.resolve([conn]);
      if (cmd === "list_projects") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const { findByTestId } = render(App);
    await fireEvent.click(await findByTestId("conn-row-c1"));
    expect((await findByTestId("projects-empty")).textContent).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run, verify fail.**

- [ ] **Step 5: Rewrite `src/App.svelte`**
```svelte
<script lang="ts">
  import "./styles/tokens.css";
  import { onMount } from "svelte";
  import { loadConnections, loadProjects } from "./lib/stores";
  import Connections from "./screens/Connections.svelte";
  import Projects from "./screens/Projects.svelte";
  import Workspace from "./screens/Workspace.svelte";
  import SetupWizard from "./screens/SetupWizard.svelte";
  import AddProjectPlaceholder from "./screens/AddProjectPlaceholder.svelte";
  import type { Connection, Project } from "./lib/types";

  let selectedConn = $state<Connection | null>(null);
  let addingConn = $state(false);
  let addingProj = $state(false);
  let opened = $state<Project | null>(null);

  onMount(async () => { await loadConnections(); await loadProjects(); });

  async function onConnectionAdded() { addingConn = false; await loadConnections(); }
</script>

<div data-testid="app-root" class="app">
  {#if opened}
    <Workspace project={opened} onback={() => (opened = null)} />
  {:else if addingConn}
    <SetupWizard onfinish={onConnectionAdded} onback={() => (addingConn = false)} />
  {:else if selectedConn && addingProj}
    <AddProjectPlaceholder connection={selectedConn} onback={() => (addingProj = false)} />
  {:else if selectedConn}
    <Projects connection={selectedConn} onopen={(p) => (opened = p)} onadd={() => (addingProj = true)} onback={() => (selectedConn = null)} />
  {:else}
    <Connections onselect={(c) => (selectedConn = c)} onadd={() => (addingConn = true)} />
  {/if}
</div>

<style>.app { height: 100%; }</style>
```

- [ ] **Step 6: Run the FULL suite** — `pnpm --filter patchwire-desktop test` → ALL green. Fix any straggler referencing removed props (e.g. old `AddProjectDialog` import in App — remove it; `AddProjectDialog.svelte` is now unused by App but may keep its own passing tests; if it references removed model bits, leave it green or delete it if fully orphaned — grep `AddProjectDialog`). Note: `AddProjectDialog.svelte` + its test become orphaned (App no longer routes to it); leave the file+test (still green) OR `git rm` both if you confirm nothing imports it. Prefer deleting if orphaned, to avoid dead code.

- [ ] **Step 7: Rust + boot check** — `export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && pnpm stage-sidecar && cargo check --manifest-path src-tauri/Cargo.toml` (compiles). Optionally `pnpm tauri dev` to eyeball Connections → Add-connection → (back) → select → Projects.

- [ ] **Step 8: Commit**
```bash
git add -A
git commit -m "feat(desktop): Connections→Projects routing; Projects scoped to a connection; add-project placeholder"
```

---

## Self-Review

**Spec coverage (P5a):**
- Connection concept + multiple + persistence → Tasks 1, 2, 3. ✓
- Connections list (home; empty → add) → Tasks 4, 6. ✓
- Add-connection = provision agent-only + save Connection → Tasks 1 (optional args), 5. ✓
- Projects scoped to the selected connection → Tasks 2 (connectionId), 6. ✓
- App routing Connections → Projects → Workspace → Task 6. ✓
- Add-project deferred to P5b (placeholder) → Task 6. ✓
- Reuse provision/sync/chat/workspace unchanged. ✓

**Placeholder scan:** `AddProjectPlaceholder` is an intentional P5b swap point (a real screen). No TBDs. Task 6 flags the orphaned `AddProjectDialog` for deletion-if-orphaned.

**Type consistency:** `Connection` defined once (types.ts), used by model/ipc/stores/screens. `Project.connectionId` added (Task 2), filtered in Projects (Task 6), carried by build/parse (Task 2). IPC `list_connections`/`save_connection`/`delete_connection` match Rust (Task 1) + ipc (Task 3) + tests. `ProvisionArgs` project fields optional in both Rust (Task 1) and TS (Task 3); the re-scoped wizard omits them (Task 5).

## Follow-on
- **P5b:** the real Add-project flow (connection dropdown + folder + auto remote path → write `patchwire.yml` from the connection + initial push + `sync-start` → save Project with `connectionId`). Replaces `AddProjectPlaceholder`. Also writes the project yml that the latent P4b gap never did.
- A later pass: per-connection health dot on the Connections list (host-check); fill `agentVersion` post-provision; edit/rename connections.
