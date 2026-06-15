# Desktop Developer Client — Phase 3b (desktop sync supervision UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface continuous sync in the desktop client — live status pills on the Projects landing and in the open Workspace, with pause/resume and conflict surfacing — by supervising the P3a CLI `sync-*` commands via the sidecar. Also closes the P3a/P2 review fast-follows (security defense-in-depth, conflict cap, error-kind, missing test).

**Architecture:** Same UI-over-CLI model. A new Rust `start_sync_watch` streams `patchwire sync-watch --json` (with `current_dir` = the project's local folder) as `pw://sync` events; `sync_command` runs the one-shot `sync-<sub> --json` commands (status/start/pause/resume/flush/stop) via `.output()`. A pure TS layer parses the `sync_status`/`sync_action` lines and maps mutagen kinds to the existing `ProjectStatus`. The Projects landing polls one-shot `sync-status` per project on load (cheap; the mutagen daemon syncs in the background regardless of the app); the open Workspace runs a live `sync-watch` and offers pause/resume + a conflict list.

**Tech Stack:** Tauri 2 + tauri-plugin-shell, Svelte 5 (runes), Vitest + @testing-library/svelte, the P3a `patchwire sync-*` CLI seams.

**Spec:** `docs/superpowers/specs/2026-06-15-desktop-developer-client-design.md` (P3 sync). **Builds on:** P1 (Projects landing, `ProjectStatus`/`projectStatusLabel`, stores), P2 (Workspace header), P3a (CLI `sync-start/status/watch/pause/resume/flush/stop`, JSON shapes `{type:"sync_status",kind,conflicts}` / `{type:"sync_action",action,ok}`).

**Sync kinds (from P3a):** `not_installed | no_session | connecting | watching | syncing | conflict | paused | error`.

**Working dir:** `packages/desktop` (CLI tasks: `packages/cli`). Desktop tests: `pnpm --filter patchwire-desktop test`. CLI tests: `pnpm --filter @rebink/patchwire test`.

---

## File Structure
**CLI (Task 1 — fast-follows):**
- Modify: `packages/cli/src/lib/config.ts` — host/user regex refinement (security defense-in-depth).
- Modify: `packages/cli/src/lib/mutagen.ts` — cap conflict files to 10; emit `error` kind on runner failure.
- Test: `packages/cli/test/config.test.ts` (extend/create), `packages/cli/test/mutagen.test.ts` (extend), `packages/cli/test/sync-session.test.ts` (extend — loadMutagenTarget covered via a new exported helper or a cli-level note).

**Desktop frontend:**
- Modify: `src/lib/types.ts` — add `"conflict"` to `ProjectStatus`.
- Modify: `src/lib/model.ts` + `src/lib/model.test.ts` — `projectStatusLabel("conflict")`.
- Create: `src/lib/sync-events.ts` + `src/lib/sync-events.test.ts` — `SyncStatus`/`SyncKind`, `parseSyncLine`, `syncKindToProjectStatus`.
- Modify: `src/lib/ipc.ts` + `src/lib/ipc.test.ts` — `syncCommand`, `startSyncWatch`, `onSyncEvent`, `onSyncEnd`.
- Create: `src/components/SyncPill.svelte` + `src/components/SyncPill.test.ts`.
- Modify: `src/screens/Projects.svelte` + `src/screens/Projects.test.ts` — populate real per-project status + connection health.
- Modify: `src/screens/Workspace.svelte` + `src/screens/Workspace.test.ts` — live watch + pause/resume + conflicts in the header.

**Desktop Rust:**
- Modify: `src-tauri/src/lib.rs` — `SyncWatchState`, `start_sync_watch`, `stop_sync_watch`, `sync_command`; register them.

---

### Task 1: CLI fast-follows (security + fidelity)

**Files:**
- Modify: `packages/cli/src/lib/config.ts`
- Modify: `packages/cli/src/lib/mutagen.ts`
- Test: `packages/cli/test/config.test.ts`, `packages/cli/test/mutagen.test.ts`

> Read `config.ts` for the real `ConfigSchema` (remote.host/remote.user fields). Add a strict-token regex refinement so a hostile `patchwire.yml` is rejected at the parse boundary (defense-in-depth complementing the P3a sink fix in `mutagen-ssh.ts`).

- [ ] **Step 1: Write failing tests**

In `packages/cli/test/config.test.ts` (match the existing config-test style; create if absent):
```ts
import { describe, it, expect } from "vitest";
import { ConfigSchema } from "../src/lib/config.ts"; // adapt to the real export

const base = {
  // fill with the minimal valid config shape from config.ts (project, remote{host,user,path}, ...)
};

describe("ConfigSchema host/user hardening", () => {
  it("rejects a host containing a newline", () => {
    expect(() => ConfigSchema.parse({ ...base, remote: { ...base.remote, host: "h\nProxyCommand evil" } })).toThrow();
  });
  it("rejects a user containing whitespace", () => {
    expect(() => ConfigSchema.parse({ ...base, remote: { ...base.remote, user: "a b" } })).toThrow();
  });
  it("accepts a normal host/user", () => {
    expect(() => ConfigSchema.parse({ ...base, remote: { ...base.remote, host: "studio-mini", user: "rebin" } })).not.toThrow();
  });
});
```
In `packages/cli/test/mutagen.test.ts` add:
```ts
it("getStatus caps conflict files at 10", () => {
  const many = Array.from({ length: 15 }, (_, i) => `  α (f${i}.ts)`).join("\n");
  const longOut = `Conflicts:\n${many}\n\n`;
  const run = (args: string[]) =>
    args.includes("--long")
      ? { status: 0, stdout: longOut, stderr: "" }
      : { status: 0, stdout: "Watching|false|12", stderr: "" };
  const s = getStatus(run, "rc-x");
  expect(s.kind).toBe("conflict");
  if (s.kind === "conflict") expect(s.files.length).toBe(10);
});
it("getStatus returns error kind when the runner throws", () => {
  const run = () => { throw new Error("spawn failed"); };
  expect(getStatus(run, "rc-x").kind).toBe("error");
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @rebink/patchwire test config.test.ts mutagen.test.ts`
Expected: FAIL (no refinement; conflict not capped — P3a already slices to 10, so that test may pass; if it already passes, keep it as a regression guard; the error-kind and config tests fail).

- [ ] **Step 3: Implement**

In `config.ts`, add a shared token schema and apply to host + user (adapt to the real field path):
```ts
const sshToken = z.string().regex(/^[A-Za-z0-9._-]+$/, "must be a safe ssh token (no whitespace/newlines/#)");
// in the remote object: host: sshToken, user: sshToken,
```
In `mutagen.ts` `getStatus`, wrap the runner calls in try/catch and cap files (P3a already slices to 10 — confirm and keep):
```ts
export function getStatus(run: MutagenRunner, name: string): MutagenStatus {
  try {
    const r = run(["sync", "list", name, "--template", MUTAGEN_STATUS_TEMPLATE]);
    if (r.status !== 0) return { kind: "no_session" };
    const status = parseStatusLine(r.stdout);
    if (status.kind === "conflict") {
      const long = run(["sync", "list", name, "--long"]);
      return { kind: "conflict", files: extractConflictPaths(long.stdout || "").slice(0, 10) };
    }
    return status;
  } catch (e) {
    return { kind: "error", message: String(e) };
  }
}
```

- [ ] **Step 4: Run, verify pass + full CLI suite**

Run: `pnpm --filter @rebink/patchwire test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/config.ts packages/cli/src/lib/mutagen.ts packages/cli/test/config.test.ts packages/cli/test/mutagen.test.ts
git commit -m "fix(cli): harden config host/user (defense-in-depth); error-kind + conflict cap in getStatus"
```

---

### Task 2: `ProjectStatus` gains "conflict" + label (TDD)

**Files:**
- Modify: `packages/desktop/src/lib/types.ts`
- Modify: `packages/desktop/src/lib/model.ts`
- Modify: `packages/desktop/src/lib/model.test.ts`

> Read `model.ts` `projectStatusLabel` + `types.ts` `ProjectStatus` (from P1). Add a `"conflict"` member and its label.

- [ ] **Step 1: Add a failing test to `model.test.ts`**

```ts
it("projectStatusLabel maps conflict", () => {
  expect(projectStatusLabel("conflict")).toEqual({ text: "Conflict", kind: "error" });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter patchwire-desktop test src/lib/model.test.ts`
Expected: FAIL (TS: `"conflict"` not assignable; or assertion fails).

- [ ] **Step 3: Implement**

In `types.ts`: `export type ProjectStatus = "in-sync" | "working" | "paused" | "error" | "conflict" | "unknown";`
In `model.ts` `projectStatusLabel`, add a case before `default`:
```ts
case "conflict":
  return { text: "Conflict", kind: "error" };
```
(`parseProjects`'s `isStatus` guard must also accept `"conflict"` — add it there.)

- [ ] **Step 4: Run, verify pass (full suite)**

Run: `pnpm --filter patchwire-desktop test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/lib/types.ts packages/desktop/src/lib/model.ts packages/desktop/src/lib/model.test.ts
git commit -m "feat(desktop): add conflict ProjectStatus + label"
```

---

### Task 3: Sync event parsing + kind mapping (TS, pure, TDD)

**Files:**
- Create: `packages/desktop/src/lib/sync-events.ts`
- Test: `packages/desktop/src/lib/sync-events.test.ts`

- [ ] **Step 1: Write the failing test `src/lib/sync-events.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseSyncLine, syncKindToProjectStatus } from "./sync-events";

describe("parseSyncLine", () => {
  it("parses a sync_status line", () => {
    expect(parseSyncLine('{"type":"sync_status","kind":"watching","conflicts":[]}'))
      .toEqual({ type: "status", status: { kind: "watching", conflicts: [] } });
  });
  it("parses a conflict status with files", () => {
    expect(parseSyncLine('{"type":"sync_status","kind":"conflict","conflicts":["a.ts"]}'))
      .toEqual({ type: "status", status: { kind: "conflict", conflicts: ["a.ts"] } });
  });
  it("parses a sync_action line", () => {
    expect(parseSyncLine('{"type":"sync_action","action":"pause","ok":true}'))
      .toEqual({ type: "action", action: "pause", ok: true });
  });
  it("returns null for blank / non-JSON / unknown type", () => {
    expect(parseSyncLine("")).toBeNull();
    expect(parseSyncLine("nope")).toBeNull();
    expect(parseSyncLine('{"type":"other"}')).toBeNull();
  });
  it("defaults conflicts to [] when absent", () => {
    expect(parseSyncLine('{"type":"sync_status","kind":"paused"}'))
      .toEqual({ type: "status", status: { kind: "paused", conflicts: [] } });
  });
});

describe("syncKindToProjectStatus", () => {
  it("maps kinds to ProjectStatus", () => {
    expect(syncKindToProjectStatus("watching")).toBe("in-sync");
    expect(syncKindToProjectStatus("syncing")).toBe("working");
    expect(syncKindToProjectStatus("connecting")).toBe("working");
    expect(syncKindToProjectStatus("paused")).toBe("paused");
    expect(syncKindToProjectStatus("conflict")).toBe("conflict");
    expect(syncKindToProjectStatus("error")).toBe("error");
    expect(syncKindToProjectStatus("not_installed")).toBe("unknown");
    expect(syncKindToProjectStatus("no_session")).toBe("unknown");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter patchwire-desktop test src/lib/sync-events.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `src/lib/sync-events.ts`**

```ts
import type { ProjectStatus } from "./types";

export type SyncKind =
  | "not_installed" | "no_session" | "connecting" | "watching"
  | "syncing" | "conflict" | "paused" | "error";

export interface SyncStatus { kind: SyncKind; conflicts: string[] }

export type SyncLine =
  | { type: "status"; status: SyncStatus }
  | { type: "action"; action: string; ok: boolean };

const KINDS = new Set<SyncKind>([
  "not_installed", "no_session", "connecting", "watching",
  "syncing", "conflict", "paused", "error",
]);

export function parseSyncLine(line: string): SyncLine | null {
  const t = line.trim();
  if (!t) return null;
  let o: any;
  try { o = JSON.parse(t); } catch { return null; }
  if (!o || typeof o !== "object") return null;
  if (o.type === "sync_status" && typeof o.kind === "string" && KINDS.has(o.kind)) {
    return { type: "status", status: { kind: o.kind, conflicts: Array.isArray(o.conflicts) ? o.conflicts : [] } };
  }
  if (o.type === "sync_action" && typeof o.action === "string") {
    return { type: "action", action: o.action, ok: o.ok === true };
  }
  return null;
}

export function syncKindToProjectStatus(kind: SyncKind): ProjectStatus {
  switch (kind) {
    case "watching": return "in-sync";
    case "syncing":
    case "connecting": return "working";
    case "paused": return "paused";
    case "conflict": return "conflict";
    case "error": return "error";
    default: return "unknown"; // not_installed, no_session
  }
}
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter patchwire-desktop test src/lib/sync-events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/lib/sync-events.ts packages/desktop/src/lib/sync-events.test.ts
git commit -m "feat(desktop): sync event parser + kind-to-ProjectStatus mapping"
```

---

### Task 4: Rust sync supervision commands

**Files:**
- Modify: `packages/desktop/src-tauri/src/lib.rs`

> Mirror the P2 `start_chat`/`apply_patch` patterns exactly. Read the existing `start_chat` (streaming, busy guard, `current_dir`, `pw://chat`/`pw://chat-end`) and `host_health` (one-shot `.output()`). No Rust unit tests (repo convention); verified by compile + the P3b live run.

- [ ] **Step 1: Add `SyncWatchState` + register it**

```rust
#[derive(Default)]
struct SyncWatchState {
    busy: std::sync::atomic::AtomicBool,
    child: std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
}
```
Add `.manage(SyncWatchState::default())` in the builder.

- [ ] **Step 2: Add `start_sync_watch` (streaming)** — identical shape to `start_chat` but command `["sync-watch", "--json"]`, events `pw://sync` / `pw://sync-end`:

```rust
#[tauri::command]
async fn start_sync_watch(
    app: tauri::AppHandle,
    state: tauri::State<'_, SyncWatchState>,
    project_dir: String,
) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    use tauri_plugin_shell::ShellExt;
    use tauri_plugin_shell::process::CommandEvent;
    use tauri::Emitter;

    if project_dir.trim().is_empty() { return Err("project_dir is required".into()); }
    if !std::path::Path::new(&project_dir).is_dir() { return Err("project_dir does not exist".into()); }

    let sidecar = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?;
    if state.busy.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return Err("a sync watch is already running".into());
    }
    let (mut rx, child) = match sidecar
        .current_dir(std::path::PathBuf::from(&project_dir))
        .args(["sync-watch", "--json"])
        .spawn()
    {
        Ok(v) => v,
        Err(e) => { state.busy.store(false, Ordering::SeqCst); return Err(e.to_string()); }
    };
    *state.child.lock().unwrap() = Some(child);
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).trim_end().to_string();
                    if !line.is_empty() { let _ = app.emit("pw://sync", line); }
                }
                CommandEvent::Terminated(p) => {
                    if let Some(st) = app.try_state::<SyncWatchState>() {
                        *st.child.lock().unwrap() = None;
                        st.busy.store(false, Ordering::SeqCst);
                    }
                    let _ = app.emit("pw://sync-end", p.code);
                }
                _ => {}
            }
        }
    });
    Ok(())
}
```

- [ ] **Step 3: Add `stop_sync_watch`**

```rust
#[tauri::command]
fn stop_sync_watch(state: tauri::State<'_, SyncWatchState>) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    if let Some(child) = state.child.lock().unwrap().take() { let _ = child.kill(); }
    state.busy.store(false, Ordering::SeqCst);
    Ok(())
}
```

- [ ] **Step 4: Add `sync_command` (one-shot)** — runs `sync-<sub> --json`, returns the last non-empty stdout line. Validate `sub` against an allowlist (no arbitrary command injection into argv):

```rust
#[tauri::command]
async fn sync_command(
    app: tauri::AppHandle,
    project_dir: String,
    sub: String,
) -> Result<String, String> {
    use tauri_plugin_shell::ShellExt;
    if project_dir.trim().is_empty() { return Err("project_dir is required".into()); }
    if !std::path::Path::new(&project_dir).is_dir() { return Err("project_dir does not exist".into()); }
    let allowed = ["status", "start", "pause", "resume", "flush", "stop"];
    if !allowed.contains(&sub.as_str()) { return Err(format!("invalid sync sub-command: {sub}")); }

    let sidecar = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?;
    let cmd = format!("sync-{sub}");
    let output = sidecar
        .current_dir(std::path::PathBuf::from(&project_dir))
        .args([cmd.as_str(), "--json"])
        .output()
        .await
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").to_string();
    if line.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("sync-{sub} produced no result: {stderr}"));
    }
    Ok(line)
}
```

- [ ] **Step 5: Register in `generate_handler!`** — append `start_sync_watch, stop_sync_watch, sync_command` (keep all P1/P2 commands). The full list becomes the prior 15 + these 3 = 18.

- [ ] **Step 6: Verify compiles**

Run (Rust toolchain on PATH: `export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH"`, then `pnpm stage-sidecar`): `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles. If no toolchain, report DONE_WITH_CONCERNS.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): rust start_sync_watch/stop_sync_watch/sync_command"
```

---

### Task 5: IPC wrappers for sync (TDD)

**Files:**
- Modify: `packages/desktop/src/lib/ipc.ts`
- Modify: `packages/desktop/src/lib/ipc.test.ts`

> Mirror the P2 chat IPC (invoke + `listen` via `@tauri-apps/api/event`). Reuse the existing `listenMock` (vi.hoisted) in the test file.

- [ ] **Step 1: Add failing tests to `src/lib/ipc.test.ts`**

```ts
import { syncCommand, startSyncWatch, stopSyncWatch, onSyncEvent } from "./ipc";

describe("syncCommand", () => {
  it("invokes sync_command and parses a status line", async () => {
    invokeMock.mockResolvedValue('{"type":"sync_status","kind":"watching","conflicts":[]}');
    const r = await syncCommand("/p", "status");
    expect(invokeMock).toHaveBeenCalledWith("sync_command", { projectDir: "/p", sub: "status" });
    expect(r).toEqual({ type: "status", status: { kind: "watching", conflicts: [] } });
  });
});
describe("startSyncWatch / stopSyncWatch", () => {
  it("invoke the right commands", async () => {
    invokeMock.mockResolvedValue(undefined);
    await startSyncWatch("/p");
    expect(invokeMock).toHaveBeenCalledWith("start_sync_watch", { projectDir: "/p" });
    await stopSyncWatch();
    expect(invokeMock).toHaveBeenCalledWith("stop_sync_watch");
  });
});
describe("onSyncEvent", () => {
  it("subscribes to pw://sync and forwards parsed status events", async () => {
    let cb: ((e: { payload: string }) => void) | null = null;
    listenMock.mockImplementation((name: string, fn: any) => { if (name === "pw://sync") cb = fn; return Promise.resolve(() => {}); });
    const seen: unknown[] = [];
    await onSyncEvent((l) => seen.push(l));
    expect(listenMock).toHaveBeenCalledWith("pw://sync", expect.any(Function));
    cb!({ payload: '{"type":"sync_status","kind":"syncing","conflicts":[]}' });
    cb!({ payload: "garbage" });
    expect(seen).toEqual([{ type: "status", status: { kind: "syncing", conflicts: [] } }]);
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter patchwire-desktop test src/lib/ipc.test.ts`
Expected: FAIL — new exports missing.

- [ ] **Step 3: Add to `src/lib/ipc.ts`**

```ts
import { parseSyncLine, type SyncLine } from "./sync-events";

export async function syncCommand(projectDir: string, sub: "status" | "start" | "pause" | "resume" | "flush" | "stop"): Promise<SyncLine | null> {
  const line = await invoke<string>("sync_command", { projectDir, sub });
  return parseSyncLine(line);
}
export async function startSyncWatch(projectDir: string): Promise<void> {
  await invoke("start_sync_watch", { projectDir });
}
export async function stopSyncWatch(): Promise<void> {
  await invoke("stop_sync_watch");
}
export async function onSyncEvent(handler: (line: SyncLine) => void): Promise<UnlistenFn> {
  return listen<string>("pw://sync", (e) => {
    const l = parseSyncLine(e.payload);
    if (l) handler(l);
  });
}
```

- [ ] **Step 4: Run, verify pass (full suite)**

Run: `pnpm --filter patchwire-desktop test`
Expected: all green (existing ipc tests + new).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/lib/ipc.ts packages/desktop/src/lib/ipc.test.ts
git commit -m "feat(desktop): IPC wrappers for sync watch + one-shot sync commands"
```

---

### Task 6: SyncPill component (TDD)

**Files:**
- Create: `packages/desktop/src/components/SyncPill.svelte`
- Test: `packages/desktop/src/components/SyncPill.test.ts`

- [ ] **Step 1: Write the failing test `src/components/SyncPill.test.ts`**

```ts
import { render } from "@testing-library/svelte";
import { describe, it, expect } from "vitest";
import SyncPill from "./SyncPill.svelte";

describe("SyncPill", () => {
  it("shows In sync for watching", () => {
    const { getByTestId } = render(SyncPill, { props: { status: { kind: "watching", conflicts: [] } } });
    expect(getByTestId("sync-pill").textContent).toContain("In sync");
  });
  it("shows Syncing for syncing", () => {
    const { getByTestId } = render(SyncPill, { props: { status: { kind: "syncing", conflicts: [] } } });
    expect(getByTestId("sync-pill").textContent).toContain("Syncing");
  });
  it("shows conflict count", () => {
    const { getByTestId } = render(SyncPill, { props: { status: { kind: "conflict", conflicts: ["a", "b"] } } });
    expect(getByTestId("sync-pill").textContent).toContain("2");
    expect(getByTestId("sync-pill").textContent.toLowerCase()).toContain("conflict");
  });
  it("shows Paused", () => {
    const { getByTestId } = render(SyncPill, { props: { status: { kind: "paused", conflicts: [] } } });
    expect(getByTestId("sync-pill").textContent).toContain("Paused");
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter patchwire-desktop test src/components/SyncPill.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write `src/components/SyncPill.svelte`**

```svelte
<script lang="ts">
  import type { SyncStatus } from "../lib/sync-events";
  let { status }: { status: SyncStatus } = $props();

  const LABELS: Record<string, string> = {
    not_installed: "Sync unavailable",
    no_session: "Not syncing",
    connecting: "Connecting…",
    watching: "⇅ In sync",
    syncing: "⇅ Syncing…",
    paused: "⏸ Paused",
    error: "Sync error",
  };
  let text = $derived(
    status.kind === "conflict"
      ? `⚠ ${status.conflicts.length} conflict${status.conflicts.length === 1 ? "" : "s"}`
      : (LABELS[status.kind] ?? status.kind),
  );
  let cls = $derived(
    status.kind === "watching" ? "ok"
    : status.kind === "syncing" || status.kind === "connecting" ? "warn"
    : status.kind === "conflict" || status.kind === "error" ? "error"
    : "muted",
  );
</script>

<span class="pill {cls}" data-testid="sync-pill">{text}</span>

<style>
  .pill { font-size: 11px; padding: 3px 9px; border-radius: 20px; font-weight: 600; background: var(--surface-raised); }
  .pill.ok { background: var(--accent-bg); color: var(--ok); }
  .pill.warn { color: var(--warn); }
  .pill.error { color: var(--error); }
  .pill.muted { color: var(--text-muted); }
</style>
```

- [ ] **Step 4: Run, verify pass**

Run: `pnpm --filter patchwire-desktop test src/components/SyncPill.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/components/SyncPill.svelte packages/desktop/src/components/SyncPill.test.ts
git commit -m "feat(desktop): SyncPill status component"
```

---

### Task 7: Projects landing — real per-project status + connection health (TDD)

**Files:**
- Modify: `packages/desktop/src/screens/Projects.svelte`
- Modify: `packages/desktop/src/screens/Projects.test.ts`

> Read the current `Projects.svelte` (P1): it renders `ConnectionBar healthy={true}` + a `ProjectRow` per `$projects`. Change: on mount, (a) `checkHealth($connection)` → drive `ConnectionBar healthy`; (b) for each project, `syncCommand(p.localPath, "status")` → `syncKindToProjectStatus` → update that project's `lastStatus` in the `projects` store (the existing `ProjectRow` pill renders it). Do these best-effort (ignore failures → leave status unknown). Keep the existing render/empty/search behavior.

- [ ] **Step 1: Update `Projects.test.ts`**

Keep the P1 tests; add `@tauri-apps/api/event` listen mock (none needed here, but invoke mock drives `host_health`/`sync_command`). Add:
```ts
it("populates per-project sync status from sync_command on mount", async () => {
  // connection + one project already set in beforeEach
  invokeMock.mockImplementation((cmd: string, args: any) => {
    if (cmd === "host_health") return Promise.resolve('{"ok":true,"version":"0.4.0"}');
    if (cmd === "sync_command") return Promise.resolve('{"type":"sync_status","kind":"watching","conflicts":[]}');
    return Promise.resolve(undefined);
  });
  const { findAllByTestId } = render(Projects);
  const statuses = await findAllByTestId("row-status");
  expect(statuses[0].textContent).toContain("In sync");
});
```
(Adapt to the test's existing `beforeEach` store setup. If `ProjectRow`'s status testid is `row-status`, assert on it.)

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter patchwire-desktop test src/screens/Projects.test.ts`
Expected: FAIL — status not populated (still the persisted/unknown value), or onMount logic absent.

- [ ] **Step 3: Update `Projects.svelte`**

Add an `onMount` that drives health + per-project status (read the file; integrate without breaking existing markup):
```svelte
<script lang="ts">
  import { onMount } from "svelte";
  import { connection, projects } from "../lib/stores";
  import { checkHealth, syncCommand } from "../lib/ipc";
  import { syncKindToProjectStatus } from "../lib/sync-events";
  import ConnectionBar from "../components/ConnectionBar.svelte";
  import ProjectRow from "../components/ProjectRow.svelte";
  import type { Project } from "../lib/types";

  let { onopen, onadd }: { onopen?: (p: Project) => void; onadd?: () => void } = $props();
  let query = $state("");
  let healthy = $state(true);

  let filtered = $derived($projects.filter((p) => p.name.toLowerCase().includes(query.toLowerCase())));

  onMount(async () => {
    const conn = $connection;
    if (conn) {
      try { healthy = (await checkHealth(conn)).ok; } catch { healthy = false; }
    }
    // best-effort per-project sync status
    for (const p of $projects) {
      try {
        const line = await syncCommand(p.localPath, "status");
        if (line && line.type === "status") {
          const next = syncKindToProjectStatus(line.status.kind);
          projects.update((list) => list.map((x) => (x.id === p.id ? { ...x, lastStatus: next } : x)));
        }
      } catch { /* leave unknown */ }
    }
  });
</script>

{#if $connection}
  <ConnectionBar connection={$connection} {healthy} />
{/if}
<!-- keep the rest of the P1 markup (bar, search, each ProjectRow, empty state) unchanged -->
```
(Preserve every existing element/testid from P1; only the script's `healthy` + onMount and the `ConnectionBar healthy={healthy}` binding change.)

- [ ] **Step 4: Run, verify pass (full suite)**

Run: `pnpm --filter patchwire-desktop test`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/screens/Projects.svelte packages/desktop/src/screens/Projects.test.ts
git commit -m "feat(desktop): live connection health + per-project sync status on the landing"
```

---

### Task 8: Workspace — live sync watch + pause/resume + conflicts (TDD)

**Files:**
- Modify: `packages/desktop/src/screens/Workspace.svelte`
- Modify: `packages/desktop/src/screens/Workspace.test.ts`

> Read the current `Workspace.svelte` (P2): owns ChatState, subscribes `onChatEvent`/`onChatEnd` on mount, header has `ws-title`/`ws-back`. Add: a `sync` $state (`SyncStatus`), subscribe `onSyncEvent` + start `startSyncWatch(project.localPath)` on mount, `stopSyncWatch()` on destroy; render a `SyncPill` + a Pause/Resume button + (when conflict) a conflict file list in the header. Pause/Resume call `syncCommand(localPath, "pause"|"resume")` and optimistically refresh via a follow-up `status`.

- [ ] **Step 1: Update `Workspace.test.ts`**

Keep P2 tests (they already mock `@tauri-apps/api/event` listen). Add:
```ts
it("starts a sync watch on mount and subscribes to pw://sync", () => {
  render(Workspace, { props: { project } });
  expect(invokeMock).toHaveBeenCalledWith("start_sync_watch", { projectDir: project.localPath });
  expect(listenMock).toHaveBeenCalledWith("pw://sync", expect.any(Function));
});
it("pause button issues sync_command pause", async () => {
  invokeMock.mockResolvedValue('{"type":"sync_action","action":"pause","ok":true}');
  const { getByTestId } = render(Workspace, { props: { project } });
  await fireEvent.click(getByTestId("sync-pause"));
  expect(invokeMock).toHaveBeenCalledWith("sync_command", { projectDir: project.localPath, sub: "pause" });
});
```
(Ensure `listenMock` resolves to an unlisten fn in `beforeEach`, as in P2.)

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter patchwire-desktop test src/screens/Workspace.test.ts`
Expected: FAIL — watch not started / button missing.

- [ ] **Step 3: Update `Workspace.svelte`**

Integrate into the existing component (read it first). Add to the script:
```ts
import { startSyncWatch, stopSyncWatch, onSyncEvent, syncCommand } from "../lib/ipc";
import SyncPill from "../components/SyncPill.svelte";
import type { SyncStatus } from "../lib/sync-events";

let sync = $state<SyncStatus>({ kind: "no_session", conflicts: [] });
let unlistenSync: UnlistenFn | null = null;

// inside onMount (after the existing chat subscriptions):
unlistenSync = await onSyncEvent((l) => { if (l.type === "status") sync = l.status; });
try { await startSyncWatch(project.localPath); } catch { /* surfaced via pill */ }

// inside onDestroy (alongside existing unlisten calls):
unlistenSync?.();
stopSyncWatch();

async function toggleSync() {
  const sub = sync.kind === "paused" ? "resume" : "pause";
  await syncCommand(project.localPath, sub);
  const line = await syncCommand(project.localPath, "status");
  if (line && line.type === "status") sync = line.status;
}
```
In the header markup, next to `ws-title`, add:
```svelte
<span class="ws-sync">
  <SyncPill status={sync} />
  <button class="ghost" data-testid="sync-pause" onclick={toggleSync}>
    {sync.kind === "paused" ? "Resume" : "Pause"}
  </button>
</span>
{#if sync.kind === "conflict" && sync.conflicts.length}
  <div class="conflicts" data-testid="sync-conflicts">
    Conflicts: {sync.conflicts.join(", ")}
  </div>
{/if}
```
(Add minimal styles using tokens; keep all existing P2 markup/testids intact.)

- [ ] **Step 4: Run, verify pass (full suite)**

Run: `pnpm --filter patchwire-desktop test`
Expected: all green.

- [ ] **Step 5: Manual end-to-end (best effort)**

With the Rust toolchain on PATH + a reachable, configured project: `pnpm stage-sidecar && pnpm tauri dev`. Verify: opening a project starts a sync session + the header pill goes In sync; editing files locally shows Syncing then In sync; Pause/Resume toggles; a forced conflict surfaces in the header; the landing shows per-project status. Document any step not verifiable here (no mutagen/agent) — don't fake.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/screens/Workspace.svelte packages/desktop/src/screens/Workspace.test.ts
git commit -m "feat(desktop): live sync watch + pause/resume + conflict surfacing in Workspace"
```

---

## Self-Review

**Spec coverage (P3b portions):**
- Supervised per-project sync (live watch in the open workspace) → Tasks 4, 5, 8. ✓
- Status pills (landing per-project + workspace header) → Tasks 2, 3, 6, 7, 8. ✓
- Pause/resume → Tasks 4, 5, 8. ✓
- Conflict surfacing → Tasks 2, 3, 6, 8. ✓
- Replaces the hardcoded `healthy={true}` with real connection health → Task 7. ✓
- P3a/P2 fast-follows: ConfigSchema host/user regex (security defense-in-depth), conflict cap, error-kind → Task 1. ✓
- Out of scope: continuous watch of ALL landing projects (landing uses cheap one-shot status; the mutagen daemon syncs in the background regardless); first-run session auto-start on connect (the workspace open starts the watch which `ensureSession`-creates); setup wizard (P4). The `loadMutagenTarget` unit test fast-follow is deferred (cli.ts-level wiring, untested by repo convention) — noted, not blocking.

**Placeholder scan:** No TBD/TODO. Tasks 1, 7, 8 instruct reading the target file before modifying (config.ts shape, the P1 Projects markup, the P2 Workspace) and give the exact script/markup deltas — the surrounding code to preserve is the committed P1/P2 code, not re-quoted here.

**Type consistency:** `SyncKind`/`SyncStatus`/`SyncLine` defined once in `sync-events.ts`, consumed by ipc.ts, SyncPill, Projects, Workspace. `ProjectStatus` extended with `"conflict"` in types.ts (Task 2) and handled in `projectStatusLabel` + `parseProjects` guard + `syncKindToProjectStatus`. IPC command names (`start_sync_watch`/`stop_sync_watch`/`sync_command`) match Rust (Task 4), TS (Task 5), and component tests (Tasks 7, 8). Event channel `pw://sync` matches Rust emit (Task 4) and `onSyncEvent` (Task 5). The `sync_command` `sub` allowlist matches the P3a flat command names.

## Follow-on
- **P4:** in-app setup wizard (so newly added folders get a `patchwire.yml` + provisioned agent); Settings.
- Deferred P3 fast-follows: `loadMutagenTarget` unit test; port the extension's reattach/recreate-on-wedged-session into the CLI `ensureSession`.
- Landing currently polls status once on mount; a manual "refresh" affordance or a light interval could come later if needed.
- **Live mutagen validation** (real binary + reachable remote) remains the key untested milestone before shipping a public build.
