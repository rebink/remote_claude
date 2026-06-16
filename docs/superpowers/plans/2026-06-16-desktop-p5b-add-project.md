# Desktop Developer Client — Phase 5b (Add-project: copy + sync) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `AddProjectPlaceholder` with the real Add-project flow: pick a connection (default current) + a local folder + remote path (auto `~/patchwire/<name>`) → write the project's `patchwire.yml` from the chosen connection → create the remote copy (initial push) → start continuous sync → save the Project under that connection.

**Architecture:** The project's `patchwire.yml` is written by a Rust command from the connection's details with the connection's **literal token** (the yml is gitignored; the token reaches Rust via the in-process IPC payload, never on a command line). The initial remote copy uses the CLI `init-remote --from-local` (which creates the remote dir + pushes; plain `sync` does not create the dir). Continuous sync reuses `sync-start` (P3a). The Project is saved with its `connectionId` (P5a).

**Tech Stack:** Tauri 2 + tauri-plugin-shell, Svelte 5 runes, Vitest + @testing-library/svelte, Rust (std::fs + sidecar), the `patchwire` CLI (`init-remote`, `sync-start`).

**Spec:** `docs/superpowers/specs/2026-06-16-desktop-connections-and-projects-design.md` (Flow B). **Builds on P5a** (Connections, `Project.connectionId`, `AddProjectPlaceholder`, `selectedConn`/`addingProj` routing).

**Locked decision:** **literal connection token** in the gitignored `patchwire.yml` (no global `${PW_TOKEN}` collision; the existing config loader passes a literal through `interpolateEnv` untouched).

**Verified facts:**
- `patchwire.yml` and `.patchwire/` are gitignored → a literal token in the yml is never committed.
- The CLI `config` loader expands only `${VAR}` patterns; a literal token string passes through unchanged.
- Plain `sync`/`rsyncPush` does NOT create the remote dir; `init-remote --from-local` does (mkdir over SSH + rsync). [Task 1 confirms its exact flags.]
- `sync-start` (P3a, via `sync_command(localPath, "start")`) builds its mutagen target from the project's `patchwire.yml` (must exist first, with a resolvable token).
- `buildProject(localPath, remotePath, name, host, user, connectionId)` and `defaultRemotePath(name)` already exist (P5a / `wizard.ts`).
- `AddProjectPlaceholder.svelte` props: `{ connection, onback }`; App routes it at `selectedConn && addingProj`.

**Working dir:** `packages/desktop`. Tests: `pnpm --filter patchwire-desktop test`.

---

## File Structure
**Rust:** Modify `src-tauri/src/lib.rs` — add `write_project_yml` (writes the project yml with a literal token) + `init_remote_copy` (sidecar `init-remote --from-local`); register both.
**Frontend:**
- Modify `src/lib/ipc.ts` (+ test) — `writeProjectYml(args)`, `initRemoteCopy(localPath)`.
- Modify `src/lib/wizard.ts` (+ test) if needed — reuse `defaultRemotePath`; add `remoteProjectPath(name)` = `~/patchwire/<name>` (or reuse defaultRemotePath if it already is `~/workspace/...` — see Task 2).
- Create `src/screens/AddProject.svelte` (+ test) — the flow.
- Modify `src/App.svelte` (+ test) — route `addingProj` → `AddProject` (pass connections + current); on finish reload projects.
- Delete `src/screens/AddProjectPlaceholder.svelte`.

---

### Task 1: Rust — write_project_yml + init_remote_copy

**Files:** Modify `src-tauri/src/lib.rs`

> READ first: `packages/cli/src/commands/setup.ts` `writeYaml` (the yml template) to mirror its shape; and `packages/cli/src/cli.ts` + the `init-remote` command implementation for its EXACT flags + behavior (it must create the remote dir + push from local). Mirror the existing one-shot sidecar pattern (`read_project_config`/`sync_command`: `.current_dir` + `.output().await`).

- [ ] **Step 1: Add `write_project_yml`** — writes `<project_dir>/patchwire.yml` with the LITERAL token (token arrives in the IPC payload, never argv). Mirror `writeYaml`'s shape but with the literal token:
```rust
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectYmlArgs {
    project_dir: String,
    project: String,
    host: String,
    user: String,
    ssh_port: u16,
    agent_port: u16,
    remote_path: String,
    token: String,
}

#[tauri::command]
fn write_project_yml(args: ProjectYmlArgs) -> Result<(), String> {
    if !std::path::Path::new(&args.project_dir).is_dir() { return Err("project_dir does not exist".into()); }
    // Validate host/user with the existing safe_token allowlist (no injection into the yml).
    if !safe_token(&args.host) || !safe_token(&args.user) { return Err("invalid host/user".into()); }
    let yml = format!(
        "project: {project}\nremote:\n  host: {host}\n  user: {user}\n  path: {path}\n  sshPort: {ssh}\n  agentUrl: http://{host}:{ap}\n  token: {token}\nsync:\n  exclude:\n    - build/\n    - .dart_tool/\n    - ios/Pods/\n    - node_modules/\n    - .git/\nai:\n  command: claude\n  args:\n    - --print\n  timeoutSec: 600\n",
        project = args.project, host = args.host, user = args.user, path = args.remote_path,
        ssh = args.ssh_port, ap = args.agent_port, token = args.token,
    );
    std::fs::write(std::path::Path::new(&args.project_dir).join("patchwire.yml"), yml).map_err(|e| e.to_string())
}
```
(Adapt the yml string to match `writeYaml`'s exact shape after reading it — keep field order/keys identical, only swapping `${PW_TOKEN}` for the literal `token`. Confirm `safe_token` exists from P4b.)

- [ ] **Step 2: Add `init_remote_copy`** — run the CLI initial-copy command in the project dir. After reading `init-remote`'s real flags, build the right argv (it must create the remote dir + push). Expected shape:
```rust
#[tauri::command]
async fn init_remote_copy(app: tauri::AppHandle, project_dir: String) -> Result<String, String> {
    use tauri_plugin_shell::ShellExt;
    if !std::path::Path::new(&project_dir).is_dir() { return Err("project_dir does not exist".into()); }
    let sidecar = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?;
    let output = sidecar
        .current_dir(std::path::PathBuf::from(&project_dir))
        .args(["init-remote", "--from-local", "--use-existing"]) // ADAPT to real init-remote flags (read cli.ts); add --project if required
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!("init-remote failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(String::from_utf8_lossy(&output.stdout).lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("ok").to_string())
}
```
(IMPORTANT: read the real `init-remote` command — if it requires `--project <name>`, pass it; if it needs a flag to create the dir when missing, use the correct one — `--use-existing` vs `--overwrite` vs default. The goal: create `remotePath` on the remote if absent + push the local folder. init-remote reads `patchwire.yml` for host/user/path — which `write_project_yml` wrote first.)

- [ ] **Step 3: Register** `write_project_yml, init_remote_copy` in `generate_handler!` (keep all; now 25).

- [ ] **Step 4: cargo check**

Run: `export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && pnpm stage-sidecar && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles.

- [ ] **Step 5: Commit**
```bash
git add packages/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): write_project_yml (literal token) + init_remote_copy (initial push)"
```

---

### Task 2: IPC + path helper (TDD)

**Files:** Modify `src/lib/ipc.ts` (+ test); Modify `src/lib/wizard.ts` (+ test)

- [ ] **Step 1: Check `defaultRemotePath`** — `wizard.ts` has `defaultRemotePath(name)`. The spec wants `~/patchwire/<name>`. If `defaultRemotePath` returns `~/workspace/<name>`, add a `remoteProjectPath(name)` returning `~/patchwire/${name}` (don't change the wizard's existing default if other code relies on it). Add a test for it.

- [ ] **Step 2: Add failing ipc tests to `src/lib/ipc.test.ts`**
```ts
import { writeProjectYml, initRemoteCopy } from "./ipc";

describe("add-project ipc", () => {
  it("writeProjectYml invokes write_project_yml with all fields", async () => {
    invokeMock.mockResolvedValue(undefined);
    const a = { projectDir: "/l/api", project: "api", host: "h", user: "u", sshPort: 22, agentPort: 7878, remotePath: "~/patchwire/api", token: "T" };
    await writeProjectYml(a);
    expect(invokeMock).toHaveBeenCalledWith("write_project_yml", { args: a });
  });
  it("initRemoteCopy invokes init_remote_copy with the project dir", async () => {
    invokeMock.mockResolvedValue("ok");
    expect(await initRemoteCopy("/l/api")).toBe("ok");
    expect(invokeMock).toHaveBeenCalledWith("init_remote_copy", { projectDir: "/l/api" });
  });
});
```

- [ ] **Step 3: Add to `src/lib/ipc.ts`**
```ts
export interface ProjectYmlArgs {
  projectDir: string; project: string; host: string; user: string;
  sshPort: number; agentPort: number; remotePath: string; token: string;
}
export async function writeProjectYml(args: ProjectYmlArgs): Promise<void> {
  await invoke("write_project_yml", { args });
}
export async function initRemoteCopy(projectDir: string): Promise<string> {
  return invoke<string>("init_remote_copy", { projectDir });
}
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter patchwire-desktop test src/lib/ipc.test.ts src/lib/wizard.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add packages/desktop/src/lib/ipc.ts packages/desktop/src/lib/ipc.test.ts packages/desktop/src/lib/wizard.ts packages/desktop/src/lib/wizard.test.ts
git commit -m "feat(desktop): add-project ipc (writeProjectYml/initRemoteCopy) + remote path helper"
```

---

### Task 3: AddProject screen (TDD)

**Files:** Create `src/screens/AddProject.svelte` (+ test)

> The flow: connection dropdown (options = `$connections`, default = the passed `connection`) + "Choose folder…" (`pickFolder`) + remote path input (auto-filled `~/patchwire/<basename>`, editable). On "Create": `writeProjectYml(...)` → `initRemoteCopy(localPath)` → `syncCommand(localPath, "start")` → `saveProject(buildProject(localPath, remotePath, name, conn.host, conn.user, conn.id))` → `onfinish()`. Show a small step status (writing config / copying / starting sync) + errors. Disable Create until a folder is chosen.

- [ ] **Step 1: Write `src/screens/AddProject.test.ts`**
```ts
import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
const invokeMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));
import AddProject from "./AddProject.svelte";
import { connections } from "../lib/stores";

const conn = { id: "c1", name: "mini", host: "studio-mini", user: "rebin", sshPort: 22, keyPath: "/k", agentPort: 7878, token: "TKN" };

beforeEach(() => { invokeMock.mockReset(); openMock.mockReset(); connections.set([conn]); });

describe("AddProject", () => {
  it("disables Create until a folder is chosen", () => {
    const { getByTestId } = render(AddProject, { props: { connection: conn } });
    expect((getByTestId("create-project") as HTMLButtonElement).disabled).toBe(true);
  });

  it("picks a folder and auto-fills the remote path", async () => {
    openMock.mockResolvedValue("/home/r/api");
    const { getByTestId } = render(AddProject, { props: { connection: conn } });
    await fireEvent.click(getByTestId("pick-folder"));
    await Promise.resolve();
    expect((getByTestId("remote-path") as HTMLInputElement).value).toBe("~/patchwire/api");
    expect((getByTestId("create-project") as HTMLButtonElement).disabled).toBe(false);
  });

  it("creates the project: write yml → init copy → sync start → save → onfinish", async () => {
    openMock.mockResolvedValue("/home/r/api");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "init_remote_copy") return Promise.resolve("ok");
      if (cmd === "sync_command") return Promise.resolve('{"type":"sync_action","action":"start","ok":true}');
      return Promise.resolve(undefined); // write_project_yml, save_project
    });
    const onfinish = vi.fn();
    const { getByTestId } = render(AddProject, { props: { connection: conn, onfinish } });
    await fireEvent.click(getByTestId("pick-folder"));
    await Promise.resolve();
    await fireEvent.click(getByTestId("create-project"));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith("write_project_yml", { args: expect.objectContaining({
      projectDir: "/home/r/api", project: "api", host: "studio-mini", user: "rebin", remotePath: "~/patchwire/api", token: "TKN",
    }) });
    expect(invokeMock).toHaveBeenCalledWith("init_remote_copy", { projectDir: "/home/r/api" });
    expect(invokeMock).toHaveBeenCalledWith("sync_command", { projectDir: "/home/r/api", sub: "start" });
    expect(invokeMock).toHaveBeenCalledWith("save_project", expect.objectContaining({
      project: expect.objectContaining({ name: "api", localPath: "/home/r/api", remotePath: "~/patchwire/api", host: "studio-mini", user: "rebin", connectionId: "c1" }),
    }));
    expect(onfinish).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Write `src/screens/AddProject.svelte`**
```svelte
<script lang="ts">
  import { connections } from "../lib/stores";
  import { pickFolder, writeProjectYml, initRemoteCopy, syncCommand, saveProject } from "../lib/ipc";
  import { buildProject } from "../lib/model";
  import type { Connection } from "../lib/types";

  let { connection, onfinish, onback }: { connection: Connection; onfinish?: () => void; onback?: () => void } = $props();

  let connId = $state(connection.id);
  let localPath = $state("");
  let name = $state("");
  let remotePath = $state("");
  let busy = $state(false);
  let phase = $state("");
  let error = $state("");

  let chosen = $derived($connections.find((c) => c.id === connId) ?? connection);
  let canCreate = $derived(localPath.trim() !== "" && remotePath.trim() !== "");

  function basename(p: string): string { return p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? ""; }

  async function choose() {
    const dir = await pickFolder();
    if (!dir) return;
    localPath = dir;
    name = basename(dir);
    remotePath = `~/patchwire/${name}`;
  }

  async function create() {
    error = ""; busy = true;
    try {
      phase = "Writing config…";
      await writeProjectYml({ projectDir: localPath, project: name, host: chosen.host, user: chosen.user, sshPort: chosen.sshPort, agentPort: chosen.agentPort, remotePath, token: chosen.token });
      phase = "Copying to remote…";
      await initRemoteCopy(localPath);
      phase = "Starting sync…";
      await syncCommand(localPath, "start");
      await saveProject(buildProject(localPath, remotePath, name, chosen.host, chosen.user, chosen.id));
      onfinish?.();
    } catch (e) {
      error = `Failed: ${e}`;
    } finally {
      busy = false;
    }
  }
</script>

<div class="add">
  <header><button class="back" onclick={() => onback?.()}>←</button><span>Add a project</span></header>

  <label>Connection
    <select aria-label="Connection" data-testid="connection-select" bind:value={connId}>
      {#each $connections as c (c.id)}<option value={c.id}>{c.name} ({c.user}@{c.host})</option>{/each}
    </select>
  </label>

  <button class="ghost" data-testid="pick-folder" onclick={choose}>Choose folder…</button>
  <label>Local path<input aria-label="Local path" data-testid="local-path" bind:value={localPath} readonly /></label>
  <label>Remote path<input aria-label="Remote path" data-testid="remote-path" bind:value={remotePath} /></label>

  {#if phase}<div class="phase" data-testid="add-phase">{phase}</div>{/if}
  {#if error}<div class="error" role="alert" data-testid="add-error">{error}</div>{/if}

  <button class="primary" data-testid="create-project" disabled={!canCreate || busy} onclick={create}>
    {busy ? "Working…" : "Create"}
  </button>
</div>

<style>
  .add { max-width: 460px; margin: 32px auto; display: flex; flex-direction: column; gap: 12px; padding: 0 20px; }
  header { display: flex; align-items: center; gap: 10px; color: var(--text-muted); font-size: 12px; }
  .back { background: var(--surface-raised); color: var(--text); padding: 3px 9px; }
  label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--text-muted); }
  label input, label select { color: var(--text); background: var(--surface-base); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 8px 10px; }
  .ghost { background: var(--surface-raised); color: var(--text); padding: 8px 14px; align-self: flex-start; }
  .primary { background: var(--accent-strong); color: #fff; padding: 9px; font-weight: 600; }
  .primary:disabled { opacity: .5; cursor: not-allowed; }
  .phase { color: var(--warn); font-size: 12px; }
  .error { color: var(--error); font-size: 12px; }
</style>
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter patchwire-desktop test src/screens/AddProject.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add packages/desktop/src/screens/AddProject.svelte packages/desktop/src/screens/AddProject.test.ts
git commit -m "feat(desktop): AddProject screen (folder → remote copy + sync, scoped to a connection)"
```

---

### Task 4: Wire into App; remove placeholder; full verify (TDD)

**Files:** Modify `src/App.svelte` (+ test); Delete `src/screens/AddProjectPlaceholder.svelte`

- [ ] **Step 1: Update `src/App.test.ts`** — add a test that the add-project route renders the real `AddProject` (testid `create-project` or the connection select) instead of the placeholder. Drive: with a connection selected, trigger `onadd` (the Projects "＋ New") → assert `AddProject` mounts. (Use the existing pattern: list_connections returns one conn, select it via `conn-row-<id>`, click `new-project`, assert `create-project` present.)

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Update `src/App.svelte`** — swap the import + route:
```svelte
  import AddProject from "./screens/AddProject.svelte";
  ...
  {:else if selectedConn && addingProj}
    <AddProject connection={selectedConn} onfinish={async () => { addingProj = false; await loadProjects(); }} onback={() => (addingProj = false)} />
```
Remove the `AddProjectPlaceholder` import.

- [ ] **Step 4: Delete the placeholder**
```bash
git rm packages/desktop/src/screens/AddProjectPlaceholder.svelte
```
(grep `src/` for `AddProjectPlaceholder` — remove any stragglers.)

- [ ] **Step 5: Run the FULL suite** — `pnpm --filter patchwire-desktop test` → ALL green.

- [ ] **Step 6: Rust + boot check** — `export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && pnpm stage-sidecar && cargo check --manifest-path src-tauri/Cargo.toml`. Optionally `pnpm tauri dev` to eyeball Connections → select → ＋ New → AddProject.

- [ ] **Step 7: Manual E2E (human, best effort)** — with a real connection: add a project (pick a folder) → confirm the remote copy appears + sync starts + the project opens to a working workspace (chat/diff/apply). Document what couldn't be verified.

- [ ] **Step 8: Commit**
```bash
git add packages/desktop/src/App.svelte packages/desktop/src/App.test.ts
git commit -m "feat(desktop): route add-project to the real AddProject; remove placeholder"
```

---

## Self-Review

**Spec coverage (P5b, Flow B):**
- Pick connection (dropdown, default current) → Task 3. ✓
- Pick local folder + auto remote path `~/patchwire/<name>` (editable) → Tasks 2, 3. ✓
- Write `patchwire.yml` from the connection (literal token, gitignored) → Tasks 1, 3. ✓
- Create remote copy (initial push, creates the dir) → Task 1 (`init_remote_copy`/`init-remote --from-local`), Task 3. ✓
- Start continuous sync → Task 3 (`sync_command "start"`). ✓
- Save Project with `connectionId` → Task 3 (`buildProject(..., conn.id)`). ✓
- Replace placeholder + route → Task 4. ✓
- Fixes the latent P4b gap (a project now gets a real `patchwire.yml`). ✓

**Placeholder scan:** No TBD. Task 1 explicitly instructs reading `init-remote`'s real flags + `writeYaml`'s exact yml shape before finalizing — the interface/tests are specified; only the exact init-remote argv is resolved by reading (its flags aren't fully quoted here).

**Type consistency:** `ProjectYmlArgs` defined in Rust (Task 1) + TS (Task 2) with matching camelCase fields. `write_project_yml`/`init_remote_copy` command names match Rust/ipc/tests. `buildProject(localPath, remotePath, name, host, user, connectionId)` (P5a) used in Task 3. `sync_command(localPath,"start")` (P3a) reused. Token reaches Rust via IPC payload (not argv); validated with `safe_token` before writing the yml.

## Follow-on
- Consolidate the yml template (currently `writeYaml` in the CLI + `write_project_yml` in Rust) into one source if drift becomes a concern.
- Stream `init-remote` progress (it can be slow) instead of one-shot `.output()` — a later polish.
- The P5a `activeConnectionId` store is still unused — wire it (persist the selected connection across relaunch) or drop it.
- Per-connection health dot on the Connections list (host-check).
