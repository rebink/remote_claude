# Desktop Computer-Name Namespace + Overwrite Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the desktop Add Project flow, auto-namespace the remote path by the local machine's computer name (fallback to SSH user), and on `target_exists` show a 3-way Overwrite / Use existing / Cancel prompt mirroring the VS Code extension.

**Architecture:** Two pure JS helpers (`slugifySegment`, `parseInitRemoteResult`) carry the testable logic; a new Tauri `computer_name` command and a `mode` param on `init_remote_copy` provide the native edges (live-verify); `AddProject.svelte` wires them with an in-app modal. The CLI already supports `--json`/`--overwrite`/`--use-existing` — unchanged.

**Tech Stack:** TypeScript + Svelte 5 (runes) + vitest + @testing-library/svelte (desktop), Rust + Tauri 2 (`src-tauri`). Spec: `docs/superpowers/specs/2026-06-17-desktop-computer-name-namespace-and-overwrite-design.md`.

---

## File Structure

**New (desktop JS):**
- `packages/desktop/src/lib/slug.ts` — `slugifySegment(name)` pure path-segment slugifier.
- `packages/desktop/src/lib/init-remote-events.ts` — `parseInitRemoteResult(stdout)` NDJSON parser + `InitRemoteResult` type.

**Modified (desktop JS):**
- `packages/desktop/src/lib/ipc.ts` — add `computerName()`, `InitRemoteMode`; change `initRemoteCopy` to take `mode` and return `InitRemoteResult`.
- `packages/desktop/src/screens/AddProject.svelte` — computer-name path build, `runCopy(mode)` refactor, exists modal.
- `packages/desktop/src/screens/AddProject.test.ts` — update existing tests, add new ones.

**Modified (Rust):**
- `packages/desktop/src-tauri/src/lib.rs` — new `computer_name` command (registered in `invoke_handler`); `init_remote_copy` gains a `mode` param + `--json`.

**Test commands** (from `packages/desktop`): `pnpm vitest run <path>`. Note the desktop `build` script's `tsc` step has **pre-existing** errors in unrelated test fixtures — ignore those; only your files must typecheck and your tests pass. Rust: `cd src-tauri && cargo build` (live-verify; no Rust unit tests in this repo).

---

## Task 1: `slugifySegment` (pure)

**Files:**
- Create: `packages/desktop/src/lib/slug.ts`
- Test: `packages/desktop/src/lib/slug.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/desktop/src/lib/slug.test.ts
import { describe, it, expect } from "vitest";
import { slugifySegment } from "./slug";

describe("slugifySegment", () => {
  it("passes a clean name through", () => {
    expect(slugifySegment("Admin")).toBe("Admin");
  });
  it("replaces whitespace runs with a single dash", () => {
    expect(slugifySegment("Studio  Mini")).toBe("Studio-Mini");
  });
  it("strips apostrophes and other punctuation", () => {
    expect(slugifySegment("Apple's MacBook Pro")).toBe("Apples-MacBook-Pro");
  });
  it("keeps dots, dashes, underscores", () => {
    expect(slugifySegment("dev_box-1.2")).toBe("dev_box-1.2");
  });
  it("trims leading/trailing separators", () => {
    expect(slugifySegment("  -.box.-  ")).toBe("box");
  });
  it("returns empty string when nothing usable remains", () => {
    expect(slugifySegment("   ")).toBe("");
    expect(slugifySegment("💻")).toBe("");
  });
});
```

- [ ] **Step 2: Run test → FAIL**

Run: `cd packages/desktop && pnpm vitest run src/lib/slug.test.ts`
Expected: FAIL — cannot find module `./slug`.

- [ ] **Step 3: Implement**

```ts
// packages/desktop/src/lib/slug.ts

/**
 * Turn an arbitrary machine/computer name into a safe single path segment
 * matching the remote project-name grammar [A-Za-z0-9._-]. Whitespace runs
 * collapse to '-'; unsupported characters are dropped. Returns "" when nothing
 * usable remains (caller should then fall back to another value).
 */
export function slugifySegment(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
}
```

- [ ] **Step 4: Run test → PASS**

Run: `cd packages/desktop && pnpm vitest run src/lib/slug.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/lib/slug.ts packages/desktop/src/lib/slug.test.ts
git commit -m "feat(desktop): slugifySegment for safe remote path segments"
```

---

## Task 2: `parseInitRemoteResult` (pure NDJSON parser)

**Files:**
- Create: `packages/desktop/src/lib/init-remote-events.ts`
- Test: `packages/desktop/src/lib/init-remote-events.test.ts`

Mirrors `packages/extension/src/setup/SetupWizard.ts`: the `--json` stream emits `BootstrapEvent` lines — `{type:'step', status:'fail', code, stderr}` on failure and `{type:'done', ok}` at the end.

- [ ] **Step 1: Write the failing test**

```ts
// packages/desktop/src/lib/init-remote-events.test.ts
import { describe, it, expect } from "vitest";
import { parseInitRemoteResult } from "./init-remote-events";

describe("parseInitRemoteResult", () => {
  it("returns ok when a done:true event is present", () => {
    const out = [
      '{"type":"step","name":"probe","status":"ok"}',
      '{"type":"done","ok":true,"projectName":"api"}',
    ].join("\n");
    expect(parseInitRemoteResult(out)).toEqual({ ok: true });
  });

  it("detects target_exists from a fail event", () => {
    const out = [
      '{"type":"step","name":"probe","status":"start"}',
      '{"type":"step","name":"probe","status":"fail","code":"target_exists"}',
      '{"type":"done","ok":false}',
    ].join("\n");
    expect(parseInitRemoteResult(out)).toEqual({ ok: false, code: "target_exists" });
  });

  it("surfaces another failure code with stderr", () => {
    const out = [
      '{"type":"step","name":"probe","status":"fail","code":"ssh_auth_failed","stderr":"perm denied"}',
      '{"type":"done","ok":false}',
    ].join("\n");
    expect(parseInitRemoteResult(out)).toEqual({ ok: false, code: "ssh_auth_failed", stderr: "perm denied" });
  });

  it("ignores blank and non-JSON lines, defaults to unknown_error", () => {
    const out = "warming up\n\n{not json}\n";
    expect(parseInitRemoteResult(out)).toEqual({ ok: false, code: "unknown_error" });
  });
});
```

- [ ] **Step 2: Run test → FAIL**

Run: `cd packages/desktop && pnpm vitest run src/lib/init-remote-events.test.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement**

```ts
// packages/desktop/src/lib/init-remote-events.ts

export type InitRemoteResult =
  | { ok: true }
  | { ok: false; code: "target_exists" }
  | { ok: false; code: string; stderr?: string };

/**
 * Parse the NDJSON stream emitted by `patchwire init-remote --json`. Tracks the
 * last `status:'fail'` event and whether a `done:true` arrived — mirroring the
 * VS Code extension's SetupWizard parsing. Non-JSON / blank lines are ignored.
 */
export function parseInitRemoteResult(stdout: string): InitRemoteResult {
  let doneOk = false;
  let lastFail: { code: string; stderr?: string } | undefined;
  for (const raw of stdout.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let evt: { type?: string; status?: string; code?: string; stderr?: string; ok?: boolean };
    try {
      evt = JSON.parse(line);
    } catch {
      continue;
    }
    if (evt.type === "step" && evt.status === "fail" && typeof evt.code === "string") {
      lastFail = { code: evt.code, stderr: evt.stderr };
    }
    if (evt.type === "done" && evt.ok === true) doneOk = true;
  }
  if (doneOk) return { ok: true };
  if (lastFail?.code === "target_exists") return { ok: false, code: "target_exists" };
  if (lastFail) return { ok: false, code: lastFail.code, ...(lastFail.stderr ? { stderr: lastFail.stderr } : {}) };
  return { ok: false, code: "unknown_error" };
}
```

- [ ] **Step 4: Run test → PASS**

Run: `cd packages/desktop && pnpm vitest run src/lib/init-remote-events.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/lib/init-remote-events.ts packages/desktop/src/lib/init-remote-events.test.ts
git commit -m "feat(desktop): parseInitRemoteResult for init-remote --json stream"
```

---

## Task 3: Rust — `computer_name` command + `init_remote_copy` mode param

**Files:**
- Modify: `packages/desktop/src-tauri/src/lib.rs`

No Rust unit tests in this repo — verify with `cargo build`. Read the current `init_remote_copy` (around `lib.rs:706`) and the `invoke_handler!` macro list (around `lib.rs:760-786`) before editing.

- [ ] **Step 1: Replace the `init_remote_copy` function**

Replace the existing `#[tauri::command] async fn init_remote_copy(...)` (the whole function, ~`lib.rs:706-740`) with this version (adds `mode: String`, always passes `--json`, returns stdout regardless of exit unless stdout is empty on a hard failure):

```rust
// Run `patchwire init-remote --from-local --json` in the project dir. `mode`
// selects how an existing remote path is handled: "create" (no flag),
// "overwrite" (--overwrite, rm -rf + re-push) or "use_existing" (--use-existing,
// config-only). The full NDJSON stdout is returned to the caller, which parses it
// (parseInitRemoteResult) — including the `target_exists` signal that exits
// non-zero but is reported on stdout.
#[tauri::command]
async fn init_remote_copy(
    app: tauri::AppHandle,
    project_dir: String,
    remote_path: String,
    mode: String,
) -> Result<String, String> {
    use tauri_plugin_shell::ShellExt;
    if !std::path::Path::new(&project_dir).is_dir() {
        return Err("project_dir does not exist".into());
    }
    let project_name = std::path::Path::new(&project_dir)
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| "cannot derive project name from project_dir".to_string())?
        .to_string();

    let mut args: Vec<String> = vec![
        "init-remote".into(),
        "--from-local".into(),
        "--project".into(),
        project_name,
        "--remote-path".into(),
        remote_path,
        "--json".into(),
    ];
    match mode.as_str() {
        "overwrite" => args.push("--overwrite".into()),
        "use_existing" => args.push("--use-existing".into()),
        _ => {} // "create" — no flag
    }

    let sidecar = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?;
    let output = sidecar
        .current_dir(std::path::PathBuf::from(&project_dir))
        .args(args)
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    // Hard failure with no NDJSON to parse → surface stderr as an error.
    if stdout.trim().is_empty() && !output.status.success() {
        return Err(format!(
            "init-remote failed: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(stdout)
}
```

- [ ] **Step 2: Add the `computer_name` command**

Add this new command directly above the `init_remote_copy` function (or anywhere among the other `#[tauri::command]` fns):

```rust
// Best-effort local machine name for namespacing remote paths. macOS uses the
// friendly ComputerName; other platforms fall back to the hostname. The caller
// slugifies the result and falls back to the SSH user if this errors.
#[tauri::command]
fn computer_name() -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = std::process::Command::new("scutil")
            .args(["--get", "ComputerName"])
            .output()
        {
            if out.status.success() {
                let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !name.is_empty() {
                    return Ok(name);
                }
            }
        }
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(name) = std::env::var("COMPUTERNAME") {
            let n = name.trim().to_string();
            if !n.is_empty() {
                return Ok(n);
            }
        }
    }
    // Unix / ultimate fallback: the `hostname` command.
    if let Ok(out) = std::process::Command::new("hostname").output() {
        if out.status.success() {
            let name = String::from_utf8_lossy(&out.stdout).trim().to_string();
            if !name.is_empty() {
                return Ok(name);
            }
        }
    }
    Err("could not determine computer name".into())
}
```

- [ ] **Step 3: Register `computer_name` in the handler**

In the `tauri::generate_handler![ ... ]` list (around `lib.rs:760`), add `computer_name,` next to the other commands (e.g. right after `open_terminal,`). `init_remote_copy` is already listed — leave it.

- [ ] **Step 4: Build to verify it compiles**

Run: `cd packages/desktop/src-tauri && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo build 2>&1 | tail -15`
Expected: `Finished` (no errors). (cargo isn't on the default PATH in this environment — the toolchain lives at `~/.rustup/toolchains/stable-aarch64-apple-darwin/bin`.)

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): computer_name command + init_remote_copy mode/--json"
```

---

## Task 4: ipc.ts — `computerName()` + `initRemoteCopy(mode)`

**Files:**
- Modify: `packages/desktop/src/lib/ipc.ts`

- [ ] **Step 1: Replace the existing `initRemoteCopy` + add `computerName`**

Find the current:
```ts
export async function initRemoteCopy(projectDir: string, remotePath: string): Promise<string> {
  return invoke<string>("init_remote_copy", { projectDir, remotePath });
}
```
Replace it with (and add the import + mode type):
```ts
import { parseInitRemoteResult, type InitRemoteResult } from "./init-remote-events";

export type InitRemoteMode = "create" | "overwrite" | "use_existing";
export type { InitRemoteResult };

export async function initRemoteCopy(
  projectDir: string,
  remotePath: string,
  mode: InitRemoteMode = "create",
): Promise<InitRemoteResult> {
  const stdout = await invoke<string>("init_remote_copy", { projectDir, remotePath, mode });
  return parseInitRemoteResult(stdout);
}

/** Local machine name for path namespacing; "" if unavailable (caller falls back). */
export async function computerName(): Promise<string> {
  try {
    const r = await invoke<string>("computer_name");
    return typeof r === "string" ? r : "";
  } catch {
    return "";
  }
}
```
Place the `import` line with the other top-of-file imports (it's fine for ipc.ts to import from `./init-remote-events`). If ESLint/style prefers imports grouped at the top, move it there.

- [ ] **Step 2: Typecheck the file**

Run: `cd packages/desktop && pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'ipc\.ts|init-remote-events\.ts|slug\.ts' || echo "no new errors in changed files"`
Expected: `no new errors in changed files` (pre-existing errors in other test files are unrelated — do not fix them here).

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/lib/ipc.ts
git commit -m "feat(desktop): ipc computerName() + initRemoteCopy(mode) -> InitRemoteResult"
```

---

## Task 5: AddProject.svelte — computer-name path + overwrite modal

**Files:**
- Modify: `packages/desktop/src/screens/AddProject.svelte`
- Modify: `packages/desktop/src/screens/AddProject.test.ts`

This task changes existing behavior, so the existing tests are UPDATED (not just appended). Do the test edits first (TDD), watch them fail, then implement the component.

- [ ] **Step 1: Rewrite `AddProject.test.ts`**

Replace the whole file with:

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
const DONE_OK = '{"type":"done","ok":true}';
const TARGET_EXISTS = '{"type":"step","name":"probe","status":"fail","code":"target_exists"}\n{"type":"done","ok":false}';

beforeEach(() => { invokeMock.mockReset(); openMock.mockReset(); connections.set([conn]); });

// Default invoke handler: computer_name resolves to a machine name; init_remote_copy ok.
function baseInvoke(overrides: (cmd: string) => unknown | undefined = () => undefined) {
  invokeMock.mockImplementation((cmd: string) => {
    const o = overrides(cmd);
    if (o !== undefined) return Promise.resolve(o);
    if (cmd === "computer_name") return Promise.resolve("studio-box");
    if (cmd === "init_remote_copy") return Promise.resolve(DONE_OK);
    if (cmd === "sync_command") return Promise.resolve('{"type":"sync_action","action":"start","ok":true}');
    return Promise.resolve(undefined); // write_project_yml, save_project
  });
}

async function flush(n = 10) { for (let i = 0; i < n; i++) await Promise.resolve(); }

describe("AddProject", () => {
  it("disables Create until a folder is chosen", () => {
    baseInvoke();
    const { getByTestId } = render(AddProject, { props: { connection: conn } });
    expect((getByTestId("create-project") as HTMLButtonElement).disabled).toBe(true);
  });

  it("auto-fills the remote path namespaced by the computer name", async () => {
    baseInvoke();
    openMock.mockResolvedValue("/home/r/api");
    const { getByTestId } = render(AddProject, { props: { connection: conn } });
    await flush();
    await fireEvent.click(getByTestId("pick-folder"));
    await flush();
    expect((getByTestId("remote-path") as HTMLInputElement).value).toBe("~/patchwire/studio-box/api");
  });

  it("falls back to the SSH user when the computer name is unavailable", async () => {
    baseInvoke((cmd) => (cmd === "computer_name" ? "" : undefined));
    openMock.mockResolvedValue("/home/r/api");
    const { getByTestId } = render(AddProject, { props: { connection: conn } });
    await flush();
    await fireEvent.click(getByTestId("pick-folder"));
    await flush();
    expect((getByTestId("remote-path") as HTMLInputElement).value).toBe("~/patchwire/rebin/api");
  });

  it("creates the project: write yml → init copy(create) → sync → save → onfinish", async () => {
    baseInvoke();
    openMock.mockResolvedValue("/home/r/api");
    const onfinish = vi.fn();
    const { getByTestId } = render(AddProject, { props: { connection: conn, onfinish } });
    await flush();
    await fireEvent.click(getByTestId("pick-folder"));
    await flush();
    await fireEvent.click(getByTestId("create-project"));
    await flush();
    expect(invokeMock).toHaveBeenCalledWith("write_project_yml", { args: expect.objectContaining({
      projectDir: "/home/r/api", project: "api", host: "studio-mini", user: "rebin", remotePath: "~/patchwire/studio-box/api", token: "TKN",
    }) });
    expect(invokeMock).toHaveBeenCalledWith("init_remote_copy", { projectDir: "/home/r/api", remotePath: "~/patchwire/studio-box/api", mode: "create" });
    expect(invokeMock).toHaveBeenCalledWith("sync_command", { projectDir: "/home/r/api", sub: "start" });
    expect(onfinish).toHaveBeenCalled();
  });

  it("on target_exists shows the modal, then Overwrite re-runs init copy with mode=overwrite", async () => {
    let copyCalls = 0;
    baseInvoke((cmd) => {
      if (cmd === "init_remote_copy") {
        copyCalls += 1;
        return copyCalls === 1 ? TARGET_EXISTS : DONE_OK;
      }
      return undefined;
    });
    openMock.mockResolvedValue("/home/r/api");
    const onfinish = vi.fn();
    const { getByTestId, queryByTestId } = render(AddProject, { props: { connection: conn, onfinish } });
    await flush();
    await fireEvent.click(getByTestId("pick-folder"));
    await flush();
    await fireEvent.click(getByTestId("create-project"));
    await flush();
    expect(getByTestId("exists-modal")).toBeTruthy();
    expect(onfinish).not.toHaveBeenCalled();
    await fireEvent.click(getByTestId("exists-overwrite"));
    await flush();
    const overwriteCall = invokeMock.mock.calls.find(
      (c) => c[0] === "init_remote_copy" && (c[1] as { mode?: string }).mode === "overwrite",
    );
    expect(overwriteCall).toBeTruthy();
    expect(queryByTestId("exists-modal")).toBeNull();
    expect(onfinish).toHaveBeenCalled();
  });

  it("Cancel on the modal aborts without finishing", async () => {
    baseInvoke((cmd) => (cmd === "init_remote_copy" ? TARGET_EXISTS : undefined));
    openMock.mockResolvedValue("/home/r/api");
    const onfinish = vi.fn();
    const { getByTestId, queryByTestId } = render(AddProject, { props: { connection: conn, onfinish } });
    await flush();
    await fireEvent.click(getByTestId("pick-folder"));
    await flush();
    await fireEvent.click(getByTestId("create-project"));
    await flush();
    await fireEvent.click(getByTestId("exists-cancel"));
    await flush();
    expect(queryByTestId("exists-modal")).toBeNull();
    expect(onfinish).not.toHaveBeenCalled();
    expect(getByTestId("add-error").textContent).toContain("Cancelled");
  });
});
```

- [ ] **Step 2: Run the tests → FAIL**

Run: `cd packages/desktop && pnpm vitest run src/screens/AddProject.test.ts`
Expected: FAIL (component not yet updated — old path `~/patchwire/rebin/api`, no `mode`, no modal).

- [ ] **Step 3: Rewrite `AddProject.svelte`**

Replace the whole file with:

```svelte
<script lang="ts">
  import { connections } from "../lib/stores";
  import { pickFolder, writeProjectYml, initRemoteCopy, syncCommand, saveProject, computerName, type InitRemoteMode } from "../lib/ipc";
  import { slugifySegment } from "../lib/slug";
  import { buildProject } from "../lib/model";
  import type { Connection } from "../lib/types";
  import { onMount } from "svelte";

  let { connection, onfinish, onback }: { connection: Connection; onfinish?: () => void; onback?: () => void } = $props();

  // Initialise to the passed connection; the user can change it via the dropdown.
  let connId = $state<string>(connection.id);
  let localPath = $state("");
  let name = $state("");
  let remotePath = $state("");
  let busy = $state(false);
  let phase = $state("");
  let error = $state("");
  let computer = $state("");
  let existsPrompt = $state(false);

  let chosen = $derived($connections.find((c) => c.id === connId) ?? connection);
  let canCreate = $derived(localPath.trim() !== "" && remotePath.trim() !== "");

  onMount(() => { computerName().then((v) => (computer = v)); });

  function basename(p: string): string { return p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? ""; }

  async function choose() {
    const dir = await pickFolder();
    if (!dir) return;
    localPath = dir;
    name = basename(dir);
    const seg = slugifySegment(computer) || chosen.user;
    remotePath = `~/patchwire/${seg}/${name}`;
  }

  // Copy step, re-runnable with a different mode after a target_exists prompt.
  async function runCopy(mode: InitRemoteMode) {
    phase = "Copying to remote…";
    const r = await initRemoteCopy(localPath, remotePath, mode);
    if (r.ok) {
      phase = "Starting sync…";
      await syncCommand(localPath, "start");
      await saveProject(buildProject(localPath, remotePath, name, chosen.host, chosen.user, chosen.id));
      onfinish?.();
      return;
    }
    if (r.code === "target_exists") { existsPrompt = true; busy = false; return; }
    error = `Failed: ${r.stderr ?? r.code}`;
    busy = false;
  }

  async function create() {
    error = ""; existsPrompt = false; busy = true;
    try {
      phase = "Writing config…";
      await writeProjectYml({ projectDir: localPath, project: name, host: chosen.host, user: chosen.user, sshPort: chosen.sshPort, agentPort: chosen.agentPort, remotePath, token: chosen.token });
      await runCopy("create");
    } catch (e) {
      error = `Failed: ${e}`;
      busy = false;
    }
  }

  async function chooseExisting(mode: InitRemoteMode) {
    existsPrompt = false; error = ""; busy = true;
    try { await runCopy(mode); } catch (e) { error = `Failed: ${e}`; busy = false; }
  }

  function cancelExists() { existsPrompt = false; busy = false; error = "Cancelled: target exists on remote."; }
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

  {#if existsPrompt}
    <div class="exists-modal" data-testid="exists-modal" role="dialog" aria-label="Remote path exists">
      <p>{remotePath} already exists on the remote.</p>
      <div class="exists-actions">
        <button class="primary" data-testid="exists-overwrite" onclick={() => chooseExisting("overwrite")}>Overwrite (rm -rf + re-push)</button>
        <button data-testid="exists-use-existing" onclick={() => chooseExisting("use_existing")}>Use existing (skip copy)</button>
        <button class="ghost" data-testid="exists-cancel" onclick={cancelExists}>Cancel</button>
      </div>
    </div>
  {/if}

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
  .exists-modal { border: 1px solid var(--border-strong); background: var(--surface-raised); border-radius: var(--radius-sm); padding: 12px; display: flex; flex-direction: column; gap: 10px; font-size: 12px; color: var(--text); }
  .exists-actions { display: flex; flex-direction: column; gap: 6px; }
  .exists-actions button { padding: 8px 10px; }
</style>
```

- [ ] **Step 4: Run the tests → PASS**

Run: `cd packages/desktop && pnpm vitest run src/screens/AddProject.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full desktop suite + check no regressions**

Run: `cd packages/desktop && pnpm vitest run`
Expected: all green (was 166 passed before this plan; now +10 from slug(6)+init-remote-events(4), AddProject count adjusted). Flag any regression.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/screens/AddProject.svelte packages/desktop/src/screens/AddProject.test.ts
git commit -m "feat(desktop): computer-name remote path + target_exists overwrite modal"
```

---

## Final verification

- [ ] `cd packages/desktop && pnpm vitest run` — all green.
- [ ] `cd packages/desktop/src-tauri && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo build` — compiles.
- [ ] Manual live-verify (the only place the native edges are proven): Add Project against (a) a fresh path → confirm the segment is the computer name; (b) an existing remote path → confirm the modal, and that Overwrite/Use existing/Cancel each behave (rm+re-push / attach without copy / abort).

---

## Self-Review notes (spec → tasks)

- Local computer name source (scutil/hostname, fallback) → Task 3 (`computer_name`) + Task 4 (`computerName()`) + Task 5 (fallback to `chosen.user`).
- `slugifySegment` → Task 1.
- `parseInitRemoteResult` + `InitRemoteResult` → Task 2; consumed in Task 4 (`initRemoteCopy` returns it) and Task 5 (switch on `.ok`/`.code`).
- `init_remote_copy` `mode` + `--json` → Task 3; `InitRemoteMode` type + call → Task 4 + Task 5.
- 3-way overwrite modal (Overwrite/Use existing/Cancel), mirror extension → Task 5.
- Editable remote-path input preserved; `writeProjectYml` runs once before re-runnable `runCopy` → Task 5.
- Tests for slug, parser, and AddProject (computer-name path, fallback, target_exists→modal→overwrite, cancel) → Tasks 1, 2, 5.
- Type names consistent across tasks: `InitRemoteResult`, `InitRemoteMode` (`"create"|"overwrite"|"use_existing"`), `slugifySegment`, `parseInitRemoteResult`, `computerName`, `initRemoteCopy(projectDir, remotePath, mode)`.
