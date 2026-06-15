# Desktop Developer Client — Phase 1 (Foundations + Projects Landing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Svelte foundation for the Patchwire desktop developer client and ship a working Connect → Projects-landing flow over a single remote connection.

**Architecture:** The desktop app is a UI shell over the existing `patchwire` CLI sidecar. A Svelte 5 frontend renders screens and holds reactive state; thin Tauri/Rust commands persist local state (`connection.json`, `projects.json` under the app data dir) and run the sidecar for health checks. P1 covers the already-provisioned case (manual connect form); the full setup wizard is deferred to P4.

**Tech Stack:** Tauri 2, Svelte 5 (runes), Vite 6, Vitest 2 + jsdom + @testing-library/svelte, Rust (serde_json), tauri-plugin-shell, tauri-plugin-dialog.

**Spec:** `docs/superpowers/specs/2026-06-15-desktop-developer-client-design.md`

**Working dir for all commands:** `packages/desktop` unless noted. Tests run with `pnpm --filter patchwire-desktop test`.

---

## File Structure

Created in P1:
- `src/main.ts` — (rewritten) mounts the Svelte `App` component.
- `src/App.svelte` — root: reads connection on mount, routes Connect ↔ Projects.
- `src/styles/tokens.css` — dark-indigo design tokens + base element styles.
- `src/lib/types.ts` — `Connection`, `Project`, `ProjectStatus`, `HealthResult`, `HostArgs`.
- `src/lib/model.ts` — pure helpers: validation, mappers, parsers, builders (TDD'd).
- `src/lib/model.test.ts` — unit tests for `model.ts`.
- `src/lib/ipc.ts` — typed `invoke()` wrappers for the new Rust commands.
- `src/lib/stores.ts` — Svelte stores: `connection`, `projects`, `route`.
- `src/components/ConnectionBar.svelte` — pinned remote/health bar.
- `src/components/ConnectionBar.test.ts`
- `src/components/ProjectRow.svelte` — one project row.
- `src/components/ProjectRow.test.ts`
- `src/components/AddProjectDialog.svelte` — pick folder → map remote → save.
- `src/screens/Connect.svelte` — manual connect form.
- `src/screens/Connect.test.ts`
- `src/screens/Projects.svelte` — landing: ConnectionBar + rows + new-project.
- `src/screens/Projects.test.ts`
- `svelte.config.js`, `vitest.config.ts` — tooling.

Modified in P1:
- `package.json` — add Svelte/test deps + dialog plugin.
- `vite.config.ts` — add the svelte plugin.
- `index.html` — drop the stylesheet `<link>` (CSS imported via JS now).
- `src-tauri/Cargo.toml` — add `tauri-plugin-dialog`.
- `src-tauri/src/lib.rs` — add `read_connection`, `save_connection`, `list_projects`, `save_project`; register dialog plugin; extend the invoke handler.

Retained untouched: existing pure util modules (`host-health.ts`, `host-logs.ts`, `host-record.ts`, `inventory.ts`, `provision-state.ts`, `h.ts`) and their tests, and all existing Rust commands (`start_provision`, `send_consent`, `host_health`, `host_logs`, `host_uninstall`, `save_host`, `list_hosts`, `delete_host`) — `start_provision`/`host_health` are reused in later phases.

---

### Task 1: Add Svelte tooling and mount an empty Svelte app

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`
- Modify: `index.html`
- Create: `svelte.config.js`
- Create: `vitest.config.ts`
- Create: `src/App.svelte`
- Modify (rewrite): `src/main.ts`
- Create: `src/App.test.ts`

- [ ] **Step 1: Install dependencies**

Run (from `packages/desktop`):
```bash
pnpm add -D svelte@^5 @sveltejs/vite-plugin-svelte@^5 @tsconfig/svelte@^5 @testing-library/svelte@^5 jsdom@^25
pnpm add @tauri-apps/plugin-dialog@^2
```
Expected: `package.json` gains these under `devDependencies` (svelte tooling, jsdom, testing-library) and `dependencies` (`@tauri-apps/plugin-dialog`).

- [ ] **Step 2: Create `svelte.config.js`**

```js
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
};
```

- [ ] **Step 3: Add the svelte plugin to `vite.config.ts`**

Replace the file with:
```ts
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [svelte()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";

export default defineConfig({
  plugins: [svelte({ hot: false })],
  test: {
    environment: "jsdom",
    globals: true,
  },
  resolve: {
    conditions: ["browser"],
  },
});
```

- [ ] **Step 5: Create the placeholder `src/App.svelte`**

```svelte
<script lang="ts">
  import "./styles/tokens.css";
</script>

<main data-testid="app-root">
  <p>Patchwire</p>
</main>
```
(Note: `tokens.css` is created in Task 2; create an empty file now so the import resolves: `mkdir -p src/styles && touch src/styles/tokens.css`.)

- [ ] **Step 6: Rewrite `src/main.ts` to mount the Svelte app**

```ts
import { mount } from "svelte";
import App from "./App.svelte";

const app = mount(App, {
  target: document.getElementById("app")!,
});

export default app;
```

- [ ] **Step 7: Update `index.html` (drop the stylesheet link)**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Patchwire</title>
    <script type="module" src="/src/main.ts"></script>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
```

- [ ] **Step 8: Write the smoke test `src/App.test.ts`**

```ts
import { render } from "@testing-library/svelte";
import { describe, it, expect } from "vitest";
import App from "./App.svelte";

describe("App", () => {
  it("renders the app root", () => {
    const { getByTestId } = render(App);
    expect(getByTestId("app-root").textContent).toContain("Patchwire");
  });
});
```

- [ ] **Step 9: Run tests, verify pass**

Run: `pnpm --filter patchwire-desktop test`
Expected: all tests PASS, including `App.test.ts` and the pre-existing util tests.

- [ ] **Step 10: Commit**

```bash
git add packages/desktop
git commit -m "feat(desktop): add Svelte 5 tooling and mount empty app shell"
```

---

### Task 2: Dark-indigo design tokens

**Files:**
- Modify: `src/styles/tokens.css`

- [ ] **Step 1: Write `src/styles/tokens.css`**

```css
:root {
  --surface-base: #0b0b12;
  --surface-panel: #11111c;
  --surface-raised: #16161f;
  --border: #1c1c28;
  --border-strong: #2a2a3c;

  --text: #e8e8f0;
  --text-muted: #6c6c82;

  --accent: #a5a3ff;
  --accent-strong: #646cff;
  --accent-bg: #1d1d33;

  --ok: #7dd3a8;
  --warn: #fbbf24;
  --error: #f87171;

  --radius: 10px;
  --radius-sm: 8px;
  --font: "Inter", system-ui, -apple-system, sans-serif;
  --mono: ui-monospace, "SF Mono", Menlo, monospace;
}

* { box-sizing: border-box; }

html, body {
  margin: 0;
  height: 100%;
  background: var(--surface-base);
  color: var(--text);
  font-family: var(--font);
  font-size: 14px;
}

#app { height: 100%; }

button {
  font-family: inherit;
  cursor: pointer;
  border: none;
  border-radius: var(--radius-sm);
}

input {
  font-family: inherit;
  background: var(--surface-base);
  border: 1px solid var(--border-strong);
  color: var(--text);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
}

.mono { font-family: var(--mono); }
```

- [ ] **Step 2: Run tests, verify still pass**

Run: `pnpm --filter patchwire-desktop test`
Expected: PASS (App smoke test still green; tokens import resolves to real content now).

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/styles/tokens.css
git commit -m "feat(desktop): add dark-indigo design tokens"
```

---

### Task 3: Domain types and pure model helpers (TDD)

**Files:**
- Create: `src/lib/types.ts`
- Create: `src/lib/model.ts`
- Test: `src/lib/model.test.ts`

- [ ] **Step 1: Write the failing test `src/lib/model.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import {
  isConnectionComplete,
  connectionToHostArgs,
  parseHealth,
  parseProjects,
  buildProject,
  projectStatusLabel,
} from "./model";
import type { Connection } from "./types";

const conn: Connection = {
  host: "studio-mini",
  user: "rebin",
  sshPort: 22,
  keyPath: "/home/rebin/.ssh/id_ed25519",
  agentPort: 7878,
};

describe("isConnectionComplete", () => {
  it("is true when all required fields are present and ports positive", () => {
    expect(isConnectionComplete(conn)).toBe(true);
  });
  it("is false when host is empty", () => {
    expect(isConnectionComplete({ ...conn, host: "" })).toBe(false);
  });
  it("is false when agentPort is 0", () => {
    expect(isConnectionComplete({ ...conn, agentPort: 0 })).toBe(false);
  });
});

describe("connectionToHostArgs", () => {
  it("maps connection fields to the sidecar HostArgs shape", () => {
    expect(connectionToHostArgs(conn)).toEqual({
      host: "studio-mini",
      user: "rebin",
      sshPort: 22,
      keyPath: "/home/rebin/.ssh/id_ed25519",
      agentPort: 7878,
    });
  });
});

describe("parseHealth", () => {
  it("parses a healthy JSON string", () => {
    const r = parseHealth('{"ok":true,"version":"0.4.0","user":"rebin"}');
    expect(r).toEqual({ ok: true, version: "0.4.0", user: "rebin" });
  });
  it("returns ok:false on malformed input", () => {
    expect(parseHealth("not json")).toEqual({ ok: false });
  });
});

describe("parseProjects", () => {
  it("returns [] for non-array input", () => {
    expect(parseProjects(null)).toEqual([]);
    expect(parseProjects({})).toEqual([]);
  });
  it("coerces records and drops ones missing id/localPath/remotePath", () => {
    const raw = [
      { id: "a", name: "api", branch: "main", localPath: "/l/a", remotePath: "/r/a" },
      { id: "b", localPath: "/l/b", remotePath: "/r/b" },
      { name: "broken" },
    ];
    const out = parseProjects(raw);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      id: "a", name: "api", branch: "main",
      localPath: "/l/a", remotePath: "/r/a",
      lastStatus: "unknown", syncPaused: false,
    });
    expect(out[1].name).toBe("b");      // falls back to id when name missing
    expect(out[1].branch).toBe("main"); // default branch
  });
});

describe("buildProject", () => {
  it("builds a project with defaults and a non-empty id", () => {
    const p = buildProject("/home/rebin/code/api", "/remote/api", "api");
    expect(p.localPath).toBe("/home/rebin/code/api");
    expect(p.remotePath).toBe("/remote/api");
    expect(p.name).toBe("api");
    expect(p.branch).toBe("main");
    expect(p.lastStatus).toBe("unknown");
    expect(p.syncPaused).toBe(false);
    expect(p.id.length).toBeGreaterThan(0);
  });
  it("derives the name from the local folder basename when name omitted", () => {
    const p = buildProject("/home/rebin/code/web-app", "/remote/web-app");
    expect(p.name).toBe("web-app");
  });
});

describe("projectStatusLabel", () => {
  it("maps status to display text and kind", () => {
    expect(projectStatusLabel("in-sync")).toEqual({ text: "In sync", kind: "ok" });
    expect(projectStatusLabel("working")).toEqual({ text: "Claude working…", kind: "warn" });
    expect(projectStatusLabel("paused")).toEqual({ text: "Sync paused", kind: "muted" });
    expect(projectStatusLabel("error")).toEqual({ text: "Error", kind: "error" });
    expect(projectStatusLabel("unknown")).toEqual({ text: "—", kind: "muted" });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter patchwire-desktop test src/lib/model.test.ts`
Expected: FAIL — `./model` and `./types` not found.

- [ ] **Step 3: Write `src/lib/types.ts`**

```ts
export interface Connection {
  host: string;
  user: string;
  sshPort: number;
  keyPath: string;
  agentPort: number;
  tailnetAddr?: string;
  agentVersion?: string;
}

export interface HostArgs {
  host: string;
  user: string;
  sshPort: number;
  keyPath: string;
  agentPort: number;
}

export interface HealthResult {
  ok: boolean;
  version?: string;
  user?: string;
}

export type ProjectStatus =
  | "in-sync"
  | "working"
  | "paused"
  | "error"
  | "unknown";

export interface Project {
  id: string;
  name: string;
  branch: string;
  localPath: string;
  remotePath: string;
  lastStatus: ProjectStatus;
  syncPaused: boolean;
}
```

- [ ] **Step 4: Write `src/lib/model.ts`**

```ts
import type {
  Connection,
  HostArgs,
  HealthResult,
  Project,
  ProjectStatus,
} from "./types";

export function isConnectionComplete(c: Connection): boolean {
  return (
    c.host.trim() !== "" &&
    c.user.trim() !== "" &&
    c.keyPath.trim() !== "" &&
    c.sshPort > 0 &&
    c.agentPort > 0
  );
}

export function connectionToHostArgs(c: Connection): HostArgs {
  return {
    host: c.host,
    user: c.user,
    sshPort: c.sshPort,
    keyPath: c.keyPath,
    agentPort: c.agentPort,
  };
}

export function parseHealth(json: string): HealthResult {
  try {
    const o = JSON.parse(json);
    return {
      ok: o.ok === true,
      version: typeof o.version === "string" ? o.version : undefined,
      user: typeof o.user === "string" ? o.user : undefined,
    };
  } catch {
    return { ok: false };
  }
}

function basename(p: string): string {
  const parts = p.replace(/\/+$/, "").split("/");
  return parts[parts.length - 1] || p;
}

export function parseProjects(raw: unknown): Project[] {
  if (!Array.isArray(raw)) return [];
  const out: Project[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id : "";
    const localPath = typeof o.localPath === "string" ? o.localPath : "";
    const remotePath = typeof o.remotePath === "string" ? o.remotePath : "";
    if (!id || !localPath || !remotePath) continue;
    out.push({
      id,
      name: typeof o.name === "string" && o.name ? o.name : id,
      branch: typeof o.branch === "string" && o.branch ? o.branch : "main",
      localPath,
      remotePath,
      lastStatus: isStatus(o.lastStatus) ? o.lastStatus : "unknown",
      syncPaused: o.syncPaused === true,
    });
  }
  return out;
}

function isStatus(v: unknown): v is ProjectStatus {
  return (
    v === "in-sync" ||
    v === "working" ||
    v === "paused" ||
    v === "error" ||
    v === "unknown"
  );
}

export function buildProject(
  localPath: string,
  remotePath: string,
  name?: string,
): Project {
  return {
    id: crypto.randomUUID(),
    name: name && name.trim() ? name.trim() : basename(localPath),
    branch: "main",
    localPath,
    remotePath,
    lastStatus: "unknown",
    syncPaused: false,
  };
}

export function projectStatusLabel(
  status: ProjectStatus,
): { text: string; kind: "ok" | "warn" | "error" | "muted" } {
  switch (status) {
    case "in-sync":
      return { text: "In sync", kind: "ok" };
    case "working":
      return { text: "Claude working…", kind: "warn" };
    case "paused":
      return { text: "Sync paused", kind: "muted" };
    case "error":
      return { text: "Error", kind: "error" };
    default:
      return { text: "—", kind: "muted" };
  }
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `pnpm --filter patchwire-desktop test src/lib/model.test.ts`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/lib/types.ts packages/desktop/src/lib/model.ts packages/desktop/src/lib/model.test.ts
git commit -m "feat(desktop): connection/project domain types and pure model helpers"
```

---

### Task 4: Rust persistence commands for connection + projects

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`

> Follows the existing `hosts.json` pattern (plain JSON files under the app data dir, serde_json::Value passthrough). Consistent with the repo, the Rust layer has no unit tests; verification is by running the app in Task 12. Keep these functions thin.

- [ ] **Step 1: Add the dialog plugin dependency to `src-tauri/Cargo.toml`**

Under `[dependencies]`, add:
```toml
tauri-plugin-dialog = "2"
```

- [ ] **Step 2: Add persistence commands in `src-tauri/src/lib.rs`**

Add these functions near the existing `save_host`/`list_hosts` commands:
```rust
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

fn data_file(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(name))
}

#[tauri::command]
fn read_connection(app: tauri::AppHandle) -> Result<Option<serde_json::Value>, String> {
    let path = data_file(&app, "connection.json")?;
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok(Some(value))
}

#[tauri::command]
fn save_connection(app: tauri::AppHandle, connection: serde_json::Value) -> Result<(), String> {
    let path = data_file(&app, "connection.json")?;
    let text = serde_json::to_string_pretty(&connection).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_projects(app: tauri::AppHandle) -> Result<Vec<serde_json::Value>, String> {
    let path = data_file(&app, "projects.json")?;
    if !path.exists() {
        return Ok(vec![]);
    }
    let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let value: Vec<serde_json::Value> = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok(value)
}

#[tauri::command]
fn save_project(app: tauri::AppHandle, project: serde_json::Value) -> Result<(), String> {
    let path = data_file(&app, "projects.json")?;
    let mut list: Vec<serde_json::Value> = if path.exists() {
        let text = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&text).map_err(|e| e.to_string())?
    } else {
        vec![]
    };
    let new_id = project.get("id").and_then(|v| v.as_str()).unwrap_or("");
    if new_id.is_empty() {
        return Err("project.id is required".into());
    }
    list.retain(|p| p.get("id").and_then(|v| v.as_str()) != Some(new_id));
    list.push(project);
    let text = serde_json::to_string_pretty(&list).map_err(|e| e.to_string())?;
    fs::write(&path, text).map_err(|e| e.to_string())
}
```
(If `use tauri::Manager;`, `use std::fs;`, or `use std::path::PathBuf;` already exist at the top of the file, do not duplicate them — keep a single import each.)

- [ ] **Step 3: Register the dialog plugin and the new commands**

In the Tauri builder chain (the function that calls `tauri::Builder::default()`), add the dialog plugin alongside the existing `.plugin(tauri_plugin_shell::init())`:
```rust
.plugin(tauri_plugin_dialog::init())
```
And extend the existing `tauri::generate_handler![ ... ]` macro to include the four new commands. The full handler list should be:
```rust
.invoke_handler(tauri::generate_handler![
    start_provision,
    send_consent,
    save_host,
    list_hosts,
    delete_host,
    host_health,
    host_uninstall,
    host_logs,
    read_connection,
    save_connection,
    list_projects,
    save_project
])
```

- [ ] **Step 4: Verify it compiles**

Run (from `packages/desktop`): `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles with no errors (warnings about unused `start_provision` etc. are acceptable).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/Cargo.toml packages/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): rust persistence for connection.json and projects.json"
```

---

### Task 5: Typed IPC wrappers for the new commands

**Files:**
- Create: `src/lib/ipc.ts`
- Test: `src/lib/ipc.test.ts`

- [ ] **Step 1: Write the failing test `src/lib/ipc.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import {
  readConnection,
  saveConnection,
  listProjects,
  saveProject,
  checkHealth,
} from "./ipc";
import type { Connection } from "./types";

const conn: Connection = {
  host: "studio-mini",
  user: "rebin",
  sshPort: 22,
  keyPath: "/k",
  agentPort: 7878,
};

beforeEach(() => invokeMock.mockReset());

describe("readConnection", () => {
  it("returns null when no connection persisted", async () => {
    invokeMock.mockResolvedValue(null);
    expect(await readConnection()).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith("read_connection");
  });
  it("returns the connection object when present", async () => {
    invokeMock.mockResolvedValue(conn);
    expect(await readConnection()).toEqual(conn);
  });
});

describe("saveConnection", () => {
  it("invokes save_connection with the connection payload", async () => {
    invokeMock.mockResolvedValue(undefined);
    await saveConnection(conn);
    expect(invokeMock).toHaveBeenCalledWith("save_connection", { connection: conn });
  });
});

describe("listProjects", () => {
  it("parses raw records into Project[]", async () => {
    invokeMock.mockResolvedValue([
      { id: "a", name: "api", localPath: "/l", remotePath: "/r" },
    ]);
    const out = await listProjects();
    expect(out).toHaveLength(1);
    expect(out[0].branch).toBe("main");
  });
});

describe("saveProject", () => {
  it("invokes save_project with the project payload", async () => {
    invokeMock.mockResolvedValue(undefined);
    const p = { id: "x", name: "n", branch: "main", localPath: "/l", remotePath: "/r", lastStatus: "unknown", syncPaused: false } as const;
    await saveProject(p);
    expect(invokeMock).toHaveBeenCalledWith("save_project", { project: p });
  });
});

describe("checkHealth", () => {
  it("invokes host_health with mapped args and parses the JSON string result", async () => {
    invokeMock.mockResolvedValue('{"ok":true,"version":"0.4.0"}');
    const r = await checkHealth(conn);
    expect(invokeMock).toHaveBeenCalledWith("host_health", {
      args: { host: "studio-mini", user: "rebin", sshPort: 22, keyPath: "/k", agentPort: 7878 },
    });
    expect(r).toEqual({ ok: true, version: "0.4.0", user: undefined });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter patchwire-desktop test src/lib/ipc.test.ts`
Expected: FAIL — `./ipc` not found.

- [ ] **Step 3: Write `src/lib/ipc.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import type { Connection, HealthResult, Project } from "./types";
import { connectionToHostArgs, parseHealth, parseProjects } from "./model";

export async function readConnection(): Promise<Connection | null> {
  const raw = await invoke<Connection | null>("read_connection");
  return raw ?? null;
}

export async function saveConnection(connection: Connection): Promise<void> {
  await invoke("save_connection", { connection });
}

export async function listProjects(): Promise<Project[]> {
  const raw = await invoke<unknown>("list_projects");
  return parseProjects(raw);
}

export async function saveProject(project: Project): Promise<void> {
  await invoke("save_project", { project });
}

export async function checkHealth(connection: Connection): Promise<HealthResult> {
  const json = await invoke<string>("host_health", {
    args: connectionToHostArgs(connection),
  });
  return parseHealth(json);
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter patchwire-desktop test src/lib/ipc.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/lib/ipc.ts packages/desktop/src/lib/ipc.test.ts
git commit -m "feat(desktop): typed IPC wrappers for connection/projects/health"
```

---

### Task 6: Svelte stores (connection, projects, route)

**Files:**
- Create: `src/lib/stores.ts`
- Test: `src/lib/stores.test.ts`

- [ ] **Step 1: Write the failing test `src/lib/stores.test.ts`**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { get } from "svelte/store";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import { connection, projects, route, loadConnection, loadProjects } from "./stores";

beforeEach(() => {
  invokeMock.mockReset();
  connection.set(null);
  projects.set([]);
});

describe("route", () => {
  it("is 'connect' when no connection", () => {
    connection.set(null);
    expect(get(route)).toBe("connect");
  });
  it("is 'projects' when a connection exists", () => {
    connection.set({ host: "h", user: "u", sshPort: 22, keyPath: "/k", agentPort: 7878 });
    expect(get(route)).toBe("projects");
  });
});

describe("loadConnection", () => {
  it("populates the connection store from IPC", async () => {
    invokeMock.mockResolvedValue({ host: "h", user: "u", sshPort: 22, keyPath: "/k", agentPort: 7878 });
    await loadConnection();
    expect(get(connection)?.host).toBe("h");
  });
});

describe("loadProjects", () => {
  it("populates the projects store from IPC", async () => {
    invokeMock.mockResolvedValue([{ id: "a", name: "api", localPath: "/l", remotePath: "/r" }]);
    await loadProjects();
    expect(get(projects)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter patchwire-desktop test src/lib/stores.test.ts`
Expected: FAIL — `./stores` not found.

- [ ] **Step 3: Write `src/lib/stores.ts`**

```ts
import { writable, derived } from "svelte/store";
import type { Connection, Project } from "./types";
import { readConnection, listProjects } from "./ipc";

export const connection = writable<Connection | null>(null);
export const projects = writable<Project[]>([]);

export type Route = "connect" | "projects";

export const route = derived(connection, ($c): Route =>
  $c ? "projects" : "connect",
);

export async function loadConnection(): Promise<void> {
  connection.set(await readConnection());
}

export async function loadProjects(): Promise<void> {
  projects.set(await listProjects());
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter patchwire-desktop test src/lib/stores.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/lib/stores.ts packages/desktop/src/lib/stores.test.ts
git commit -m "feat(desktop): connection/projects/route svelte stores"
```

---

### Task 7: ConnectionBar component

**Files:**
- Create: `src/components/ConnectionBar.svelte`
- Test: `src/components/ConnectionBar.test.ts`

- [ ] **Step 1: Write the failing test `src/components/ConnectionBar.test.ts`**

```ts
import { render } from "@testing-library/svelte";
import { describe, it, expect } from "vitest";
import ConnectionBar from "./ConnectionBar.svelte";
import type { Connection } from "../lib/types";

const conn: Connection = {
  host: "studio-mini",
  user: "rebin",
  sshPort: 22,
  keyPath: "/k",
  agentPort: 7878,
  tailnetAddr: "100.92.14.3",
  agentVersion: "0.4.0",
};

describe("ConnectionBar", () => {
  it("shows user@host, tailnet, and version", () => {
    const { getByTestId } = render(ConnectionBar, { props: { connection: conn, healthy: true } });
    expect(getByTestId("conn-who").textContent).toBe("rebin@studio-mini");
    expect(getByTestId("conn-sub").textContent).toContain("100.92.14.3");
    expect(getByTestId("conn-sub").textContent).toContain("0.4.0");
  });
  it("reflects health state in the status text", () => {
    const { getByTestId } = render(ConnectionBar, { props: { connection: conn, healthy: false } });
    expect(getByTestId("conn-status").textContent).toContain("Unreachable");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter patchwire-desktop test src/components/ConnectionBar.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write `src/components/ConnectionBar.svelte`**

```svelte
<script lang="ts">
  import type { Connection } from "../lib/types";
  let { connection, healthy }: { connection: Connection; healthy: boolean } = $props();
</script>

<div class="bar">
  <div class="mac">🖥</div>
  <div class="meta">
    <div class="who" data-testid="conn-who">{connection.user}@{connection.host}</div>
    <div class="sub" data-testid="conn-sub">
      {connection.tailnetAddr ?? "tailnet"} · agent v{connection.agentVersion ?? "?"}
    </div>
  </div>
  <div class="status {healthy ? 'ok' : 'bad'}" data-testid="conn-status">
    <span class="dot"></span>{healthy ? "Connected" : "Unreachable"}
  </div>
</div>

<style>
  .bar { display: flex; align-items: center; gap: 12px; padding: 14px 20px;
    background: var(--surface-panel); border-bottom: 1px solid var(--border); }
  .mac { width: 34px; height: 34px; border-radius: 9px; background: var(--accent-bg);
    display: flex; align-items: center; justify-content: center; }
  .who { font-weight: 600; }
  .sub { color: var(--text-muted); font-size: 12px; margin-top: 2px; }
  .status { margin-left: auto; font-size: 12px; display: flex; align-items: center; gap: 6px; }
  .status.ok { color: var(--ok); }
  .status.bad { color: var(--error); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .status.ok .dot { box-shadow: 0 0 8px var(--ok); }
</style>
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter patchwire-desktop test src/components/ConnectionBar.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/components/ConnectionBar.svelte packages/desktop/src/components/ConnectionBar.test.ts
git commit -m "feat(desktop): ConnectionBar component"
```

---

### Task 8: ProjectRow component

**Files:**
- Create: `src/components/ProjectRow.svelte`
- Test: `src/components/ProjectRow.test.ts`

- [ ] **Step 1: Write the failing test `src/components/ProjectRow.test.ts`**

```ts
import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi } from "vitest";
import ProjectRow from "./ProjectRow.svelte";
import type { Project } from "../lib/types";

const project: Project = {
  id: "a",
  name: "api-server",
  branch: "main",
  localPath: "/home/rebin/code/api-server",
  remotePath: "/remote/api-server",
  lastStatus: "in-sync",
  syncPaused: false,
};

describe("ProjectRow", () => {
  it("shows name, branch, path mapping, and status", () => {
    const { getByTestId } = render(ProjectRow, { props: { project } });
    expect(getByTestId("row-name").textContent).toContain("api-server");
    expect(getByTestId("row-branch").textContent).toBe("main");
    expect(getByTestId("row-path").textContent).toContain("/home/rebin/code/api-server");
    expect(getByTestId("row-path").textContent).toContain("/remote/api-server");
    expect(getByTestId("row-status").textContent).toContain("In sync");
  });
  it("fires onopen with the project when clicked", async () => {
    const onopen = vi.fn();
    const { getByTestId } = render(ProjectRow, { props: { project, onopen } });
    await fireEvent.click(getByTestId("row"));
    expect(onopen).toHaveBeenCalledWith(project);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter patchwire-desktop test src/components/ProjectRow.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write `src/components/ProjectRow.svelte`**

```svelte
<script lang="ts">
  import type { Project } from "../lib/types";
  import { projectStatusLabel } from "../lib/model";

  let { project, onopen }: { project: Project; onopen?: (p: Project) => void } = $props();
  let label = $derived(projectStatusLabel(project.lastStatus));
  let initials = $derived(
    project.name.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase() || "··",
  );
</script>

<div class="row" data-testid="row" role="button" tabindex="0"
  onclick={() => onopen?.(project)}
  onkeydown={(e) => e.key === "Enter" && onopen?.(project)}>
  <div class="ic">{initials}</div>
  <div class="body">
    <div class="title">
      <span class="name" data-testid="row-name">{project.name}</span>
      <span class="branch" data-testid="row-branch">{project.branch}</span>
    </div>
    <div class="path mono" data-testid="row-path">{project.localPath} ⇄ {project.remotePath}</div>
  </div>
  <span class="pill {label.kind}" data-testid="row-status">{label.text}</span>
</div>

<style>
  .row { display: flex; align-items: center; gap: 14px; padding: 14px 20px;
    border-top: 1px solid var(--border); cursor: pointer; }
  .row:hover { background: var(--surface-raised); }
  .ic { width: 38px; height: 38px; border-radius: 10px; background: var(--accent-bg);
    color: var(--accent); display: flex; align-items: center; justify-content: center;
    font-weight: 700; font-size: 13px; }
  .title { display: flex; align-items: baseline; gap: 8px; }
  .name { font-weight: 600; }
  .branch { color: var(--text-muted); font-size: 12px; }
  .path { color: var(--text-muted); font-size: 12px; margin-top: 2px; }
  .pill { margin-left: auto; font-size: 11px; padding: 3px 9px; border-radius: 20px;
    font-weight: 600; background: var(--surface-raised); }
  .pill.ok { background: var(--accent-bg); color: var(--ok); }
  .pill.warn { color: var(--warn); }
  .pill.error { color: var(--error); }
  .pill.muted { color: var(--text-muted); }
</style>
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter patchwire-desktop test src/components/ProjectRow.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/components/ProjectRow.svelte packages/desktop/src/components/ProjectRow.test.ts
git commit -m "feat(desktop): ProjectRow component"
```

---

### Task 9: Connect screen (manual connect form)

**Files:**
- Create: `src/screens/Connect.svelte`
- Test: `src/screens/Connect.test.ts`

- [ ] **Step 1: Write the failing test `src/screens/Connect.test.ts`**

```ts
import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import Connect from "./Connect.svelte";

beforeEach(() => invokeMock.mockReset());

function fill(getByLabelText: (t: string) => HTMLElement) {
  return async () => {
    await fireEvent.input(getByLabelText("Host"), { target: { value: "studio-mini" } });
    await fireEvent.input(getByLabelText("User"), { target: { value: "rebin" } });
    await fireEvent.input(getByLabelText("SSH key path"), { target: { value: "/home/rebin/.ssh/id" } });
  };
}

describe("Connect", () => {
  it("disables Connect until required fields are filled", async () => {
    const { getByTestId, getByLabelText } = render(Connect);
    const btn = getByTestId("connect-btn") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    await fill(getByLabelText)();
    expect(btn.disabled).toBe(false);
  });

  it("on successful health check, saves connection and fires onconnected", async () => {
    const onconnected = vi.fn();
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "host_health") return Promise.resolve('{"ok":true,"version":"0.4.0","user":"rebin"}');
      return Promise.resolve(undefined);
    });
    const { getByTestId, getByLabelText } = render(Connect, { props: { onconnected } });
    await fill(getByLabelText)();
    await fireEvent.click(getByTestId("connect-btn"));
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith("host_health", expect.anything());
    expect(invokeMock).toHaveBeenCalledWith("save_connection", expect.anything());
    expect(onconnected).toHaveBeenCalled();
  });

  it("shows an error and does not save when health check fails", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "host_health") return Promise.resolve('{"ok":false}');
      return Promise.resolve(undefined);
    });
    const { getByTestId, getByLabelText } = render(Connect);
    await fill(getByLabelText)();
    await fireEvent.click(getByTestId("connect-btn"));
    await Promise.resolve();
    expect(getByTestId("connect-error").textContent).toContain("Could not reach");
    expect(invokeMock).not.toHaveBeenCalledWith("save_connection", expect.anything());
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter patchwire-desktop test src/screens/Connect.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write `src/screens/Connect.svelte`**

```svelte
<script lang="ts">
  import type { Connection } from "../lib/types";
  import { isConnectionComplete } from "../lib/model";
  import { checkHealth, saveConnection } from "../lib/ipc";

  let { onconnected }: { onconnected?: (c: Connection) => void } = $props();

  let host = $state("");
  let user = $state("");
  let keyPath = $state("");
  let sshPort = $state(22);
  let agentPort = $state(7878);
  let busy = $state(false);
  let error = $state("");

  let draft = $derived<Connection>({ host, user, keyPath, sshPort, agentPort });
  let complete = $derived(isConnectionComplete(draft));

  async function connect() {
    error = "";
    busy = true;
    try {
      const health = await checkHealth(draft);
      if (!health.ok) {
        error = "Could not reach the agent. Check host, key, and that the agent is running.";
        return;
      }
      const conn: Connection = { ...draft, agentVersion: health.version };
      await saveConnection(conn);
      onconnected?.(conn);
    } catch (e) {
      error = `Connection failed: ${e}`;
    } finally {
      busy = false;
    }
  }
</script>

<div class="screen">
  <h1>Connect your remote</h1>
  <p class="sub">Point Patchwire at a machine already running the agent.</p>

  <label>Host<input aria-label="Host" bind:value={host} placeholder="studio-mini" /></label>
  <label>User<input aria-label="User" bind:value={user} placeholder="rebin" /></label>
  <label>SSH key path<input aria-label="SSH key path" bind:value={keyPath} placeholder="~/.ssh/id_ed25519" /></label>
  <div class="ports">
    <label>SSH port<input aria-label="SSH port" type="number" bind:value={sshPort} /></label>
    <label>Agent port<input aria-label="Agent port" type="number" bind:value={agentPort} /></label>
  </div>

  {#if error}<div class="error" data-testid="connect-error">{error}</div>{/if}

  <button class="primary" data-testid="connect-btn" disabled={!complete || busy} onclick={connect}>
    {busy ? "Connecting…" : "Connect"}
  </button>
</div>

<style>
  .screen { max-width: 440px; margin: 48px auto; padding: 0 24px;
    display: flex; flex-direction: column; gap: 12px; }
  h1 { font-size: 22px; margin: 0; }
  .sub { color: var(--text-muted); margin: 0 0 8px; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-muted); }
  label input { color: var(--text); }
  .ports { display: flex; gap: 12px; }
  .ports label { flex: 1; }
  .error { color: var(--error); font-size: 13px; }
  .primary { background: var(--accent-strong); color: #fff; padding: 10px; font-weight: 600;
    margin-top: 8px; }
  .primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter patchwire-desktop test src/screens/Connect.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/screens/Connect.svelte packages/desktop/src/screens/Connect.test.ts
git commit -m "feat(desktop): manual Connect screen with health verification"
```

---

### Task 10: Projects landing screen

**Files:**
- Create: `src/screens/Projects.svelte`
- Test: `src/screens/Projects.test.ts`

- [ ] **Step 1: Write the failing test `src/screens/Projects.test.ts`**

```ts
import { render } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import Projects from "./Projects.svelte";
import { connection, projects } from "../lib/stores";

beforeEach(() => {
  invokeMock.mockReset();
  connection.set({ host: "studio-mini", user: "rebin", sshPort: 22, keyPath: "/k", agentPort: 7878, agentVersion: "0.4.0" });
  projects.set([
    { id: "a", name: "api-server", branch: "main", localPath: "/l/a", remotePath: "/r/a", lastStatus: "in-sync", syncPaused: false },
    { id: "b", name: "web-app", branch: "main", localPath: "/l/b", remotePath: "/r/b", lastStatus: "working", syncPaused: false },
  ]);
});

describe("Projects", () => {
  it("renders the connection bar and one row per project", () => {
    const { getByTestId, getAllByTestId } = render(Projects);
    expect(getByTestId("conn-who").textContent).toBe("rebin@studio-mini");
    expect(getAllByTestId("row")).toHaveLength(2);
  });
  it("shows an empty state when there are no projects", () => {
    projects.set([]);
    const { getByTestId } = render(Projects);
    expect(getByTestId("projects-empty").textContent).toContain("No projects yet");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter patchwire-desktop test src/screens/Projects.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write `src/screens/Projects.svelte`**

```svelte
<script lang="ts">
  import { connection, projects } from "../lib/stores";
  import ConnectionBar from "../components/ConnectionBar.svelte";
  import ProjectRow from "../components/ProjectRow.svelte";
  import type { Project } from "../lib/types";

  let { onopen, onadd }: { onopen?: (p: Project) => void; onadd?: () => void } = $props();
  let query = $state("");

  let filtered = $derived(
    $projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())),
  );
</script>

{#if $connection}
  <ConnectionBar connection={$connection} healthy={true} />
{/if}

<div class="bar">
  <h2>Projects</h2>
  <button class="new" data-testid="new-project" onclick={() => onadd?.()}>＋ New project</button>
</div>

{#if $projects.length > 0}
  <input class="search" placeholder="Search projects…" bind:value={query} />
  {#each filtered as project (project.id)}
    <ProjectRow {project} {onopen} />
  {/each}
{:else}
  <div class="empty" data-testid="projects-empty">
    <p>No projects yet</p>
    <p class="sub">Add a local folder to sync it with your remote and start working.</p>
  </div>
{/if}

<style>
  .bar { display: flex; align-items: center; justify-content: space-between; padding: 16px 20px 10px; }
  .bar h2 { font-size: 15px; margin: 0; }
  .new { background: var(--accent-strong); color: #fff; font-size: 12px; padding: 7px 13px; font-weight: 600; }
  .search { margin: 0 20px 10px; display: block; width: calc(100% - 40px); }
  .empty { text-align: center; color: var(--text-muted); padding: 48px 20px; }
  .empty p { margin: 4px 0; }
  .empty .sub { font-size: 13px; }
</style>
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter patchwire-desktop test src/screens/Projects.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/screens/Projects.svelte packages/desktop/src/screens/Projects.test.ts
git commit -m "feat(desktop): Projects landing screen"
```

---

### Task 11: Add-project flow (folder picker)

**Files:**
- Modify: `src/lib/ipc.ts`
- Modify: `src/lib/ipc.test.ts`
- Create: `src/components/AddProjectDialog.svelte`
- Test: `src/components/AddProjectDialog.test.ts`

- [ ] **Step 1: Add a failing test for `pickFolder` to `src/lib/ipc.test.ts`**

Append this block to the existing `src/lib/ipc.test.ts` (keep the existing `vi.mock("@tauri-apps/api/core", ...)` and add the dialog mock at the top alongside it):

At the top of the file, add the dialog plugin mock next to the core mock:
```ts
const openMock = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));
```
Add the import:
```ts
import { pickFolder } from "./ipc";
```
Add the describe block:
```ts
describe("pickFolder", () => {
  beforeEach(() => openMock.mockReset());
  it("returns the chosen directory path", async () => {
    openMock.mockResolvedValue("/home/rebin/code/api");
    expect(await pickFolder()).toBe("/home/rebin/code/api");
    expect(openMock).toHaveBeenCalledWith({ directory: true, multiple: false });
  });
  it("returns null when the dialog is cancelled", async () => {
    openMock.mockResolvedValue(null);
    expect(await pickFolder()).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter patchwire-desktop test src/lib/ipc.test.ts`
Expected: FAIL — `pickFolder` not exported.

- [ ] **Step 3: Add `pickFolder` to `src/lib/ipc.ts`**

Add the import at the top:
```ts
import { open } from "@tauri-apps/plugin-dialog";
```
Add the function:
```ts
export async function pickFolder(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
  return typeof result === "string" ? result : null;
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter patchwire-desktop test src/lib/ipc.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test `src/components/AddProjectDialog.test.ts`**

```ts
import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
const openMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));

import AddProjectDialog from "./AddProjectDialog.svelte";

beforeEach(() => {
  invokeMock.mockReset();
  openMock.mockReset();
});

describe("AddProjectDialog", () => {
  it("picks a folder, fills the name, and saves a project on confirm", async () => {
    openMock.mockResolvedValue("/home/rebin/code/api-server");
    invokeMock.mockResolvedValue(undefined);
    const onsaved = vi.fn();
    const { getByTestId } = render(AddProjectDialog, { props: { onsaved } });

    await fireEvent.click(getByTestId("pick-folder"));
    await Promise.resolve();
    expect((getByTestId("local-path") as HTMLInputElement).value).toBe("/home/rebin/code/api-server");

    await fireEvent.input(getByTestId("remote-path"), { target: { value: "/remote/api-server" } });
    await fireEvent.click(getByTestId("save-project"));
    await Promise.resolve();

    expect(invokeMock).toHaveBeenCalledWith("save_project", expect.objectContaining({
      project: expect.objectContaining({ localPath: "/home/rebin/code/api-server", remotePath: "/remote/api-server", name: "api-server" }),
    }));
    expect(onsaved).toHaveBeenCalled();
  });

  it("disables save until both paths are set", async () => {
    const { getByTestId } = render(AddProjectDialog);
    expect((getByTestId("save-project") as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 6: Run test, verify it fails**

Run: `pnpm --filter patchwire-desktop test src/components/AddProjectDialog.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 7: Write `src/components/AddProjectDialog.svelte`**

```svelte
<script lang="ts">
  import { pickFolder, saveProject } from "../lib/ipc";
  import { buildProject } from "../lib/model";

  let { onsaved, oncancel }: { onsaved?: () => void; oncancel?: () => void } = $props();

  let localPath = $state("");
  let remotePath = $state("");
  let name = $state("");
  let busy = $state(false);

  let canSave = $derived(localPath.trim() !== "" && remotePath.trim() !== "");

  async function choose() {
    const dir = await pickFolder();
    if (dir) {
      localPath = dir;
      if (!name) name = dir.replace(/\/+$/, "").split("/").pop() ?? "";
    }
  }

  async function save() {
    busy = true;
    try {
      const project = buildProject(localPath, remotePath, name);
      await saveProject(project);
      onsaved?.();
    } finally {
      busy = false;
    }
  }
</script>

<div class="dialog">
  <h3>New project</h3>
  <button class="ghost" data-testid="pick-folder" onclick={choose}>Choose local folder…</button>
  <label>Local path<input aria-label="Local path" data-testid="local-path" bind:value={localPath} readonly /></label>
  <label>Remote path<input aria-label="Remote path" data-testid="remote-path" bind:value={remotePath} placeholder="/remote/project" /></label>
  <label>Name<input aria-label="Name" data-testid="project-name" bind:value={name} placeholder="optional" /></label>
  <div class="actions">
    <button class="ghost" onclick={() => oncancel?.()}>Cancel</button>
    <button class="primary" data-testid="save-project" disabled={!canSave || busy} onclick={save}>
      {busy ? "Saving…" : "Add project"}
    </button>
  </div>
</div>

<style>
  .dialog { max-width: 440px; margin: 24px auto; padding: 20px; background: var(--surface-panel);
    border: 1px solid var(--border); border-radius: var(--radius);
    display: flex; flex-direction: column; gap: 12px; }
  h3 { margin: 0; }
  label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-muted); }
  label input { color: var(--text); }
  .actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; }
  .ghost { background: var(--surface-raised); color: var(--text); padding: 8px 14px; }
  .primary { background: var(--accent-strong); color: #fff; padding: 8px 14px; font-weight: 600; }
  .primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
```

- [ ] **Step 8: Run test, verify it passes**

Run: `pnpm --filter patchwire-desktop test src/components/AddProjectDialog.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/desktop/src/lib/ipc.ts packages/desktop/src/lib/ipc.test.ts packages/desktop/src/components/AddProjectDialog.svelte packages/desktop/src/components/AddProjectDialog.test.ts
git commit -m "feat(desktop): add-project folder picker and dialog"
```

---

### Task 12: Wire App routing and verify the full flow

**Files:**
- Modify (rewrite): `src/App.svelte`
- Modify: `src/App.test.ts`

- [ ] **Step 1: Update the failing test `src/App.test.ts`**

Replace the file with:
```ts
import { render } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

import App from "./App.svelte";
import { connection, projects } from "./lib/stores";

beforeEach(() => {
  invokeMock.mockReset();
  connection.set(null);
  projects.set([]);
});

describe("App routing", () => {
  it("shows Connect when there is no connection", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_connection") return Promise.resolve(null);
      if (cmd === "list_projects") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const { findByText } = render(App);
    expect(await findByText("Connect your remote")).toBeTruthy();
  });

  it("shows Projects when a connection exists", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_connection") return Promise.resolve({ host: "h", user: "u", sshPort: 22, keyPath: "/k", agentPort: 7878 });
      if (cmd === "list_projects") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const { findByText } = render(App);
    expect(await findByText("Projects")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter patchwire-desktop test src/App.test.ts`
Expected: FAIL — App still renders the Task-1 placeholder, not the screens.

- [ ] **Step 3: Rewrite `src/App.svelte`**

```svelte
<script lang="ts">
  import "./styles/tokens.css";
  import { onMount } from "svelte";
  import { connection, projects, route, loadConnection, loadProjects } from "./lib/stores";
  import Connect from "./screens/Connect.svelte";
  import Projects from "./screens/Projects.svelte";
  import AddProjectDialog from "./components/AddProjectDialog.svelte";
  import type { Connection, Project } from "./lib/types";

  let adding = $state(false);
  let opened = $state<Project | null>(null); // P2 will route this into the workspace

  onMount(async () => {
    await loadConnection();
    if ($connection) await loadProjects();
  });

  async function onconnected(c: Connection) {
    connection.set(c);
    await loadProjects();
  }

  async function onsaved() {
    adding = false;
    await loadProjects();
  }
</script>

<div data-testid="app-root" class="app">
  {#if $route === "connect"}
    <Connect {onconnected} />
  {:else if adding}
    <AddProjectDialog {onsaved} oncancel={() => (adding = false)} />
  {:else}
    <Projects onopen={(p) => (opened = p)} onadd={() => (adding = true)} />
  {/if}
</div>

<style>
  .app { height: 100%; }
</style>
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter patchwire-desktop test src/App.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run: `pnpm --filter patchwire-desktop test`
Expected: ALL tests pass (new Svelte/model/ipc/store tests + the retained util tests).

- [ ] **Step 6: Manual end-to-end verification**

Run (from `packages/desktop`): `pnpm stage-sidecar && pnpm tauri dev`
Verify by observation:
1. First launch (no `connection.json`) shows the **Connect** screen.
2. Entering a real, reachable agent's host/user/key + ports and clicking **Connect** advances to **Projects** (the connection bar shows `user@host` + version + a green dot).
3. **＋ New project** → **Choose local folder…** opens the OS folder picker; selecting a folder fills the local path; entering a remote path + **Add project** returns to the list with the new row.
4. Relaunching the app goes straight to **Projects** (connection persisted), with the project still listed.
5. An unreachable host on Connect shows the "Could not reach the agent" error and does not advance.

Note in the commit message if any step could not be verified (e.g. no reachable agent available) so the executor of P2 knows what still needs a live check.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/App.svelte packages/desktop/src/App.test.ts
git commit -m "feat(desktop): route Connect -> Projects -> add-project; P1 flow complete"
```

---

## Self-Review

**Spec coverage (P1 portions):**
- Svelte stack → Tasks 1, 7–12. ✓
- Dark-indigo design tokens → Task 2. ✓
- Single connection model + persistence → Tasks 3, 4, 5, 9. ✓
- Multiple projects, each a folder mapping, persisted independently → Tasks 3, 4, 6, 11. ✓
- Codex-style Projects landing (connection bar + rows + search + new) → Tasks 7, 8, 10. ✓
- Connect (already-provisioned case) → Task 9. ✓ (Full `patchwire setup` wizard is P4, per spec scope.)
- CLI-sidecar architecture (health via `host_health`) → Task 5. ✓
- Ops-console UI retired from the entry point → Task 1 (main.ts rewritten); pure util modules + Rust commands retained intentionally per the File Structure note.
- Routing → Task 12. ✓
- Out of scope for P1 (chat, diffs, sync, settings, setup wizard) → P2–P5 plans, not this document. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code; every test step shows full assertions. The `opened` state in Task 12 is a deliberate, documented hook for P2, not a placeholder.

**Type consistency:** `Connection`, `Project`, `ProjectStatus`, `HealthResult`, `HostArgs` defined once in `types.ts` (Task 3) and used unchanged thereafter. IPC command names (`read_connection`, `save_connection`, `list_projects`, `save_project`, `host_health`) match between Rust (Task 4) and TS wrappers (Task 5) and component tests (Tasks 9–12). `projectStatusLabel` kinds (`ok|warn|error|muted`) match the `.pill` classes in `ProjectRow.svelte` (Task 8). `buildProject` name-from-basename behavior is asserted in Task 3 and reused in Task 11.

## Follow-on plans (not in P1)
- **P2** Workspace: split layout, chat streaming (`patchwire chat --json` via a new event-emitting Rust command), diff render, apply (`patchwire apply`).
- **P3** Sync: supervised per-project `patchwire sync --json`, status pills, pause/resume, conflict surfacing.
- **P4** Onboarding wizard (reuse `start_provision` / `patchwire setup --provision-remote --stream`) + Settings.
- **P5** Motion + empty/loading/error polish + accessibility.
