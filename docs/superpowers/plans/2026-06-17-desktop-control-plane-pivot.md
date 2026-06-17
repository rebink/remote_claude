# Desktop Control-Plane Pivot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the desktop's bespoke chat with a control-plane model: an "Open claude session" button launches the user's own terminal (cross-OS) running the real `claude` REPL on the remote; attachments copy a remote path to the clipboard; a read-only git-status list shows synced changes.

**Architecture:** A pure `buildSessionShellCommand` in `@patchwire/core` builds the `ssh … 'cd … && exec zsh -lic claude'` string (POSIX-escaped). A cross-OS Rust `open_terminal` launches it in the native terminal. The desktop loses all `/chat` streaming + diff/apply; the Workspace becomes launcher (left) + attachments & changes (right).

**Tech Stack:** TypeScript (core + desktop) + Svelte 5 runes + vitest, Rust + Tauri 2 (`portable-pty` NOT used). Spec: `docs/superpowers/specs/2026-06-17-desktop-control-plane-pivot-design.md`.

**Refinement vs spec:** the spec said "move `buildRemoteCommand` to core". We instead add a self-contained `buildSessionShellCommand` (minimal remote command, no double-quoted banner) so the launched shell-string has no double quotes (osascript/bash safe) and the extension is left untouched. Same goal, fewer moving parts.

---

## File Structure

**New:**
- `packages/core/src/session-command.ts` — `SessionTarget`, `buildSessionShellCommand` (+ `shSingleQuote`).
- `packages/core/src/session-command.test.ts`.
- `packages/desktop/src/lib/git-status.ts` + `.test.ts` — porcelain parser.
- `packages/desktop/src/lib/session.ts` + `.test.ts` — `buildLaunchCommand(connection, project, skipPermissions)`.
- `packages/desktop/src/components/SessionLauncher.svelte` + `.test.ts`.
- `packages/desktop/src/components/AttachPanel.svelte` + `.test.ts`.
- `packages/desktop/src/components/ChangesList.svelte` + `.test.ts`.

**Modified:**
- `packages/core/package.json` — add `"./session-command"` export.
- `packages/desktop/src-tauri/src/lib.rs` — cross-OS `open_terminal`; new `git_status`; remove `start_chat`/`cancel_chat`/`apply_patch` + `ChatState`; register clipboard plugin + `git_status`.
- `packages/desktop/src-tauri/Cargo.toml` — `tauri-plugin-clipboard-manager`.
- `packages/desktop/src-tauri/capabilities/default.json` — clipboard write permission.
- `packages/desktop/package.json` — `@tauri-apps/plugin-clipboard-manager`.
- `packages/desktop/src/lib/ipc.ts` — add `copyToClipboard`, `gitStatus`; remove chat ipc.
- `packages/desktop/src/screens/Workspace.svelte` + `.test.ts` — re-layout, drop chat.

**Deleted:**
- `packages/desktop/src/components/ChatPane.svelte` (+ `.test.ts`)
- `packages/desktop/src/components/ChangesPanel.svelte` (+ `.test.ts`)
- `packages/desktop/src/lib/chat-session.ts` (+ `.test.ts`)
- `packages/desktop/src/lib/chat-events.ts` (+ `.test.ts`)

**Test commands:** `pnpm --filter @patchwire/core test`, `pnpm --filter patchwire-desktop test`. Rust: `cd packages/desktop && pnpm stage-sidecar && cd src-tauri && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo build`. Desktop `tsc` has pre-existing unrelated test-fixture errors — ignore those.

---

## Task 1: core `buildSessionShellCommand`

**Files:**
- Create: `packages/core/src/session-command.ts`, `packages/core/src/session-command.test.ts`
- Modify: `packages/core/package.json`

- [ ] **Step 1: Write the test**

```ts
// packages/core/src/session-command.test.ts
import { describe, it, expect } from 'vitest';
import { buildSessionShellCommand } from './session-command.ts';

const target = { project: 'app', host: '100.64.0.1', user: 'Admin', sshPort: 22, remotePath: '~/patchwire/box/app' };

describe('buildSessionShellCommand', () => {
  it('builds an ssh command running claude in a login interactive shell', () => {
    const cmd = buildSessionShellCommand(target, '/keys/k', false);
    expect(cmd).toBe(
      `ssh -tt -i '/keys/k' -p 22 -o StrictHostKeyChecking=accept-new Admin@100.64.0.1 'cd ~/patchwire/box/app && exec zsh -lic '\\''claude'\\'''`,
    );
  });
  it('adds --dangerously-skip-permissions when requested', () => {
    expect(buildSessionShellCommand(target, '/k', true)).toContain("claude --dangerously-skip-permissions");
  });
  it('contains no double quotes (osascript/shell safe)', () => {
    expect(buildSessionShellCommand(target, '/k', false).includes('"')).toBe(false);
  });
  it('defaults the port to 22 when unset', () => {
    const { sshPort, ...noPort } = target;
    expect(buildSessionShellCommand(noPort, '/k', false)).toContain('-p 22 ');
  });
  it('escapes single quotes in the key path', () => {
    expect(buildSessionShellCommand(target, "/a'b", false)).toContain("-i '/a'\\''b'");
  });
});
```

- [ ] **Step 2: Run → FAIL** (`cd packages/core && pnpm vitest run src/session-command.test.ts`).

- [ ] **Step 3: Implement**

```ts
// packages/core/src/session-command.ts

export interface SessionTarget {
  project: string;
  host: string;
  user: string;
  sshPort?: number;
  remotePath: string;
}

/** POSIX single-quote a value so the local shell passes it through verbatim. */
function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the full shell command to launch a claude session: ssh into the remote
 * (with a TTY via -tt), cd into the synced project, and exec a login+interactive
 * shell running `claude`. The whole remote command is single-quote-escaped so the
 * launcher (osascript `do script` / `bash -lc`) and the `open_terminal` guard see
 * NO double quotes. `remotePath` stays inside the remote command so its leading
 * `~` expands on the remote. host/user are token-validated upstream.
 */
export function buildSessionShellCommand(
  target: SessionTarget,
  keyPath: string,
  skipPermissions = false,
): string {
  const claude = skipPermissions ? 'claude --dangerously-skip-permissions' : 'claude';
  const remote = `cd ${target.remotePath} && exec zsh -lic ${shSingleQuote(claude)}`;
  const port = target.sshPort ?? 22;
  return `ssh -tt -i ${shSingleQuote(keyPath)} -p ${port} -o StrictHostKeyChecking=accept-new ${target.user}@${target.host} ${shSingleQuote(remote)}`;
}
```

- [ ] **Step 4: Run → PASS** (5 tests).

- [ ] **Step 5: Add subpath export to `packages/core/package.json`**

Change `"exports"` to include the new entry (keep `.` and `./sync-templates`):
```json
"exports": {
  ".": "./src/index.ts",
  "./sync-templates": "./src/sync-templates.ts",
  "./session-command": "./src/session-command.ts"
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/session-command.ts packages/core/src/session-command.test.ts packages/core/package.json
git commit -m "feat(core): buildSessionShellCommand for launching a remote claude session"
```

---

## Task 2: desktop pure helpers — git-status parser + buildLaunchCommand

**Files:**
- Create: `packages/desktop/src/lib/git-status.ts` (+ `.test.ts`), `packages/desktop/src/lib/session.ts` (+ `.test.ts`)

- [ ] **Step 1: Write `git-status.test.ts`**

```ts
// packages/desktop/src/lib/git-status.test.ts
import { describe, it, expect } from "vitest";
import { parseGitStatus } from "./git-status";

describe("parseGitStatus", () => {
  it("parses modified, added, untracked entries", () => {
    const out = " M lib/main.dart\nA  lib/new.dart\n?? notes.txt\n";
    expect(parseGitStatus(out)).toEqual([
      { status: "M", path: "lib/main.dart" },
      { status: "A", path: "lib/new.dart" },
      { status: "??", path: "notes.txt" },
    ]);
  });
  it("handles renames (R old -> new) keeping the new path", () => {
    expect(parseGitStatus("R  a.txt -> b.txt\n")).toEqual([{ status: "R", path: "b.txt" }]);
  });
  it("returns [] for empty/whitespace", () => {
    expect(parseGitStatus("")).toEqual([]);
    expect(parseGitStatus("\n  \n")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run → FAIL** (`cd packages/desktop && pnpm vitest run src/lib/git-status.test.ts`).

- [ ] **Step 3: Implement `git-status.ts`**

```ts
// packages/desktop/src/lib/git-status.ts
export interface ChangedEntry {
  status: string;
  path: string;
}

/** Parse `git status --porcelain` output into entries. Trims the 2-char XY code;
 *  for renames (`R  old -> new`) keeps the new path. */
export function parseGitStatus(stdout: string): ChangedEntry[] {
  const out: ChangedEntry[] = [];
  for (const raw of stdout.split("\n")) {
    if (!raw.trim()) continue;
    const code = raw.slice(0, 2).trim();
    let rest = raw.slice(3);
    const arrow = rest.indexOf(" -> ");
    if (arrow !== -1) rest = rest.slice(arrow + 4);
    out.push({ status: code, path: rest.trim() });
  }
  return out;
}
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Write `session.test.ts`**

```ts
// packages/desktop/src/lib/session.test.ts
import { describe, it, expect } from "vitest";
import { buildLaunchCommand } from "./session";

const conn = { id: "c1", name: "mini", host: "100.64.0.1", user: "Admin", sshPort: 22, keyPath: "/keys/k", agentPort: 7878, token: "T" };
const project = { id: "p1", name: "app", branch: "main", localPath: "/l/app", remotePath: "~/patchwire/box/app", host: "100.64.0.1", user: "Admin", lastStatus: "in-sync" as const, syncPaused: false, connectionId: "c1" };

describe("buildLaunchCommand", () => {
  it("assembles an ssh+claude command from a connection + project", () => {
    const cmd = buildLaunchCommand(conn, project, false);
    expect(cmd).toContain("ssh -tt -i '/keys/k' -p 22");
    expect(cmd).toContain("Admin@100.64.0.1");
    expect(cmd).toContain("cd ~/patchwire/box/app && exec zsh -lic");
  });
  it("threads the skip-permissions flag", () => {
    expect(buildLaunchCommand(conn, project, true)).toContain("--dangerously-skip-permissions");
  });
});
```

- [ ] **Step 6: Run → FAIL** then implement `session.ts`:

```ts
// packages/desktop/src/lib/session.ts
import { buildSessionShellCommand } from "@patchwire/core/session-command";
import type { Connection, Project } from "./types";

/** Build the terminal launch command for a project's claude session. */
export function buildLaunchCommand(connection: Connection, project: Project, skipPermissions: boolean): string {
  return buildSessionShellCommand(
    {
      project: project.name,
      host: connection.host,
      user: connection.user,
      sshPort: connection.sshPort,
      remotePath: project.remotePath,
    },
    connection.keyPath,
    skipPermissions,
  );
}
```

- [ ] **Step 7: Run → PASS;** then commit:

```bash
git add packages/desktop/src/lib/git-status.ts packages/desktop/src/lib/git-status.test.ts packages/desktop/src/lib/session.ts packages/desktop/src/lib/session.test.ts
git commit -m "feat(desktop): git-status parser + buildLaunchCommand"
```

---

## Task 3: Rust — cross-OS open_terminal, git_status, clipboard plugin, remove chat

**Files:**
- Modify: `packages/desktop/src-tauri/src/lib.rs`, `Cargo.toml`, `capabilities/default.json`

Read `lib.rs` first: `open_terminal` (~859), `start_chat`/`cancel_chat`/`apply_patch`, the `ChatState` `.manage(...)`, and the `generate_handler!` list.

- [ ] **Step 1: Add the clipboard plugin dep**

In `packages/desktop/src-tauri/Cargo.toml` `[dependencies]`, add:
```toml
tauri-plugin-clipboard-manager = "2"
```

- [ ] **Step 2: Replace `open_terminal` with a cross-OS version**

```rust
// Launch the user's native terminal running `command`. Cross-OS. The command is
// built by us (buildSessionShellCommand) and contains no double quotes/newlines.
#[tauri::command]
fn open_terminal(command: String) -> Result<(), String> {
    if command.contains('"') || command.contains('\n') || command.contains('\r') {
        return Err("invalid command".into());
    }
    #[cfg(target_os = "macos")]
    {
        let script = format!("tell application \"Terminal\" to do script \"{command}\"");
        let out = std::process::Command::new("osascript").args(["-e", &script]).output().map_err(|e| e.to_string())?;
        if !out.status.success() { return Err(String::from_utf8_lossy(&out.stderr).to_string()); }
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        let inner = format!("{command}; exec bash");
        let candidates: [(&str, Vec<String>); 4] = [
            ("x-terminal-emulator", vec!["-e".into(), "bash".into(), "-lc".into(), inner.clone()]),
            ("gnome-terminal", vec!["--".into(), "bash".into(), "-lc".into(), inner.clone()]),
            ("konsole", vec!["-e".into(), "bash".into(), "-lc".into(), inner.clone()]),
            ("xterm", vec!["-e".into(), "bash".into(), "-lc".into(), inner.clone()]),
        ];
        for (prog, args) in candidates.iter() {
            if std::process::Command::new(prog).args(args).spawn().is_ok() {
                return Ok(());
            }
        }
        return Err("no supported terminal emulator found".into());
    }
    #[cfg(target_os = "windows")]
    {
        if std::process::Command::new("wt.exe").args(["cmd", "/k", &command]).spawn().is_ok() {
            return Ok(());
        }
        std::process::Command::new("cmd").args(["/c", "start", "cmd", "/k", &command]).spawn().map_err(|e| e.to_string())?;
        return Ok(());
    }
    #[allow(unreachable_code)]
    Err("unsupported platform".into())
}
```
(If a platform branch warns about unused `command`, that's acceptable. Ensure it compiles on macOS — the target here.)

- [ ] **Step 3: Add `git_status`**

```rust
// `git status --porcelain` for the project; parser lives on the TS side.
#[tauri::command]
fn git_status(project_dir: String) -> Result<String, String> {
    if !std::path::Path::new(&project_dir).is_dir() {
        return Err("project_dir does not exist".into());
    }
    let out = std::process::Command::new("git")
        .args(["-C", &project_dir, "status", "--porcelain"])
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}
```

- [ ] **Step 4: Remove chat commands + ChatState**

Delete the `#[tauri::command]` functions `start_chat`, `cancel_chat`, and `apply_patch` entirely. Delete the `ChatState` struct/impl and its `.manage(ChatState::default())` line in `run()`. Remove `start_chat, cancel_chat, apply_patch` from the `generate_handler!` list. (Leave `push_attachment`, `start_sync_watch`, `stop_sync_watch`, `sync_command`, etc.)

- [ ] **Step 5: Register the clipboard plugin + git_status**

In `run()`'s builder chain, add the plugin next to the others:
```rust
        .plugin(tauri_plugin_clipboard_manager::init())
```
In `generate_handler![ ... ]`, add `git_status,` and remove the three chat entries.

- [ ] **Step 6: Clipboard capability**

In `packages/desktop/src-tauri/capabilities/default.json`, add to the `"permissions"` array:
```json
    "clipboard-manager:allow-write-text"
```

- [ ] **Step 7: Build**

```
cd /Users/apple/Documents/Workspace/patchwire/packages/desktop && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" pnpm stage-sidecar
cd src-tauri && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo build 2>&1 | tail -20
```
Expected: `Finished`. (Cargo fetches `tauri-plugin-clipboard-manager`.)

- [ ] **Step 8: Commit**

```bash
git add packages/desktop/src-tauri/src/lib.rs packages/desktop/src-tauri/Cargo.toml packages/desktop/src-tauri/Cargo.lock packages/desktop/src-tauri/capabilities/default.json
git commit -m "feat(desktop): cross-OS open_terminal + git_status + clipboard plugin; remove chat commands"
```

---

## Task 4: ipc.ts — clipboard + gitStatus, remove chat ipc

**Files:**
- Modify: `packages/desktop/src/lib/ipc.ts`, `packages/desktop/package.json`

- [ ] **Step 1: Add the clipboard npm dep**

Run: `cd /Users/apple/Documents/Workspace/patchwire/packages/desktop && pnpm add @tauri-apps/plugin-clipboard-manager`

- [ ] **Step 2: Edit `ipc.ts`**

Remove these functions: `startChat`, `cancelChat`, `applyPatch`, `onChatEvent`, `onChatEnd`. Remove now-unused imports they relied on (`parseChatLine`/`ChatEvent` from `./chat-events`, `parseApplyResult`/`ApplyResult` from `./chat-session`). Keep `pushAttachment` and everything else.

Add at the top with other imports:
```ts
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { parseGitStatus, type ChangedEntry } from "./git-status";
```
Add these functions (near `pushAttachment`):
```ts
export async function copyToClipboard(text: string): Promise<void> {
  await writeText(text);
}

export async function gitStatus(projectDir: string): Promise<ChangedEntry[]> {
  const out = await invoke<string>("git_status", { projectDir });
  return parseGitStatus(out);
}
```
Also remove the `onChatEnd` listener for `pw://chat-end` and the `onChatEvent` listener for `pw://chat` (they're inside the deleted functions).

- [ ] **Step 3: Typecheck**

Run: `cd /Users/apple/Documents/Workspace/patchwire/packages/desktop && pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E 'lib/ipc\.ts' || echo "ipc.ts clean"`
Expected: `ipc.ts clean`. (Other files that still import the removed funcs — Workspace, ipc.test — are fixed in later tasks/this task's deletions; their errors are expected until Task 5/6. Focus only on ipc.ts here.)

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/lib/ipc.ts packages/desktop/package.json pnpm-lock.yaml
git commit -m "feat(desktop): ipc copyToClipboard + gitStatus; remove chat ipc"
```

---

## Task 5: Components — SessionLauncher, AttachPanel, ChangesList; delete chat components

**Files:**
- Create: `SessionLauncher.svelte` (+test), `AttachPanel.svelte` (+test), `ChangesList.svelte` (+test) under `packages/desktop/src/components/`
- Delete: `ChatPane.svelte`(+test), `ChangesPanel.svelte`(+test), `lib/chat-session.ts`(+test), `lib/chat-events.ts`(+test)

- [ ] **Step 1: Write `SessionLauncher.test.ts`**

```ts
// packages/desktop/src/components/SessionLauncher.test.ts
import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
import SessionLauncher from "./SessionLauncher.svelte";

const conn = { id: "c1", name: "mini", host: "100.64.0.1", user: "Admin", sshPort: 22, keyPath: "/k", agentPort: 7878, token: "T" };
const project = { id: "p1", name: "app", branch: "main", localPath: "/l/app", remotePath: "~/p/app", host: "100.64.0.1", user: "Admin", lastStatus: "in-sync" as const, syncPaused: false, connectionId: "c1" };

beforeEach(() => invokeMock.mockReset());

describe("SessionLauncher", () => {
  it("launches the terminal with an ssh+claude command on click", async () => {
    invokeMock.mockResolvedValue(undefined);
    const { getByTestId } = render(SessionLauncher, { props: { connection: conn, project } });
    await fireEvent.click(getByTestId("open-session"));
    const call = invokeMock.mock.calls.find((c) => c[0] === "open_terminal");
    expect(call).toBeTruthy();
    expect((call![1] as { command: string }).command).toContain("ssh -tt -i '/k'");
    expect((call![1] as { command: string }).command).not.toContain("--dangerously-skip-permissions");
  });

  it("includes the skip-permissions flag when the checkbox is on", async () => {
    invokeMock.mockResolvedValue(undefined);
    const { getByTestId } = render(SessionLauncher, { props: { connection: conn, project } });
    await fireEvent.click(getByTestId("skip-perms"));
    await fireEvent.click(getByTestId("open-session"));
    const call = invokeMock.mock.calls.find((c) => c[0] === "open_terminal");
    expect((call![1] as { command: string }).command).toContain("--dangerously-skip-permissions");
  });

  it("disables the button when no connection is resolved", () => {
    const { getByTestId } = render(SessionLauncher, { props: { connection: undefined, project } });
    expect((getByTestId("open-session") as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL;** implement `SessionLauncher.svelte`:

```svelte
<!-- packages/desktop/src/components/SessionLauncher.svelte -->
<script lang="ts">
  import type { Connection, Project } from "../lib/types";
  import { buildLaunchCommand } from "../lib/session";
  import { openTerminal } from "../lib/ipc";

  let { connection, project }: { connection: Connection | undefined; project: Project } = $props();
  let skipPerms = $state(false);
  let error = $state("");

  async function open() {
    if (!connection) return;
    error = "";
    try {
      await openTerminal(buildLaunchCommand(connection, project, skipPerms));
    } catch (e) {
      error = `Could not open terminal: ${e}`;
    }
  }
</script>

<div class="launcher">
  <h2>Claude session</h2>
  <p class="hint">
    Opens your terminal and runs <code>claude</code> on the remote against this project.
    Edits sync back automatically — review them under “Changes”.
  </p>
  {#if !connection}
    <p class="warn" data-testid="no-conn">No connection found for this project.</p>
  {/if}
  <label class="skip"><input type="checkbox" data-testid="skip-perms" bind:checked={skipPerms} /> Skip permission prompts (<code>--dangerously-skip-permissions</code>)</label>
  <button class="primary" data-testid="open-session" disabled={!connection} onclick={open}>Open claude session</button>
  {#if error}<p class="err" data-testid="launch-error">{error}</p>{/if}
</div>

<style>
  .launcher { padding: 24px; display: flex; flex-direction: column; gap: 14px; max-width: 460px; margin: 0 auto; }
  h2 { font-size: 16px; }
  .hint { color: var(--text-muted); font-size: 13px; line-height: 1.5; }
  .skip { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--text-muted); }
  .primary { background: var(--accent-strong); color: #fff; padding: 10px; font-weight: 600; align-self: flex-start; }
  .primary:disabled { opacity: .5; cursor: not-allowed; }
  .warn { color: var(--warn); font-size: 12px; }
  .err { color: var(--error); font-size: 12px; }
  code { background: var(--surface-base); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 1px 5px; }
</style>
```

- [ ] **Step 3: Run → PASS (3 tests).**

- [ ] **Step 4: Write `AttachPanel.test.ts`**

```ts
// packages/desktop/src/components/AttachPanel.test.ts
import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
const invokeMock = vi.hoisted(() => vi.fn());
const openMock = vi.hoisted(() => vi.fn());
const writeTextMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openMock }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: writeTextMock }));
import AttachPanel from "./AttachPanel.svelte";

beforeEach(() => { invokeMock.mockReset(); openMock.mockReset(); writeTextMock.mockReset(); });

describe("AttachPanel", () => {
  it("uploads a picked file and copies the remote path to the clipboard", async () => {
    openMock.mockResolvedValue("/l/app/img.png");
    invokeMock.mockImplementation((cmd: string) => cmd === "push_attachment" ? Promise.resolve("~/p/app/.patchwire-inbox/img.png") : Promise.resolve(undefined));
    writeTextMock.mockResolvedValue(undefined);
    const { getByTestId } = render(AttachPanel, { props: { projectDir: "/l/app" } });
    await fireEvent.click(getByTestId("attach-file"));
    for (let i = 0; i < 6; i++) await Promise.resolve();
    expect(writeTextMock).toHaveBeenCalledWith("~/p/app/.patchwire-inbox/img.png");
    expect(getByTestId("attach-list").textContent).toContain("img.png");
  });
});
```

- [ ] **Step 5: Run → FAIL;** implement `AttachPanel.svelte`:

```svelte
<!-- packages/desktop/src/components/AttachPanel.svelte -->
<script lang="ts">
  import { pickFile, pushAttachment, copyToClipboard } from "../lib/ipc";

  let { projectDir }: { projectDir: string } = $props();
  let items = $state<{ name: string; remotePath: string }[]>([]);
  let note = $state("");
  let error = $state("");

  function baseName(p: string): string { return p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? p; }

  async function stage(remotePath: string, name: string) {
    items = [...items, { name, remotePath }];
    await copyToClipboard(remotePath);
    note = `Copied remote path: ${remotePath}`;
  }

  async function attachFile() {
    error = "";
    try {
      const f = await pickFile();
      if (!f) return;
      const rp = await pushAttachment(projectDir, f, false);
      await stage(rp, baseName(f));
    } catch (e) { error = `Attach failed: ${e}`; }
  }
  async function attachClip() {
    error = "";
    try {
      const rp = await pushAttachment(projectDir, undefined, true);
      await stage(rp, "clipboard image");
    } catch (e) { error = `Attach failed: ${e}`; }
  }
</script>

<div class="attach">
  <div class="row">
    <strong>Attachments</strong>
    <button class="ghost" data-testid="attach-file" onclick={attachFile}>📎 File</button>
    <button class="ghost" data-testid="attach-clip" onclick={attachClip}>📷 Clipboard</button>
  </div>
  {#if note}<div class="note" data-testid="attach-note">{note}</div>{/if}
  {#if error}<div class="err" data-testid="attach-error">{error}</div>{/if}
  <ul class="list" data-testid="attach-list">
    {#each items as it (it.remotePath)}<li><code>{it.name}</code></li>{/each}
  </ul>
</div>

<style>
  .attach { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; border-bottom: 1px solid var(--border); }
  .row { display: flex; align-items: center; gap: 8px; }
  .ghost { background: var(--surface-raised); color: var(--text); padding: 5px 10px; font-size: 12px; }
  .note { color: var(--text-muted); font-size: 11px; }
  .err { color: var(--error); font-size: 12px; }
  .list { display: flex; flex-direction: column; gap: 4px; font-size: 12px; margin: 0; padding: 0; list-style: none; }
  code { background: var(--surface-base); border: 1px solid var(--border-strong); border-radius: var(--radius-sm); padding: 1px 5px; }
</style>
```

- [ ] **Step 6: Run → PASS.**

- [ ] **Step 7: Write `ChangesList.test.ts`**

```ts
// packages/desktop/src/components/ChangesList.test.ts
import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
const invokeMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
import ChangesList from "./ChangesList.svelte";

beforeEach(() => invokeMock.mockReset());

describe("ChangesList", () => {
  it("loads and renders git-status entries on Refresh", async () => {
    invokeMock.mockResolvedValue(" M lib/main.dart\n?? notes.txt\n");
    const { getByTestId } = render(ChangesList, { props: { projectDir: "/l/app" } });
    await fireEvent.click(getByTestId("changes-refresh"));
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(getByTestId("changes-body").textContent).toContain("lib/main.dart");
    expect(getByTestId("changes-body").textContent).toContain("notes.txt");
  });
});
```

- [ ] **Step 8: Run → FAIL;** implement `ChangesList.svelte`:

```svelte
<!-- packages/desktop/src/components/ChangesList.svelte -->
<script lang="ts">
  import { onMount } from "svelte";
  import { gitStatus } from "../lib/ipc";
  import type { ChangedEntry } from "../lib/git-status";

  let { projectDir }: { projectDir: string } = $props();
  let entries = $state<ChangedEntry[]>([]);
  let error = $state("");

  async function refresh() {
    error = "";
    try { entries = await gitStatus(projectDir); }
    catch (e) { error = `git status failed: ${e}`; }
  }
  onMount(refresh);
</script>

<div class="changes">
  <div class="row">
    <strong>Changes</strong>
    <button class="ghost" data-testid="changes-refresh" onclick={refresh}>Refresh</button>
  </div>
  {#if error}<div class="err">{error}</div>{/if}
  <ul class="body" data-testid="changes-body">
    {#if entries.length === 0}<li class="empty">No changes</li>{/if}
    {#each entries as e (e.path)}<li><span class="badge">{e.status}</span> <code>{e.path}</code></li>{/each}
  </ul>
</div>

<style>
  .changes { padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
  .row { display: flex; align-items: center; gap: 8px; }
  .ghost { background: var(--surface-raised); color: var(--text); padding: 4px 10px; font-size: 12px; }
  .body { display: flex; flex-direction: column; gap: 4px; font-size: 12px; margin: 0; padding: 0; list-style: none; }
  .empty { color: var(--text-muted); }
  .badge { display: inline-block; min-width: 22px; color: var(--warn); font-family: monospace; }
  .err { color: var(--error); font-size: 12px; }
  code { color: var(--text); }
</style>
```

- [ ] **Step 9: Run → PASS.**

- [ ] **Step 10: Delete the chat components/libs**

```bash
cd /Users/apple/Documents/Workspace/patchwire
rm packages/desktop/src/components/ChatPane.svelte packages/desktop/src/components/ChatPane.test.ts \
   packages/desktop/src/components/ChangesPanel.svelte packages/desktop/src/components/ChangesPanel.test.ts \
   packages/desktop/src/lib/chat-session.ts packages/desktop/src/lib/chat-session.test.ts \
   packages/desktop/src/lib/chat-events.ts packages/desktop/src/lib/chat-events.test.ts
```

- [ ] **Step 11: Commit** (Workspace still references these — fixed in Task 6; commit the new components + deletions together):

```bash
git add -A packages/desktop/src/components packages/desktop/src/lib
git commit -m "feat(desktop): SessionLauncher + AttachPanel + ChangesList; remove chat components"
```

---

## Task 6: Workspace re-layout

**Files:**
- Modify: `packages/desktop/src/screens/Workspace.svelte`, `packages/desktop/src/screens/Workspace.test.ts`

- [ ] **Step 1: Rewrite `Workspace.svelte`**

```svelte
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { Project } from "../lib/types";
  import { connections } from "../lib/stores";
  import { startSyncWatch, stopSyncWatch, onSyncEvent, syncCommand } from "../lib/ipc";
  import SessionLauncher from "../components/SessionLauncher.svelte";
  import AttachPanel from "../components/AttachPanel.svelte";
  import ChangesList from "../components/ChangesList.svelte";
  import FlutterPanel from "../components/FlutterPanel.svelte";
  import SyncPill from "../components/SyncPill.svelte";
  import type { SyncStatus } from "../lib/sync-events";
  import type { UnlistenFn } from "@tauri-apps/api/event";

  let { project, onback }: { project: Project; onback?: () => void } = $props();

  let sync = $state<SyncStatus>({ kind: "no_session", conflicts: [] });
  let unlistenSync: UnlistenFn | null = null;

  let connection = $derived($connections.find((c) => c.id === project.connectionId));

  onMount(async () => {
    unlistenSync = await onSyncEvent((l) => { if (l.type === "status") sync = l.status; });
    try { await startSyncWatch(project.localPath); } catch { /* surfaced via pill */ }
  });
  onDestroy(() => { unlistenSync?.(); stopSyncWatch(); });

  async function toggleSync() {
    const sub = sync.kind === "paused" ? "resume" : "pause";
    await syncCommand(project.localPath, sub);
    const line = await syncCommand(project.localPath, "status");
    if (line && line.type === "status") sync = line.status;
  }
</script>

<div class="ws">
  <header class="ws-head">
    <button class="back" data-testid="ws-back" onclick={() => onback?.()}>←</button>
    <span class="title" data-testid="ws-title">{project.name} <span class="branch">{project.branch}</span></span>
    <span class="ws-sync">
      <SyncPill status={sync} />
      <button class="ghost" data-testid="sync-pause" onclick={toggleSync}>
        {sync.kind === "paused" ? "Resume" : "Pause"}
      </button>
    </span>
  </header>

  {#if sync.kind === "conflict" && sync.conflicts.length}
    <div class="conflicts" data-testid="sync-conflicts">Conflicts: {sync.conflicts.join(", ")}</div>
  {/if}

  <div class="split">
    <section class="left">
      <SessionLauncher {connection} {project} />
    </section>
    <section class="right">
      <AttachPanel projectDir={project.localPath} />
      <ChangesList projectDir={project.localPath} />
      <FlutterPanel projectDir={project.localPath} />
    </section>
  </div>
</div>

<style>
  .ws { display: flex; flex-direction: column; height: 100%; }
  .ws-head { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
  .back { background: var(--surface-raised); color: var(--text); padding: 4px 10px; }
  .title { font-weight: 600; }
  .branch { color: var(--text-muted); font-weight: 400; font-size: 12px; margin-left: 6px; }
  .ws-sync { display: flex; align-items: center; gap: 8px; margin-left: auto; }
  .ghost { background: transparent; border: 1px solid var(--border); color: var(--text-muted); padding: 2px 8px; font-size: 12px; }
  .conflicts { color: var(--error); padding: 4px 16px; font-size: 12px; border-bottom: 1px solid var(--border); }
  .split { flex: 1; display: flex; min-height: 0; }
  .left { width: 50%; display: flex; flex-direction: column; border-right: 1px solid var(--border); min-height: 0; overflow-y: auto; }
  .right { width: 50%; display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
</style>
```

- [ ] **Step 2: Update `Workspace.test.ts`**

Open the existing test. It likely renders `Workspace` and asserts chat/diff behavior + mocks `@tauri-apps/api/core` + `/event`. Replace chat-specific assertions with control-plane ones. The test must mock the connections store so `connection` resolves. Minimal rewrite:

```ts
import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
import Workspace from "./Workspace.svelte";
import { connections } from "../lib/stores";

const conn = { id: "c1", name: "mini", host: "100.64.0.1", user: "Admin", sshPort: 22, keyPath: "/k", agentPort: 7878, token: "T" };
const project = { id: "p1", name: "app", branch: "main", localPath: "/l/app", remotePath: "~/p/app", host: "100.64.0.1", user: "Admin", lastStatus: "in-sync" as const, syncPaused: false, connectionId: "c1" };

beforeEach(() => {
  invokeMock.mockReset(); listenMock.mockReset();
  listenMock.mockResolvedValue(() => {});
  invokeMock.mockResolvedValue(undefined);
  connections.set([conn]);
});

describe("Workspace", () => {
  it("renders the session launcher and the changes/attach panes", async () => {
    const { getByTestId } = render(Workspace, { props: { project } });
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(getByTestId("open-session")).toBeTruthy();
    expect(getByTestId("attach-list")).toBeTruthy();
    expect(getByTestId("changes-body")).toBeTruthy();
  });

  it("clicking Open claude session launches the terminal", async () => {
    const { getByTestId } = render(Workspace, { props: { project } });
    await fireEvent.click(getByTestId("open-session"));
    expect(invokeMock.mock.calls.some((c) => c[0] === "open_terminal")).toBe(true);
  });
});
```
(If the existing test imported helpers that no longer exist, this full replacement removes them. Keep the file name.)

- [ ] **Step 3: Run the Workspace test → PASS**

Run: `cd packages/desktop && pnpm vitest run src/screens/Workspace.test.ts`

- [ ] **Step 4: Full desktop suite + core**

Run: `cd /Users/apple/Documents/Workspace/patchwire && pnpm --filter @patchwire/core test 2>&1 | grep -E "Tests +[0-9]" && pnpm --filter patchwire-desktop test 2>&1 | grep -E "Tests +[0-9]|FAIL"`
Expected: core green; desktop all green (chat tests gone; new component + lib tests added). Investigate any `FAIL` — likely a leftover import of a deleted module; fix it.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/screens/Workspace.svelte packages/desktop/src/screens/Workspace.test.ts
git commit -m "feat(desktop): Workspace control-plane layout (launcher + attach + changes)"
```

---

## Final verification

- [ ] `pnpm --filter @patchwire/core test` — green.
- [ ] `pnpm --filter patchwire-desktop test` — green (no references to deleted chat modules).
- [ ] `cd packages/desktop/src-tauri && PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" cargo build` (after `pnpm --filter patchwire-desktop stage-sidecar`) — `Finished`.
- [ ] Grep for stragglers: `grep -rn "chat-session\|chat-events\|ChatPane\|ChangesPanel\|startChat\|applyPatch" packages/desktop/src` → only matches should be none (or in deleted-file history). Fix any live reference.
- [ ] Manual live-verify (macOS): open a project → Open claude session → Terminal.app opens running claude on the remote; attach a file → remote path on clipboard; edit via claude → Refresh Changes shows the file.

---

## Self-Review notes (spec → tasks)

- External claude session, all-OS launcher → Task 1 (`buildSessionShellCommand`) + Task 3 (cross-OS `open_terminal`) + Task 5 (SessionLauncher) + Task 2 (`buildLaunchCommand`).
- Attachments → copy remote path → Task 4 (`copyToClipboard`) + Task 5 (AttachPanel).
- Read-only changes list → Task 3 (`git_status`) + Task 2 (`parseGitStatus`) + Task 5 (ChangesList).
- Remove chat → Task 3 (Rust cmds) + Task 4 (ipc) + Task 5 (components/libs deleted) + Task 6 (Workspace).
- skip-permissions toggle → Task 1 (flag) + Task 5 (checkbox).
- Deviation from spec: added self-contained `buildSessionShellCommand` instead of moving `buildRemoteCommand` (avoids the banner's double quotes breaking the shell-string launcher); extension untouched. FlutterPanel kept in the right pane.
- Name consistency: `buildSessionShellCommand`/`SessionTarget` (core), `buildLaunchCommand` (desktop), `parseGitStatus`/`ChangedEntry`, `copyToClipboard`, `gitStatus`, `git_status` (Rust), testids `open-session`/`skip-perms`/`attach-file`/`attach-list`/`changes-refresh`/`changes-body`.
```
