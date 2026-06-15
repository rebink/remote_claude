# Desktop Developer Client — Phase 4a (per-project connection model refactor) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the desktop's global single-connection model and make projects self-describing (each project's remote comes from its own `patchwire.yml`). After P4a the app lists per-project rows showing each project's own `user@host` + sync status, with no global Connect screen; adding a folder that already has a `patchwire.yml` works fully, and a folder without one routes to a wizard placeholder (filled in P4b).

**Architecture:** A new CLI `config-show --json` seam prints a project's parsed config (safe subset — no token). A Rust `read_project_config` runs it via the sidecar with `current_dir` = the project folder. The frontend builds a `Project` (now carrying `host`/`user`) from that config. The global `connection` store / `connection.json` / `Connect` screen / `ConnectionBar` are deleted; `App` routes `Projects | Workspace | Wizard-placeholder`.

**Tech Stack:** Tauri 2 + tauri-plugin-shell, Svelte 5 (runes), Vitest + @testing-library/svelte, the `patchwire` CLI.

**Spec:** `docs/superpowers/specs/2026-06-15-desktop-per-project-connection-design.md`. **Revises** P1 (single global connection). Sync (P3) already per-project — unchanged. Workspace (P2/P3) — unchanged.

**Working dir:** `packages/desktop` (CLI task: `packages/cli`). Desktop tests: `pnpm --filter patchwire-desktop test`. CLI tests: `pnpm --filter @rebink/patchwire test` (tests in `packages/cli/test/**`).

---

## File Structure
**CLI:** Create `packages/cli/src/commands/config-show.ts` + register in `cli.ts`; test `packages/cli/test/config-show.test.ts`.
**Rust:** Modify `src-tauri/src/lib.rs` — add `read_project_config`, remove `read_connection`/`save_connection`, update handler.
**Frontend:**
- Modify `src/lib/types.ts` — `Project` gains `host`/`user`; remove `Connection`/`HostArgs`/`HealthResult`. Add `ProjectConfig`.
- Modify `src/lib/model.ts` (+ test) — `buildProject` carries host/user; add `projectFromConfig`; `parseProjects` carries host/user; remove `connectionToHostArgs`/`isConnectionComplete`/`parseHealth`.
- Modify `src/lib/ipc.ts` (+ test) — add `readProjectConfig`; remove `readConnection`/`saveConnection`/`checkHealth`.
- Modify `src/lib/stores.ts` (+ test) — remove `connection`/`route`/`loadConnection`; keep `projects`/`loadProjects`.
- Modify `src/components/ProjectRow.svelte` (+ test) — add a `user@host` line.
- Modify `src/components/AddProjectDialog.svelte` (+ test) — folder pick branches (has-config → add; no-config → `onneedssetup`).
- Modify `src/screens/Projects.svelte` (+ test) — drop `ConnectionBar` + global health; keep per-project sync status.
- Rewrite `src/App.svelte` (+ test) — routes Projects/Workspace/WizardPlaceholder; no connect route.
- Create `src/screens/SetupWizardPlaceholder.svelte` (P4b replaces it).
- **Delete:** `src/screens/Connect.svelte` (+ test), `src/components/ConnectionBar.svelte` (+ test).

---

### Task 1: CLI `config-show --json`

**Files:**
- Create: `packages/cli/src/commands/config-show.ts`
- Modify: `packages/cli/src/cli.ts`
- Test: `packages/cli/test/config-show.test.ts`

> Prints a SAFE subset of the loaded config as one JSON line — `project`, `host`, `user`, `remotePath`, `sshPort`. **Never print the token or agentUrl.** Read `packages/cli/src/lib/config.ts` for `loadConfig(cwd)` and the schema (`remote.host/user/path/sshPort`, `project`).

- [ ] **Step 1: Write the failing test `packages/cli/test/config-show.test.ts`**

Match the existing CLI test style (temp dir + a written `patchwire.yml`; look at `apply.test.ts`/`config.test.ts`):
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runConfigShow } from "../src/commands/config-show.ts";

const YML = `project: api-server
remote:
  host: studio-mini
  user: rebin
  path: ~/workspace/api-server
  agentUrl: http://100.100.100.100:7878
  token: SECRET_TOKEN
  sshPort: 22
`;

describe("runConfigShow --json", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pw-cfg-"));
    await writeFile(join(dir, "patchwire.yml"), YML, "utf8");
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("prints a safe config subset (no token/agentUrl)", async () => {
    const lines: string[] = [];
    await runConfigShow(dir, { json: true, print: (s) => lines.push(s) });
    const out = JSON.parse(lines.at(-1)!);
    expect(out).toEqual({
      type: "config", project: "api-server", host: "studio-mini",
      user: "rebin", remotePath: "~/workspace/api-server", sshPort: 22,
    });
    expect(lines.at(-1)).not.toContain("SECRET_TOKEN");
    expect(lines.at(-1)).not.toContain("agentUrl");
  });

  it("emits a JSON error line when no patchwire.yml", async () => {
    await rm(join(dir, "patchwire.yml"));
    const lines: string[] = [];
    await runConfigShow(dir, { json: true, print: (s) => lines.push(s) });
    expect(JSON.parse(lines.at(-1)!).type).toBe("error");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @rebink/patchwire test config-show.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `packages/cli/src/commands/config-show.ts`**

Adapt to the real `loadConfig` export/signature:
```ts
import { loadConfig } from "../lib/config.ts"; // adapt to the real export

interface ConfigShowOpts { json?: boolean; print?: (line: string) => void }

export async function runConfigShow(cwd: string, opts: ConfigShowOpts = {}): Promise<void> {
  const print = opts.print ?? ((l: string) => console.log(l));
  try {
    const cfg = await loadConfig(cwd); // if loadConfig is sync, drop await
    print(JSON.stringify({
      type: "config",
      project: cfg.project,
      host: cfg.remote.host,
      user: cfg.remote.user,
      remotePath: cfg.remote.path,
      sshPort: cfg.remote.sshPort ?? 22,
    }));
  } catch (e) {
    print(JSON.stringify({ type: "error", message: String(e) }));
  }
}
```

- [ ] **Step 4: Register in `cli.ts`** (flat command, matching `host-check` style):
```ts
program
  .command("config-show")
  .description("Print this project's config as JSON (safe subset, no token)")
  .option("--json", "JSON output", true)
  .action(async () => {
    const { runConfigShow } = await import("./commands/config-show.ts");
    await runConfigShow(process.cwd(), { json: true });
  });
```

- [ ] **Step 5: Run tests + full CLI suite**

Run: `pnpm --filter @rebink/patchwire test config-show.test.ts` then `pnpm --filter @rebink/patchwire test`
Expected: PASS; full suite green.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/config-show.ts packages/cli/src/cli.ts packages/cli/test/config-show.test.ts
git commit -m "feat(cli): config-show --json (safe per-project config for the desktop)"
```

---

### Task 2: Rust `read_project_config`; remove connection commands

**Files:**
- Modify: `src-tauri/src/lib.rs`

> Add a one-shot sidecar command (mirror `sync_command`'s `.output()` + `current_dir` pattern). Remove the now-dead `read_connection`/`save_connection`.

- [ ] **Step 1: Add `read_project_config`**
```rust
#[tauri::command]
async fn read_project_config(app: tauri::AppHandle, project_dir: String) -> Result<String, String> {
    use tauri_plugin_shell::ShellExt;
    if project_dir.trim().is_empty() { return Err("project_dir is required".into()); }
    if !std::path::Path::new(&project_dir).is_dir() { return Err("project_dir does not exist".into()); }
    let sidecar = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?;
    let output = sidecar
        .current_dir(std::path::PathBuf::from(&project_dir))
        .args(["config-show", "--json"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").to_string();
    if line.is_empty() {
        return Err(format!("config-show produced no output: {}", String::from_utf8_lossy(&output.stderr)));
    }
    Ok(line)
}
```

- [ ] **Step 2: Delete `read_connection` and `save_connection`** functions (verbatim current code is the two `fn read_connection`/`fn save_connection` blocks). Remove both. Keep `data_file`, `list_projects`, `save_project` (still used).

- [ ] **Step 3: Update `generate_handler!`** — remove `read_connection`, `save_connection`; add `read_project_config`. The list becomes:
```rust
.invoke_handler(tauri::generate_handler![
    start_provision, send_consent, save_host, list_hosts, delete_host,
    host_health, host_uninstall, host_logs,
    list_projects, save_project, read_project_config,
    start_chat, cancel_chat, apply_patch,
    start_sync_watch, stop_sync_watch, sync_command
])
```

- [ ] **Step 4: Verify compiles**

Run: `export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && pnpm stage-sidecar && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles (an unused-warning for `data_file` is fine if it remains used by list/save_project).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): rust read_project_config; remove global connection commands"
```

---

### Task 3: Types + model (TDD)

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/model.ts`
- Modify: `src/lib/model.test.ts`

- [ ] **Step 1: Update the failing tests in `src/lib/model.test.ts`**

Remove the `connectionToHostArgs`/`isConnectionComplete`/`parseHealth` describe blocks (those functions are being deleted). Add:
```ts
import { buildProject, projectFromConfig, parseProjects } from "./model";

describe("buildProject with host/user", () => {
  it("includes host and user", () => {
    const p = buildProject("/l/api", "/r/api", "api", "studio-mini", "rebin");
    expect(p.host).toBe("studio-mini");
    expect(p.user).toBe("rebin");
    expect(p.remotePath).toBe("/r/api");
  });
  it("defaults host/user to empty when omitted", () => {
    const p = buildProject("/l/api", "/r/api");
    expect(p.host).toBe("");
    expect(p.user).toBe("");
  });
});

describe("projectFromConfig", () => {
  it("builds a Project from a config-show JSON object", () => {
    const cfg = { type: "config", project: "api", host: "h", user: "u", remotePath: "/r/api", sshPort: 22 };
    const p = projectFromConfig("/l/api", cfg);
    expect(p).toMatchObject({ name: "api", host: "h", user: "u", localPath: "/l/api", remotePath: "/r/api", branch: "main", lastStatus: "unknown", syncPaused: false });
    expect(p.id.length).toBeGreaterThan(0);
  });
});

describe("parseProjects carries host/user", () => {
  it("preserves host/user, defaults to empty", () => {
    const out = parseProjects([
      { id: "a", name: "api", localPath: "/l", remotePath: "/r", host: "h", user: "u" },
      { id: "b", name: "web", localPath: "/l2", remotePath: "/r2" },
    ]);
    expect(out[0].host).toBe("h"); expect(out[0].user).toBe("u");
    expect(out[1].host).toBe(""); expect(out[1].user).toBe("");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter patchwire-desktop test src/lib/model.test.ts`
Expected: FAIL (new exports/signature; deleted-fn tests removed).

- [ ] **Step 3: Update `src/lib/types.ts`**

Add to `Project`: `host: string;` and `user: string;`. Remove `Connection`, `HostArgs`, `HealthResult` interfaces. Add:
```ts
export interface ProjectConfig {
  type: "config";
  project: string;
  host: string;
  user: string;
  remotePath: string;
  sshPort: number;
}
```

- [ ] **Step 4: Update `src/lib/model.ts`**

- `buildProject(localPath, remotePath, name?, host = "", user = "")` → include `host`, `user` in the returned object.
- Add:
```ts
import type { Project, ProjectConfig } from "./types";
export function projectFromConfig(localPath: string, cfg: ProjectConfig): Project {
  return {
    id: crypto.randomUUID(),
    name: cfg.project,
    branch: "main",
    localPath,
    remotePath: cfg.remotePath,
    host: cfg.host,
    user: cfg.user,
    lastStatus: "unknown",
    syncPaused: false,
  };
}
```
- `parseProjects`: when coercing each record, add `host: typeof o.host === "string" ? o.host : ""` and `user: typeof o.user === "string" ? o.user : ""`.
- Delete `connectionToHostArgs`, `isConnectionComplete`, `parseHealth` (and their now-unused imports of `Connection`/`HostArgs`/`HealthResult`).

- [ ] **Step 5: Run, verify pass (full suite may still fail elsewhere — that's expected until later tasks; run just this file)**

Run: `pnpm --filter patchwire-desktop test src/lib/model.test.ts`
Expected: PASS for model.test.ts.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/lib/types.ts packages/desktop/src/lib/model.ts packages/desktop/src/lib/model.test.ts
git commit -m "feat(desktop): Project carries host/user; projectFromConfig; drop Connection model"
```

---

### Task 4: IPC — `readProjectConfig`; drop connection wrappers (TDD)

**Files:**
- Modify: `src/lib/ipc.ts`
- Modify: `src/lib/ipc.test.ts`

- [ ] **Step 1: Update `src/lib/ipc.test.ts`**

Remove the `readConnection`/`saveConnection`/`checkHealth` describe blocks. Add:
```ts
import { readProjectConfig } from "./ipc";

describe("readProjectConfig", () => {
  it("invokes read_project_config and parses the config JSON line", async () => {
    invokeMock.mockResolvedValue('{"type":"config","project":"api","host":"h","user":"u","remotePath":"/r","sshPort":22}');
    const cfg = await readProjectConfig("/l/api");
    expect(invokeMock).toHaveBeenCalledWith("read_project_config", { projectDir: "/l/api" });
    expect(cfg).toEqual({ type: "config", project: "api", host: "h", user: "u", remotePath: "/r", sshPort: 22 });
  });
  it("returns null on an error line or unparseable output", async () => {
    invokeMock.mockResolvedValue('{"type":"error","message":"no config"}');
    expect(await readProjectConfig("/l/api")).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter patchwire-desktop test src/lib/ipc.test.ts`
Expected: FAIL (new export missing; deleted-fn tests removed).

- [ ] **Step 3: Update `src/lib/ipc.ts`**

Remove `readConnection`, `saveConnection`, `checkHealth` and their now-unused imports (`Connection`, `HealthResult`, `connectionToHostArgs`, `parseHealth`). Add:
```ts
import type { ProjectConfig } from "./types";

export async function readProjectConfig(projectDir: string): Promise<ProjectConfig | null> {
  const line = await invoke<string>("read_project_config", { projectDir });
  try {
    const o = JSON.parse(line);
    return o && o.type === "config" ? (o as ProjectConfig) : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter patchwire-desktop test src/lib/ipc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/lib/ipc.ts packages/desktop/src/lib/ipc.test.ts
git commit -m "feat(desktop): readProjectConfig ipc; drop connection wrappers"
```

---

### Task 5: Stores — drop global connection (TDD)

**Files:**
- Modify: `src/lib/stores.ts`
- Modify: `src/lib/stores.test.ts`

- [ ] **Step 1: Update `src/lib/stores.test.ts`**

Remove the `route`/`loadConnection`/`connection` tests. Keep/adjust `loadProjects`. New content:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";
const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
import { projects, loadProjects } from "./stores";

beforeEach(() => { invokeMock.mockReset(); projects.set([]); });

describe("loadProjects", () => {
  it("populates the projects store from IPC", async () => {
    invokeMock.mockResolvedValue([{ id: "a", name: "api", localPath: "/l", remotePath: "/r", host: "h", user: "u" }]);
    await loadProjects();
    expect(get(projects)).toHaveLength(1);
    expect(get(projects)[0].host).toBe("h");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter patchwire-desktop test src/lib/stores.test.ts`
Expected: FAIL (removed exports referenced / new shape).

- [ ] **Step 3: Rewrite `src/lib/stores.ts`**
```ts
import { writable } from "svelte/store";
import type { Project } from "./types";
import { listProjects } from "./ipc";

export const projects = writable<Project[]>([]);

export async function loadProjects(): Promise<void> {
  projects.set(await listProjects());
}
```
(Removes `connection`, `route`, `loadConnection`, `readConnection` import, `derived`.)

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter patchwire-desktop test src/lib/stores.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/lib/stores.ts packages/desktop/src/lib/stores.test.ts
git commit -m "refactor(desktop): drop connection/route stores; projects-only"
```

---

### Task 6: ProjectRow shows user@host (TDD)

**Files:**
- Modify: `src/components/ProjectRow.svelte`
- Modify: `src/components/ProjectRow.test.ts`

- [ ] **Step 1: Add a failing test** to `src/components/ProjectRow.test.ts` (the existing test's `project` fixture must gain `host`/`user`; add them, then):
```ts
it("shows the project's own user@host", () => {
  const { getByTestId } = render(ProjectRow, { props: { project: { ...project, host: "studio-mini", user: "rebin" } } });
  expect(getByTestId("row-remote").textContent).toBe("rebin@studio-mini");
});
```
(Update the shared `project` fixture in that file to include `host`/`user`.)

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter patchwire-desktop test src/components/ProjectRow.test.ts`
Expected: FAIL — no `row-remote`.

- [ ] **Step 3: Update `src/components/ProjectRow.svelte`** — add a remote line in the `.body` block (between title and path):
```svelte
<div class="remote" data-testid="row-remote">{project.user}@{project.host}</div>
```
Add a minimal style: `.remote { color: var(--text-muted); font-size: 11px; }`.

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter patchwire-desktop test src/components/ProjectRow.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/components/ProjectRow.svelte packages/desktop/src/components/ProjectRow.test.ts
git commit -m "feat(desktop): ProjectRow shows per-project user@host"
```

---

### Task 7: AddProjectDialog branches on patchwire.yml (TDD)

**Files:**
- Modify: `src/components/AddProjectDialog.svelte`
- Modify: `src/components/AddProjectDialog.test.ts`

> New flow: pick a folder → `readProjectConfig(localPath)`. If a config is returned → build the project via `projectFromConfig` + `saveProject` + `onsaved`. If null (no `patchwire.yml`) → `onneedssetup(localPath)` (App routes to the wizard placeholder). The manual remote-path entry is removed (config supplies it; unconfigured folders go to the wizard).

- [ ] **Step 1: Rewrite `src/components/AddProjectDialog.test.ts`**
```ts
import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
const invokeMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));
import AddProjectDialog from "./AddProjectDialog.svelte";

beforeEach(() => { invokeMock.mockReset(); openMock.mockReset(); });

describe("AddProjectDialog", () => {
  it("adds a configured folder (has patchwire.yml) directly", async () => {
    openMock.mockResolvedValue("/home/r/api");
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_project_config") return Promise.resolve('{"type":"config","project":"api","host":"h","user":"u","remotePath":"/r","sshPort":22}');
      return Promise.resolve(undefined); // save_project
    });
    const onsaved = vi.fn();
    const { getByTestId } = render(AddProjectDialog, { props: { onsaved } });
    await fireEvent.click(getByTestId("pick-folder"));
    await Promise.resolve(); await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith("save_project", expect.objectContaining({
      project: expect.objectContaining({ localPath: "/home/r/api", host: "h", user: "u", remotePath: "/r" }),
    }));
    expect(onsaved).toHaveBeenCalled();
  });

  it("routes an unconfigured folder to setup", async () => {
    openMock.mockResolvedValue("/home/r/fresh");
    invokeMock.mockResolvedValue('{"type":"error","message":"no config"}'); // read_project_config → null
    const onneedssetup = vi.fn();
    const { getByTestId } = render(AddProjectDialog, { props: { onneedssetup } });
    await fireEvent.click(getByTestId("pick-folder"));
    await Promise.resolve(); await Promise.resolve();
    expect(onneedssetup).toHaveBeenCalledWith("/home/r/fresh");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter patchwire-desktop test src/components/AddProjectDialog.test.ts`
Expected: FAIL.

- [ ] **Step 3: Rewrite `src/components/AddProjectDialog.svelte`** (simpler — a single "Choose folder" action that branches):
```svelte
<script lang="ts">
  import { pickFolder, readProjectConfig, saveProject } from "../lib/ipc";
  import { projectFromConfig } from "../lib/model";

  let { onsaved, onneedssetup, oncancel }:
    { onsaved?: () => void; onneedssetup?: (localPath: string) => void; oncancel?: () => void } = $props();
  let busy = $state(false);

  async function choose() {
    const dir = await pickFolder();
    if (!dir) return;
    busy = true;
    try {
      const cfg = await readProjectConfig(dir);
      if (cfg) {
        await saveProject(projectFromConfig(dir, cfg));
        onsaved?.();
      } else {
        onneedssetup?.(dir);
      }
    } finally {
      busy = false;
    }
  }
</script>

<div class="dialog">
  <h3>Add a project</h3>
  <p class="sub">Pick a local folder. If it's already set up, it's added; otherwise we'll guide you through setup.</p>
  <div class="actions">
    <button class="ghost" onclick={() => oncancel?.()}>Cancel</button>
    <button class="primary" data-testid="pick-folder" disabled={busy} onclick={choose}>Choose folder…</button>
  </div>
</div>

<style>
  .dialog { max-width: 440px; margin: 24px auto; padding: 20px; background: var(--surface-panel);
    border: 1px solid var(--border); border-radius: var(--radius); display: flex; flex-direction: column; gap: 12px; }
  h3 { margin: 0; } .sub { color: var(--text-muted); font-size: 13px; }
  .actions { display: flex; justify-content: flex-end; gap: 10px; }
  .ghost { background: var(--surface-raised); color: var(--text); padding: 8px 14px; }
  .primary { background: var(--accent-strong); color: #fff; padding: 8px 14px; font-weight: 600; }
</style>
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter patchwire-desktop test src/components/AddProjectDialog.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/components/AddProjectDialog.svelte packages/desktop/src/components/AddProjectDialog.test.ts
git commit -m "feat(desktop): add-folder branches on patchwire.yml (add vs setup)"
```

---

### Task 8: Projects landing — drop global ConnectionBar/health (TDD)

**Files:**
- Modify: `src/screens/Projects.svelte`
- Modify: `src/screens/Projects.test.ts`

> Remove the `ConnectionBar` + global `checkHealth`. Keep the per-project `syncCommand("status")` onMount loop (drives each row's sync pill). The header keeps the "＋ New" + search + empty state.

- [ ] **Step 1: Update `src/screens/Projects.test.ts`**

Remove the connection-bar assertion (`conn-who`) and the global-health mock expectation. Keep: renders one row per project; empty state; the per-project status-populated test (it already mocks `sync_command`). Ensure the `beforeEach` no longer sets a `connection` store (it's gone) and project fixtures include `host`/`user`. The "renders the connection bar" test becomes "renders one row per project".

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter patchwire-desktop test src/screens/Projects.test.ts`
Expected: FAIL (imports of removed `connection` store / ConnectionBar).

- [ ] **Step 3: Rewrite `src/screens/Projects.svelte`**
```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { projects } from "../lib/stores";
  import { syncCommand } from "../lib/ipc";
  import { syncKindToProjectStatus } from "../lib/sync-events";
  import ProjectRow from "../components/ProjectRow.svelte";
  import type { Project } from "../lib/types";

  let { onopen, onadd }: { onopen?: (p: Project) => void; onadd?: () => void } = $props();
  let query = $state("");
  let filtered = $derived($projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())));

  onMount(async () => {
    for (const p of $projects) {
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
  <h2>Projects</h2>
  <button class="new" data-testid="new-project" onclick={() => onadd?.()}>＋ New</button>
  <input class="search" type="text" placeholder="Search…" bind:value={query} />
</div>

{#if filtered.length === 0}
  <div class="empty" data-testid="projects-empty">
    <p>No projects yet</p>
    <p class="sub">Add a folder to set up your first project.</p>
  </div>
{:else}
  <div class="list">
    {#each filtered as p (p.id)}
      <ProjectRow project={p} onopen={(proj) => onopen?.(proj)} />
    {/each}
  </div>
{/if}

<style>
  .bar { display: flex; align-items: center; gap: 12px; padding: 16px 20px 10px; }
  .bar h2 { font-size: 15px; margin: 0; flex: none; }
  .new { background: var(--accent-strong); color: #fff; font-size: 12px; padding: 7px 13px; font-weight: 600; }
  .search { flex: 1; }
  .empty { text-align: center; color: var(--text-muted); padding: 48px 20px; }
  .empty .sub { font-size: 13px; }
</style>
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter patchwire-desktop test src/screens/Projects.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/screens/Projects.svelte packages/desktop/src/screens/Projects.test.ts
git commit -m "refactor(desktop): per-project landing; drop global ConnectionBar + health"
```

---

### Task 9: App routing — no connect route; wire setup placeholder; delete dead files (TDD)

**Files:**
- Rewrite: `src/App.svelte`
- Modify: `src/App.test.ts`
- Create: `src/screens/SetupWizardPlaceholder.svelte`
- Delete: `src/screens/Connect.svelte`, `src/screens/Connect.test.ts`, `src/components/ConnectionBar.svelte`, `src/components/ConnectionBar.test.ts`

- [ ] **Step 1: Create `src/screens/SetupWizardPlaceholder.svelte`** (P4b replaces this):
```svelte
<script lang="ts">
  let { localPath, onback }: { localPath: string; onback?: () => void } = $props();
</script>
<div class="ph" data-testid="setup-placeholder">
  <h2>Set up a project</h2>
  <p class="sub mono">{localPath}</p>
  <p>The guided setup wizard lands in P4b.</p>
  <button class="ghost" onclick={() => onback?.()}>Back</button>
</div>
<style>
  .ph { max-width: 440px; margin: 48px auto; text-align: center; display: flex; flex-direction: column; gap: 10px; }
  .sub { color: var(--text-muted); font-size: 12px; }
  .ghost { background: var(--surface-raised); color: var(--text); padding: 8px 14px; align-self: center; }
</style>
```

- [ ] **Step 2: Update `src/App.test.ts`**

Replace the connection-based routing tests. New tests:
```ts
import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
import App from "./App.svelte";
import { projects } from "./lib/stores";

beforeEach(() => {
  invokeMock.mockReset(); listenMock.mockReset();
  listenMock.mockResolvedValue(() => {});
  projects.set([]);
});

describe("App routing (per-project)", () => {
  it("shows the Projects list by default (empty state)", async () => {
    invokeMock.mockImplementation((cmd: string) => cmd === "list_projects" ? Promise.resolve([]) : Promise.resolve(undefined));
    const { findByTestId } = render(App);
    expect(await findByTestId("projects-empty")).toBeTruthy();
  });

  it("opens the Workspace when a project row is clicked", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "list_projects") return Promise.resolve([{ id: "a", name: "api", branch: "main", localPath: "/l/a", remotePath: "/r/a", host: "h", user: "u", lastStatus: "in-sync", syncPaused: false }]);
      return Promise.resolve(undefined);
    });
    const { findByTestId } = render(App);
    await fireEvent.click(await findByTestId("row"));
    expect((await findByTestId("ws-title")).textContent).toContain("api");
  });
});
```

- [ ] **Step 3: Run, verify fail**

Run: `pnpm --filter patchwire-desktop test src/App.test.ts`
Expected: FAIL (App still imports Connect / global connection).

- [ ] **Step 4: Rewrite `src/App.svelte`**
```svelte
<script lang="ts">
  import "./styles/tokens.css";
  import { onMount } from "svelte";
  import { projects, loadProjects } from "./lib/stores";
  import Projects from "./screens/Projects.svelte";
  import Workspace from "./screens/Workspace.svelte";
  import AddProjectDialog from "./components/AddProjectDialog.svelte";
  import SetupWizardPlaceholder from "./screens/SetupWizardPlaceholder.svelte";
  import type { Project } from "./lib/types";

  let adding = $state(false);
  let opened = $state<Project | null>(null);
  let setupPath = $state<string | null>(null);

  onMount(async () => { await loadProjects(); });

  async function onsaved() { adding = false; await loadProjects(); }
  function onneedssetup(localPath: string) { adding = false; setupPath = localPath; }
</script>

<div data-testid="app-root" class="app">
  {#if opened}
    <Workspace project={opened} onback={() => (opened = null)} />
  {:else if setupPath}
    <SetupWizardPlaceholder localPath={setupPath} onback={() => (setupPath = null)} />
  {:else if adding}
    <AddProjectDialog {onsaved} {onneedssetup} oncancel={() => (adding = false)} />
  {:else}
    <Projects onopen={(p) => (opened = p)} onadd={() => (adding = true)} />
  {/if}
</div>

<style>.app { height: 100%; }</style>
```

- [ ] **Step 5: Delete the dead files**

```bash
git rm packages/desktop/src/screens/Connect.svelte packages/desktop/src/screens/Connect.test.ts \
       packages/desktop/src/components/ConnectionBar.svelte packages/desktop/src/components/ConnectionBar.test.ts
```

- [ ] **Step 6: Run the FULL suite**

Run: `pnpm --filter patchwire-desktop test`
Expected: ALL green (no references to deleted Connect/ConnectionBar/connection store remain). If any straggler test imports a removed symbol, fix it (it's part of this task's cleanup).

- [ ] **Step 7: Verify Rust still compiles + app boots**

Run: `export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && pnpm stage-sidecar && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles. (Optionally `pnpm tauri dev` to eyeball the per-project landing + empty state.)

- [ ] **Step 8: Commit**

```bash
git add packages/desktop/src/App.svelte packages/desktop/src/App.test.ts packages/desktop/src/screens/SetupWizardPlaceholder.svelte
git commit -m "refactor(desktop): per-project App routing; setup placeholder; remove Connect/ConnectionBar"
```

---

## Self-Review

**Spec coverage (P4a portions):**
- Remove global connection (connection.json, Connect screen, ConnectionBar, connection store, route, read/save_connection) → Tasks 2, 4, 5, 8, 9. ✓
- Projects self-describing (per-project host/user from patchwire.yml) → Tasks 1, 2, 3, 4 (`config-show` → `read_project_config` → `readProjectConfig` → `projectFromConfig`). ✓
- Per-project row shows own user@host → Task 6. ✓
- Add-folder branches (has-yml add vs no-yml → wizard) → Task 7. ✓
- App routes Projects/Workspace/Wizard-placeholder, no connect route → Task 9. ✓
- Workspace + sync (P2/P3) untouched. ✓
- Out of scope: the real wizard (P4b replaces `SetupWizardPlaceholder`); per-project health dot (sync pill suffices).

**Placeholder scan:** `SetupWizardPlaceholder.svelte` is an intentional, documented P4b stub (a real shippable screen, not a TODO). Tasks 1 and 3 instruct reading `config.ts`/the real `loadConfig` shape; the JSON contract + tests are fully specified. No TBDs.

**Type consistency:** `ProjectConfig` defined once in types.ts (Task 3), consumed by `readProjectConfig` (Task 4) + `projectFromConfig` (Task 3). `Project` gains `host`/`user` (Task 3) and is read by ProjectRow (Task 6), Projects, App. IPC command `read_project_config` matches Rust (Task 2) + ipc (Task 4) + tests. The `config-show --json` output shape (`{type:"config",project,host,user,remotePath,sshPort}`) matches across CLI (Task 1), the Rust passthrough (Task 2), and `readProjectConfig`/`projectFromConfig` (Tasks 3, 4). Deletions (`Connection`/`checkHealth`/`route`/`connection`) are removed everywhere they were referenced (Connect deleted, Projects/stores/ipc/model updated) — Task 9 Step 6 full-suite run is the backstop for stragglers.

## Follow-on
- **P4b:** replace `SetupWizardPlaceholder` with the real 4-step `SetupWizard` (machine → key/Open-Terminal → project source → verify+provision via `start_provision` with `current_dir` + `--project/--path`). Write the project to `projects.json` on finish.
- The Rust `host_health`/`host_*` commands remain (ops-era, unused by the dev client now) — leave; a later cleanup can remove them if confirmed dead.
