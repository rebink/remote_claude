# Desktop Developer Client — Phase 4b (guided setup wizard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `SetupWizardPlaceholder` with the real 4-step guided wizard — point at a machine → install the per-project SSH key (Open Terminal, no password in-app) → confirm project source → verify + provision the agent (streamed) — writing the project's `patchwire.yml` + a `projects.json` entry on finish.

**Architecture:** Reuse the kept ops-console engine: Rust `start_provision` (streams `setup --provision-remote --stream --token-stdin`) + `send_consent`, their existing ipc wrappers (`startProvision`/`sendConsent`/`onProvEvent`/`onProvEnd`), and the `provision-state.ts` reducer for the streamed step list. New small Rust commands handle key generation, key verification, and opening Terminal. `setup` writes the **local** `patchwire.yml` itself when run with `current_dir` = the project folder — so `start_provision` gains `current_dir` + `--project/--path`.

**Tech Stack:** Tauri 2 (shell + opener), Svelte 5 runes, Vitest + @testing-library/svelte, the `patchwire` CLI `setup` command.

**Spec:** `docs/superpowers/specs/2026-06-15-desktop-per-project-connection-design.md`. **Builds on P4a** (`SetupWizardPlaceholder`, `onneedssetup(localPath)`, projects.json, `projectFromConfig`).

**SECURITY (must):** `host` and `user` flow into `ssh-keygen` (key path), `ssh-copy-id`, `osascript`, and CLI args. Validate both against `/^[A-Za-z0-9._-]+$/` **before building any command**; the wizard disables "Next" until valid, and the Rust commands reject invalid input. (Same allowlist as the P3b config hardening.)

**Verified facts (from source):**
- Rust `ProvisionArgs` = `{host, user, port, key_path, agent_port, token}` (camelCase IPC); `start_provision` builds `["setup","--provision-remote","--stream","--token-stdin","--host",h,"--user",u,"--ssh-port",port,"--key-path",k,"--agent-port",ap]`, writes the token to stdin, emits `pw://prov` lines + `pw://prov-end`. NO `current_dir`, NO `--project/--path` today.
- `send_consent(consent: bool)` writes `{"consent":true|false}\n` to the child stdin.
- ipc already exports `startProvision(args)`, `sendConsent(consent)`, `onProvEvent(cb)`, `onProvEnd(cb)`.
- `provision-state.ts`: `initialState()`, `reduce(state, line)`; consumes `{"type":"preview","plan":{"steps":[{id}]},"elevation":[...]}` → `awaitingConsent=true`; `{"type":"step","step":id,"status":"start|ok|degraded|failed","detail"}`; `{"type":"result","status":"completed|rolled-back","health":{tailnet,agent}}`.
- CLI `setup` flags incl. `--provision-remote --stream --token-stdin --project --path --host --user --ssh-port --key-path --agent-port --token --verify-key`. `setup --verify-key --host --user --ssh-port --key-path` → `{"ok":true|false,...}`. `setup` writes the local `patchwire.yml` (in cwd) before provision.
- Tauri: `@tauri-apps/plugin-shell` + `@tauri-apps/plugin-opener` both installed + initialized.

**Working dir:** `packages/desktop`. Tests: `pnpm --filter patchwire-desktop test`.

---

## File Structure
**Rust:** Modify `src-tauri/src/lib.rs` — extend `ProvisionArgs` (`projectDir`/`project`/`remotePath`) + `start_provision` (`current_dir` + `--project/--path`); add `ensure_ssh_key`, `verify_key`, `open_terminal`; register the 3 new commands.
**Frontend:**
- Create `src/lib/wizard.ts` (+ test) — pure: `isSafeToken`, `genToken`, `defaultRemotePath`, `sshCopyIdCommand`, `wizardCanProvision`.
- Modify `src/lib/ipc.ts` (+ test) — extend the `ProvisionArgs` type + `startProvision`; add `ensureSshKey`, `verifyKey`, `openTerminal`.
- Create `src/screens/SetupWizard.svelte` (+ test) — the 4-step flow.
- Modify `src/App.svelte` (+ test) — route `setupPath` → `SetupWizard` (replacing the placeholder); `onfinish` reloads projects.
- Delete `src/screens/SetupWizardPlaceholder.svelte`.

---

### Task 1: Rust — provision into a project folder

**Files:** Modify `src-tauri/src/lib.rs`

> `setup` writes the local `patchwire.yml` into cwd, so the sidecar must run with `current_dir` = the project folder, and pass `--project`/`--path` so the yml has the right project name + remote path. Read the current `ProvisionArgs` + `start_provision` first.

- [ ] **Step 1: Extend `ProvisionArgs`**
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
    project_dir: String,   // NEW: local folder (current_dir; where patchwire.yml lands)
    project: String,       // NEW
    remote_path: String,   // NEW
}
```

- [ ] **Step 2: Update `start_provision`** — validate `project_dir` is a dir; set `.current_dir(project_dir)`; add `--project`/`--path` to the args. The args become:
```rust
.current_dir(std::path::PathBuf::from(&args.project_dir))
.args([
    "setup", "--provision-remote", "--stream", "--token-stdin",
    "--host", &args.host,
    "--user", &args.user,
    "--ssh-port", &args.port.to_string(),
    "--key-path", &key_path,
    "--agent-port", &args.agent_port.to_string(),
    "--project", &args.project,
    "--path", &args.remote_path,
])
```
Add, before spawning, `if !std::path::Path::new(&args.project_dir).is_dir() { return Err("project_dir does not exist".into()); }` (after the existing input validation; keep the busy/token-stdin logic unchanged).

- [ ] **Step 3: Verify compiles**

Run: `export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && pnpm stage-sidecar && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles.

- [ ] **Step 4: Commit**
```bash
git add packages/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): start_provision runs in the project dir with --project/--path"
```

---

### Task 2: Rust — ensure_ssh_key / verify_key / open_terminal

**Files:** Modify `src-tauri/src/lib.rs`

> Three small commands. **All validate `host`/`user` against `/^[A-Za-z0-9._-]+$/` first** (prevents path/arg/AppleScript injection).

- [ ] **Step 1: Add a token validator + the commands**
```rust
fn safe_token(v: &str) -> bool {
    !v.is_empty() && v.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-')
}

// Generate the per-project key if missing; return the public key path.
#[tauri::command]
fn ensure_ssh_key(host: String, user: String) -> Result<String, String> {
    if !safe_token(&host) || !safe_token(&user) { return Err("invalid host/user".into()); }
    let home = dirs_next_home()?; // see note below
    let keys = std::path::Path::new(&home).join(".patchwire").join("keys");
    std::fs::create_dir_all(&keys).map_err(|e| e.to_string())?;
    let key = keys.join(format!("{host}-{user}"));
    let pubkey = keys.join(format!("{host}-{user}.pub"));
    if !key.exists() {
        let out = std::process::Command::new("ssh-keygen")
            .args(["-t", "ed25519", "-f", &key.to_string_lossy(), "-N", "", "-C", "patchwire"])
            .output().map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(format!("ssh-keygen failed: {}", String::from_utf8_lossy(&out.stderr)));
        }
    }
    Ok(pubkey.to_string_lossy().to_string())
}

// Verify a key-only SSH connection works (reuses the CLI setup --verify-key).
#[tauri::command]
async fn verify_key(app: tauri::AppHandle, host: String, user: String, ssh_port: u16, key_path: String) -> Result<bool, String> {
    use tauri_plugin_shell::ShellExt;
    if !safe_token(&host) || !safe_token(&user) { return Err("invalid host/user".into()); }
    let sidecar = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?;
    let out = sidecar.args([
        "setup", "--verify-key",
        "--host", &host, "--user", &user,
        "--ssh-port", &ssh_port.to_string(), "--key-path", &key_path,
    ]).output().await.map_err(|e| e.to_string())?;
    let line = String::from_utf8_lossy(&out.stdout).lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").to_string();
    match serde_json::from_str::<serde_json::Value>(&line) {
        Ok(v) => Ok(v.get("ok").and_then(|b| b.as_bool()).unwrap_or(false)),
        Err(_) => Ok(false),
    }
}

// Open Terminal.app and run a command (macOS). The command is built by the caller from validated host/user.
#[tauri::command]
fn open_terminal(command: String) -> Result<(), String> {
    // Reject control chars / quotes that could break out of the AppleScript string.
    if command.contains('"') || command.contains('\n') || command.contains('\r') {
        return Err("invalid command".into());
    }
    let script = format!("tell application \"Terminal\" to do script \"{command}\"");
    let out = std::process::Command::new("osascript").args(["-e", &script]).output().map_err(|e| e.to_string())?;
    if !out.status.success() { return Err(String::from_utf8_lossy(&out.stderr).to_string()); }
    Ok(())
}
```
**Home dir note:** use the same home resolution the rest of lib.rs uses (e.g. `std::env::var("HOME")` or the `dirs`/`tauri` path API). Read the file — if `app.path().home_dir()` is available, prefer a small helper that takes `app`. Adapt `ensure_ssh_key` to take `app: tauri::AppHandle` if needed for the home dir. Keep the validation.

- [ ] **Step 2: Register** `ensure_ssh_key, verify_key, open_terminal` in `generate_handler!` (keep all existing; now 20 commands).

- [ ] **Step 3: Verify compiles**

Run: `export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles.

- [ ] **Step 4: Commit**
```bash
git add packages/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): rust ensure_ssh_key/verify_key/open_terminal (host/user validated)"
```

---

### Task 3: Pure wizard helpers + IPC (TDD)

**Files:** Create `src/lib/wizard.ts` (+ test); Modify `src/lib/ipc.ts` (+ test)

- [ ] **Step 1: Write `src/lib/wizard.test.ts`**
```ts
import { describe, it, expect } from "vitest";
import { isSafeToken, defaultRemotePath, sshCopyIdCommand, wizardCanProvision } from "./wizard";

describe("isSafeToken", () => {
  it("accepts hostnames/users; rejects whitespace/newline/#/@", () => {
    expect(isSafeToken("studio-mini")).toBe(true);
    expect(isSafeToken("rebin_dev")).toBe(true);
    expect(isSafeToken("a b")).toBe(false);
    expect(isSafeToken("a\nb")).toBe(false);
    expect(isSafeToken("a#b")).toBe(false);
    expect(isSafeToken("")).toBe(false);
  });
});
describe("defaultRemotePath", () => {
  it("is ~/workspace/<project>", () => {
    expect(defaultRemotePath("api-server")).toBe("~/workspace/api-server");
  });
});
describe("sshCopyIdCommand", () => {
  it("builds ssh-copy-id with the pub key, port, user@host", () => {
    expect(sshCopyIdCommand("/k/studio-mini-rebin.pub", "rebin", "studio-mini", 22))
      .toBe("ssh-copy-id -i /k/studio-mini-rebin.pub -p 22 rebin@studio-mini");
  });
});
describe("wizardCanProvision", () => {
  it("requires safe host+user, a project name, a key, and key-verified", () => {
    const base = { host: "h", user: "u", project: "p", keyVerified: true };
    expect(wizardCanProvision(base)).toBe(true);
    expect(wizardCanProvision({ ...base, keyVerified: false })).toBe(false);
    expect(wizardCanProvision({ ...base, host: "a b" })).toBe(false);
    expect(wizardCanProvision({ ...base, project: "" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail** — `pnpm --filter patchwire-desktop test src/lib/wizard.test.ts` → FAIL.

- [ ] **Step 3: Write `src/lib/wizard.ts`**
```ts
const TOKEN = /^[A-Za-z0-9._-]+$/;
export function isSafeToken(v: string): boolean { return TOKEN.test(v); }
export function defaultRemotePath(project: string): string { return `~/workspace/${project}`; }
export function genToken(): string {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}
export function sshCopyIdCommand(pubKeyPath: string, user: string, host: string, sshPort: number): string {
  return `ssh-copy-id -i ${pubKeyPath} -p ${sshPort} ${user}@${host}`;
}
export function wizardCanProvision(s: { host: string; user: string; project: string; keyVerified: boolean }): boolean {
  return isSafeToken(s.host) && isSafeToken(s.user) && s.project.trim() !== "" && s.keyVerified;
}
```

- [ ] **Step 4: Add the IPC tests** to `src/lib/ipc.test.ts` (reuse the existing `invokeMock`):
```ts
import { ensureSshKey, verifyKey, openTerminal, startProvision } from "./ipc";

describe("wizard ipc", () => {
  it("ensureSshKey invokes ensure_ssh_key", async () => {
    invokeMock.mockResolvedValue("/k/h-u.pub");
    expect(await ensureSshKey("h", "u")).toBe("/k/h-u.pub");
    expect(invokeMock).toHaveBeenCalledWith("ensure_ssh_key", { host: "h", user: "u" });
  });
  it("verifyKey invokes verify_key and returns the bool", async () => {
    invokeMock.mockResolvedValue(true);
    expect(await verifyKey({ host: "h", user: "u", sshPort: 22, keyPath: "/k" })).toBe(true);
    expect(invokeMock).toHaveBeenCalledWith("verify_key", { host: "h", user: "u", sshPort: 22, keyPath: "/k" });
  });
  it("openTerminal invokes open_terminal", async () => {
    invokeMock.mockResolvedValue(undefined);
    await openTerminal("ssh-copy-id ...");
    expect(invokeMock).toHaveBeenCalledWith("open_terminal", { command: "ssh-copy-id ..." });
  });
  it("startProvision passes the full args incl. projectDir/project/remotePath", async () => {
    invokeMock.mockResolvedValue(undefined);
    const args = { host: "h", user: "u", port: 22, keyPath: "/k", agentPort: 7878, token: "T", projectDir: "/l", project: "p", remotePath: "/r" };
    await startProvision(args);
    expect(invokeMock).toHaveBeenCalledWith("start_provision", { args });
  });
});
```

- [ ] **Step 5: Run, verify fail** — `pnpm --filter patchwire-desktop test src/lib/ipc.test.ts` → FAIL (new exports / extended type).

- [ ] **Step 6: Update `src/lib/ipc.ts`**

Extend the `ProvisionArgs` type (wherever it's declared for `startProvision`; if it's in ipc.ts add the fields, else add it) to include `projectDir: string; project: string; remotePath: string;`. Confirm `startProvision(args)` passes the whole object through (it already does `invoke('start_provision', { args })`). Add:
```ts
export async function ensureSshKey(host: string, user: string): Promise<string> {
  return invoke<string>("ensure_ssh_key", { host, user });
}
export async function verifyKey(a: { host: string; user: string; sshPort: number; keyPath: string }): Promise<boolean> {
  return invoke<boolean>("verify_key", a);
}
export async function openTerminal(command: string): Promise<void> {
  await invoke("open_terminal", { command });
}
```

- [ ] **Step 7: Run, verify pass** — both `wizard.test.ts` + `ipc.test.ts` green.

- [ ] **Step 8: Commit**
```bash
git add packages/desktop/src/lib/wizard.ts packages/desktop/src/lib/wizard.test.ts packages/desktop/src/lib/ipc.ts packages/desktop/src/lib/ipc.test.ts
git commit -m "feat(desktop): wizard pure helpers + ipc (ensureSshKey/verifyKey/openTerminal/startProvision args)"
```

---

### Task 4: SetupWizard — Steps 1–3 (TDD)

**Files:** Create `src/screens/SetupWizard.svelte` (+ test)

> A `step` $state (1..4). Step 1: machine inputs + project + remote path. Step 2: key (ensureSshKey → show command + Open Terminal + Verify). Step 3: review. Step 4 is added in Task 5. Use `wizard.ts` helpers + the Task-3 ipc.

- [ ] **Step 1: Write `src/screens/SetupWizard.test.ts`** (Steps 1–3 behaviors)
```ts
import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";
const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
import SetupWizard from "./SetupWizard.svelte";

beforeEach(() => { invokeMock.mockReset(); listenMock.mockReset(); listenMock.mockResolvedValue(() => {}); });

function fillStep1(getByLabelText: (t: string) => HTMLElement) {
  return async () => {
    await fireEvent.input(getByLabelText("Host"), { target: { value: "studio-mini" } });
    await fireEvent.input(getByLabelText("User"), { target: { value: "rebin" } });
    await fireEvent.input(getByLabelText("Project name"), { target: { value: "api" } });
  };
}

describe("SetupWizard Steps 1-3", () => {
  it("Step 1 Next is disabled until host/user/project are valid", async () => {
    const { getByTestId, getByLabelText } = render(SetupWizard, { props: { localPath: "/l/api" } });
    expect((getByTestId("wiz-next") as HTMLButtonElement).disabled).toBe(true);
    await fillStep1(getByLabelText)();
    expect((getByTestId("wiz-next") as HTMLButtonElement).disabled).toBe(false);
  });

  it("rejects an unsafe host (keeps Next disabled)", async () => {
    const { getByTestId, getByLabelText } = render(SetupWizard, { props: { localPath: "/l/api" } });
    await fireEvent.input(getByLabelText("Host"), { target: { value: "bad host" } });
    await fireEvent.input(getByLabelText("User"), { target: { value: "rebin" } });
    await fireEvent.input(getByLabelText("Project name"), { target: { value: "api" } });
    expect((getByTestId("wiz-next") as HTMLButtonElement).disabled).toBe(true);
  });

  it("Step 2 generates the key and shows the ssh-copy-id command", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "ensure_ssh_key") return Promise.resolve("/k/studio-mini-rebin.pub");
      return Promise.resolve(undefined);
    });
    const { getByTestId, getByLabelText } = render(SetupWizard, { props: { localPath: "/l/api" } });
    await fillStep1(getByLabelText)();
    await fireEvent.click(getByTestId("wiz-next")); // → Step 2
    await Promise.resolve(); await Promise.resolve();
    expect(getByTestId("copy-command").textContent).toContain("ssh-copy-id -i /k/studio-mini-rebin.pub");
  });

  it("Step 2 Verify enables advancing only when verify_key returns true", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "ensure_ssh_key") return Promise.resolve("/k/studio-mini-rebin.pub");
      if (cmd === "verify_key") return Promise.resolve(true);
      return Promise.resolve(undefined);
    });
    const { getByTestId, getByLabelText } = render(SetupWizard, { props: { localPath: "/l/api" } });
    await fillStep1(getByLabelText)();
    await fireEvent.click(getByTestId("wiz-next"));
    await Promise.resolve(); await Promise.resolve();
    await fireEvent.click(getByTestId("verify-key"));
    await Promise.resolve(); await Promise.resolve();
    expect((getByTestId("wiz-next") as HTMLButtonElement).disabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run, verify fail** — component missing.

- [ ] **Step 3: Write `src/screens/SetupWizard.svelte`** (Steps 1–3; Step 4 stub renders nothing yet — Task 5 fills it). Use Svelte 5 runes, `wizard.ts`, and the ipc. Key shape:
```svelte
<script lang="ts">
  import { isSafeToken, defaultRemotePath, sshCopyIdCommand, genToken, wizardCanProvision } from "../lib/wizard";
  import { ensureSshKey, verifyKey, openTerminal } from "../lib/ipc";

  let { localPath, onfinish, onback }: { localPath: string; onfinish?: () => void; onback?: () => void } = $props();

  let step = $state(1);
  let host = $state(""); let user = $state(""); let sshPort = $state(22); let agentPort = $state(7878);
  let project = $state(""); let remotePath = $state("");
  let pubKeyPath = $state(""); let keyVerified = $state(false); let verifyError = $state("");

  let keyPath = $derived(`~/.patchwire/keys/${host}-${user}`); // display; Rust resolves the real path
  let copyCmd = $derived(pubKeyPath ? sshCopyIdCommand(pubKeyPath, user, host, sshPort) : "");
  let step1Valid = $derived(isSafeToken(host) && isSafeToken(user) && project.trim() !== "");

  async function toStep2() {
    if (!remotePath) remotePath = defaultRemotePath(project);
    pubKeyPath = await ensureSshKey(host, user);
    step = 2;
  }
  async function verify() {
    verifyError = "";
    keyVerified = await verifyKey({ host, user, sshPort, keyPath });
    if (!keyVerified) verifyError = "Key not working yet — run the command in Terminal, then retry.";
  }
  // Task 5 adds provision() for Step 4.
</script>

<div class="wiz" data-testid="setup-wizard">
  <header><button class="back" onclick={() => onback?.()}>←</button><span>Set up — {localPath}</span></header>

  {#if step === 1}
    <h3>1 · Machine</h3>
    <label>Host<input aria-label="Host" bind:value={host} /></label>
    <label>User<input aria-label="User" bind:value={user} /></label>
    <label>Project name<input aria-label="Project name" bind:value={project} /></label>
    <label>Remote path<input aria-label="Remote path" bind:value={remotePath} placeholder={defaultRemotePath(project || "project")} /></label>
    <div class="ports"><label>SSH port<input aria-label="SSH port" type="number" bind:value={sshPort} /></label><label>Agent port<input aria-label="Agent port" type="number" bind:value={agentPort} /></label></div>
    <button class="primary" data-testid="wiz-next" disabled={!step1Valid} onclick={toStep2}>Next</button>
  {:else if step === 2}
    <h3>2 · SSH key</h3>
    <p>Run this once in your terminal (you'll type the SSH password):</p>
    <code class="cmd mono" data-testid="copy-command">{copyCmd}</code>
    <div class="row">
      <button class="ghost" onclick={() => navigator.clipboard?.writeText(copyCmd)}>Copy</button>
      <button class="ghost" data-testid="open-terminal" onclick={() => openTerminal(copyCmd)}>Open Terminal</button>
      <button class="ghost" data-testid="verify-key" onclick={verify}>I've installed the key — Verify</button>
    </div>
    {#if verifyError}<div class="error" data-testid="verify-error">{verifyError}</div>{/if}
    {#if keyVerified}<div class="ok" data-testid="key-ok">Key verified ✓</div>{/if}
    <button class="primary" data-testid="wiz-next" disabled={!keyVerified} onclick={() => (step = 3)}>Next</button>
  {:else if step === 3}
    <h3>3 · Review</h3>
    <ul class="review">
      <li>Project: <b>{project}</b></li>
      <li class="mono">{localPath} ⇄ {remotePath}</li>
      <li class="mono">{user}@{host}:{sshPort}</li>
    </ul>
    <button class="primary" data-testid="wiz-next" onclick={() => (step = 4)}>Provision</button>
  {:else}
    <!-- Task 5: Step 4 provision UI -->
  {/if}
</div>

<style>
  .wiz { max-width: 480px; margin: 32px auto; display: flex; flex-direction: column; gap: 10px; padding: 0 20px; }
  header { display: flex; align-items: center; gap: 10px; color: var(--text-muted); font-size: 12px; }
  .back { background: var(--surface-raised); color: var(--text); padding: 3px 9px; }
  label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--text-muted); }
  label input { color: var(--text); }
  .ports { display: flex; gap: 12px; } .ports label { flex: 1; }
  .cmd { display: block; padding: 10px; background: var(--surface-base); border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 11px; overflow-x: auto; }
  .row { display: flex; gap: 8px; flex-wrap: wrap; }
  .ghost { background: var(--surface-raised); color: var(--text); padding: 7px 12px; font-size: 12px; }
  .primary { background: var(--accent-strong); color: #fff; padding: 9px; font-weight: 600; }
  .primary:disabled { opacity: .5; cursor: not-allowed; }
  .error { color: var(--error); font-size: 12px; } .ok { color: var(--ok); font-size: 12px; }
  .review { list-style: none; padding: 0; display: flex; flex-direction: column; gap: 6px; font-size: 13px; }
</style>
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter patchwire-desktop test src/screens/SetupWizard.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add packages/desktop/src/screens/SetupWizard.svelte packages/desktop/src/screens/SetupWizard.test.ts
git commit -m "feat(desktop): SetupWizard steps 1-3 (machine, key install, review)"
```

---

### Task 5: SetupWizard — Step 4 provision + save (TDD)

**Files:** Modify `src/screens/SetupWizard.svelte` (+ test)

> Step 4 streams provisioning via the reused engine: `startProvision({...})` → `onProvEvent` → `reduce` (provision-state) → render step list; on `preview` (`awaitingConsent`) show a **Confirm** button → `sendConsent(true)`; on `result.status === "completed"` save the project (`projectFromConfig`-style from the wizard inputs) via `saveProject` and call `onfinish`.

- [ ] **Step 1: Add Step-4 tests to `src/screens/SetupWizard.test.ts`**
```ts
import { onProvEvent } from "../lib/ipc"; // for reference; the test drives via the pw://prov listener

describe("SetupWizard Step 4 (provision)", () => {
  it("starts provisioning and shows the consent gate on preview, then completes + saves", async () => {
    let provCb: ((e: { payload: string }) => void) | null = null;
    listenMock.mockImplementation((name: string, cb: any) => { if (name === "pw://prov") provCb = cb; return Promise.resolve(() => {}); });
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "ensure_ssh_key") return Promise.resolve("/k/studio-mini-rebin.pub");
      if (cmd === "verify_key") return Promise.resolve(true);
      return Promise.resolve(undefined); // start_provision, send_consent, save_project
    });
    const onfinish = vi.fn();
    const { getByTestId, getByLabelText } = render(SetupWizard, { props: { localPath: "/l/api", onfinish } });
    // walk to step 4
    await fireEvent.input(getByLabelText("Host"), { target: { value: "studio-mini" } });
    await fireEvent.input(getByLabelText("User"), { target: { value: "rebin" } });
    await fireEvent.input(getByLabelText("Project name"), { target: { value: "api" } });
    await fireEvent.click(getByTestId("wiz-next")); await Promise.resolve(); await Promise.resolve();
    await fireEvent.click(getByTestId("verify-key")); await Promise.resolve(); await Promise.resolve();
    await fireEvent.click(getByTestId("wiz-next")); // → step 3
    await fireEvent.click(getByTestId("wiz-next")); // → step 4 → starts provision
    await Promise.resolve(); await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith("start_provision", expect.objectContaining({
      args: expect.objectContaining({ projectDir: "/l/api", host: "studio-mini", user: "rebin", project: "api" }),
    }));
    // preview → consent gate
    provCb!({ payload: '{"type":"preview","plan":{"steps":[{"id":"install"}]},"elevation":[]}' });
    await Promise.resolve();
    await fireEvent.click(getByTestId("prov-confirm"));
    expect(invokeMock).toHaveBeenCalledWith("send_consent", { consent: true });
    // result completed → save + finish
    provCb!({ payload: '{"type":"result","status":"completed","health":{"tailnet":true,"agent":"healthy"}}' });
    await Promise.resolve(); await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledWith("save_project", expect.objectContaining({
      project: expect.objectContaining({ name: "api", host: "studio-mini", user: "rebin", localPath: "/l/api", remotePath: "~/workspace/api" }),
    }));
    expect(onfinish).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement Step 4 in `SetupWizard.svelte`**

Add to the script:
```ts
  import { onMount, onDestroy } from "svelte";
  import { startProvision, sendConsent, onProvEvent, saveProject } from "../lib/ipc";
  import { initialState, reduce, type ProvisionUiState } from "../lib/provision-state";
  import { buildProject } from "../lib/model";
  import type { UnlistenFn } from "@tauri-apps/api/event";

  let prov = $state<ProvisionUiState>(initialState());
  let unlistenProv: UnlistenFn | null = null;
  let saved = $state(false);

  onMount(async () => {
    unlistenProv = await onProvEvent((line) => {
      prov = reduce(prov, line);
      if (!saved && prov.phase === "done" && prov.result?.status === "completed") {
        saved = true;
        const p = buildProject(localPath, remotePath, project, host, user);
        saveProject(p).then(() => onfinish?.());
      }
    });
  });
  onDestroy(() => unlistenProv?.());

  async function provision() {
    prov = initialState();
    saved = false;
    await startProvision({ host, user, port: sshPort, keyPath, agentPort, token: genToken(), projectDir: localPath, project, remotePath });
  }
```
Change the Step-3 "Provision" button to `onclick={() => { step = 4; provision(); }}`. Replace the Step-4 placeholder with:
```svelte
  {:else}
    <h3>4 · Provision</h3>
    <ul class="steps" data-testid="prov-steps">
      {#each prov.steps as s (s.id)}
        <li>{prov.stepStatus[s.id]?.status === "ok" ? "✓" : prov.stepStatus[s.id]?.status === "failed" ? "✗" : prov.stepStatus[s.id]?.status === "degraded" ? "⚠" : "…"} {s.id}</li>
      {/each}
    </ul>
    {#if prov.awaitingConsent}
      <p>Review the plan above. Proceed?</p>
      <button class="primary" data-testid="prov-confirm" onclick={() => sendConsent(true)}>Confirm & provision</button>
    {/if}
    {#if prov.phase === "done"}
      <div class={prov.result?.status === "completed" ? "ok" : "error"} data-testid="prov-result">
        {prov.result?.status === "completed" ? "Provisioned ✓ — finishing…" : `Failed: ${prov.result?.failedStep ?? "unknown"}`}
      </div>
    {/if}
  {/if}
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter patchwire-desktop test src/screens/SetupWizard.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add packages/desktop/src/screens/SetupWizard.svelte packages/desktop/src/screens/SetupWizard.test.ts
git commit -m "feat(desktop): SetupWizard step 4 — streamed provision + consent + save project"
```

---

### Task 6: Wire into App; remove placeholder; full verify (TDD)

**Files:** Modify `src/App.svelte` (+ test); Delete `src/screens/SetupWizardPlaceholder.svelte`

- [ ] **Step 1: Update `src/App.test.ts`** — add a test that the setup route renders the wizard:
```ts
it("routes to the SetupWizard when a folder needs setup", async () => {
  // open AddProjectDialog, pick an unconfigured folder → onneedssetup → wizard
  // (drive via the same path App uses; assert the wizard renders)
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "list_projects") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
  const { findByTestId } = render(App);
  // simulate reaching setup: easiest is to assert SetupWizard mounts given setupPath.
  // If App exposes the flow only via AddProjectDialog, trigger: New → pick-folder (readProjectConfig null) → wizard.
});
```
(Keep it pragmatic: assert that when the add-folder flow yields an unconfigured folder, `setup-wizard` testid appears. Mock `pickFolder`/`read_project_config` to return an unconfigured dir. If that's awkward in one render, at minimum assert the existing routes still pass and add a focused render of `SetupWizard` import path via App by setting up the AddProjectDialog → onneedssetup path.)

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Update `src/App.svelte`** — replace the placeholder import + route:
```svelte
  import SetupWizard from "./screens/SetupWizard.svelte";
  ...
  {:else if setupPath}
    <SetupWizard localPath={setupPath} onfinish={async () => { setupPath = null; await loadProjects(); }} onback={() => (setupPath = null)} />
```
Remove the `SetupWizardPlaceholder` import.

- [ ] **Step 4: Delete the placeholder**
```bash
git rm packages/desktop/src/screens/SetupWizardPlaceholder.svelte
```
(grep `src/` for any remaining `SetupWizardPlaceholder` reference + remove.)

- [ ] **Step 5: Run the FULL suite** — `pnpm --filter patchwire-desktop test` → ALL green.

- [ ] **Step 6: Verify Rust compiles + app boots**

Run: `export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && pnpm stage-sidecar && cargo check --manifest-path src-tauri/Cargo.toml`
Then optionally `pnpm tauri dev` to eyeball: New → pick an unconfigured folder → the 4-step wizard renders.

- [ ] **Step 7: Manual E2E (best effort / human)** — against a real machine: walk the wizard (Step 2 Open-Terminal key install with the real password, Step 4 live provision). Document what couldn't be verified here (no reachable agent).

- [ ] **Step 8: Commit**
```bash
git add packages/desktop/src/App.svelte packages/desktop/src/App.test.ts
git commit -m "feat(desktop): route setup to the real SetupWizard; remove placeholder"
```

---

## Self-Review

**Spec coverage (P4b):**
- 4-step guided wizard (machine → key/Open-Terminal → source → verify+provision) → Tasks 4, 5. ✓
- Open-Terminal key install, no password in-app → Tasks 2 (`open_terminal`), 4. ✓
- Reuse `start_provision`/`send_consent`/`provision-state` for Step 4 → Tasks 1, 5. ✓
- `start_provision` gains `current_dir` + `--project/--path` (writes local patchwire.yml) → Task 1. ✓
- Write project to projects.json on finish → Task 5. ✓
- Replace placeholder + route → Task 6. ✓
- Security: host/user allowlist before ssh-keygen/ssh-copy-id/osascript/CLI → Tasks 2 (Rust), 3 (`isSafeToken`/`wizardCanProvision`), 4 (Next gated). ✓

**Placeholder scan:** No TBD. The Step-4 stub in Task 4 is explicitly completed in Task 5. Task 1's home-dir note and Task 6's pragmatic App-test note instruct adapting to the real code — interfaces + key assertions are specified.

**Type consistency:** `ProvisionArgs` extended consistently in Rust (Task 1) + the ipc type (Task 3) + the `startProvision` call (Task 5) — all carry `projectDir`/`project`/`remotePath`. `provision-state` reducer reused unchanged (its `ProvEvent`/`ProvisionUiState` types). Command names `ensure_ssh_key`/`verify_key`/`open_terminal`/`start_provision`/`send_consent` match Rust (Tasks 1,2) + ipc (Task 3) + wizard (Tasks 4,5). `pw://prov` channel matches `onProvEvent` (existing) + Rust emit. `buildProject(localPath, remotePath, name, host, user)` signature matches Task-3 (P4a) model.

## Follow-on
- Tailscale-peer picker in Step 1 (the CLI supports `--list-peers`/tailscale detect) — a nicety; manual entry ships now.
- Windows/Linux: `open_terminal` is macOS osascript; add platform branches (gnome-terminal / wt) later. macOS-first for now (matches the project's dev target).
- Settings screen (re-run setup, rotate token, remove project) — a later phase.
- Live wizard E2E against a real machine remains the key validation milestone.
