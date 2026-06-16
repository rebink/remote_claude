# Desktop Chat Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add file + clipboard-image attachments to the desktop chat workspace, mirroring the extension: stage via CLI `push`, show chips above the composer, auto-append the staged remote paths to the prompt on Send.

**Architecture:** A Rust `push_attachment` one-shot command runs `patchwire push [<file>|--clip] --stage-only --json` (current_dir = project) and returns the staged remote inbox path. The running mutagen sync carries the file to the remote. The Workspace holds an attachments list; ChatPane shows chips + 📎/📷 buttons; on Send the Workspace appends the paths to the prompt via a pure `withAttachments` helper.

**Tech Stack:** Tauri 2 + tauri-plugin-shell/dialog, Svelte 5 runes, Vitest + @testing-library/svelte, CLI `push`.

**Spec:** `docs/superpowers/specs/2026-06-16-desktop-attachments-design.md`.

**Verified facts:** CLI `push [files...] --stage-only --json --clip` (flag is `--stage-only`); prints `{"remotePath":"…","remotePaths":[…]}`. ChatPane composer-bar has the textarea + Stop + Send. Workspace `send(text)` → `startTurn(chat,text)` + `startChat(project.localPath, chat.sessionUuid, text)`. `pickFolder` in ipc uses `open` from `@tauri-apps/plugin-dialog`. `push_attachment` mirrors `apply_patch` (one-shot `.output()` + `current_dir`).

**Working dir:** `packages/desktop`. Tests: `pnpm --filter patchwire-desktop test`.

---

## File Structure
- Modify `src-tauri/src/lib.rs` — `push_attachment` command + register.
- Modify `src/lib/ipc.ts` (+ test) — `pickFile`, `pushAttachment`.
- Modify `src/lib/chat-session.ts` (+ test) — pure `withAttachments`.
- Modify `src/components/ChatPane.svelte` (+ test) — attach buttons + chips.
- Modify `src/screens/Workspace.svelte` (+ test) — attachments state + handlers + compose-on-send.

---

### Task 1: Rust `push_attachment`

**Files:** Modify `src-tauri/src/lib.rs`

> READ the CLI `push` command in `cli.ts` to confirm the flag is `--stage-only` and the JSON shape. Mirror `apply_patch` (one-shot sidecar, `current_dir`, `.output().await`).

- [ ] **Step 1: Add the command**
```rust
#[tauri::command]
async fn push_attachment(
    app: tauri::AppHandle,
    project_dir: String,
    file_path: Option<String>,
    use_clipboard: bool,
) -> Result<String, String> {
    use tauri_plugin_shell::ShellExt;
    if !std::path::Path::new(&project_dir).is_dir() { return Err("project_dir does not exist".into()); }
    if use_clipboard == file_path.is_some() {
        return Err("provide exactly one of file_path or use_clipboard".into());
    }
    let sidecar = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?;
    let mut argv: Vec<String> = vec!["push".into()];
    if use_clipboard {
        argv.push("--clip".into());
    } else if let Some(f) = file_path.as_ref() {
        argv.push(f.clone());
    }
    argv.push("--stage-only".into());
    argv.push("--json".into());
    let output = sidecar
        .current_dir(std::path::PathBuf::from(&project_dir))
        .args(argv)
        .output()
        .await
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!("push failed: {}", String::from_utf8_lossy(&output.stderr)));
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").to_string();
    match serde_json::from_str::<serde_json::Value>(&line) {
        Ok(v) => Ok(v.get("remotePath").and_then(|p| p.as_str()).unwrap_or("").to_string()),
        Err(_) => Err(format!("push: unparseable output: {line}")),
    }
}
```

- [ ] **Step 2: Register** `push_attachment` in `generate_handler!` (keep all; now 26).

- [ ] **Step 3: cargo check** — `export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && pnpm stage-sidecar && cargo check --manifest-path src-tauri/Cargo.toml` → compiles.

- [ ] **Step 4: Commit**
```bash
git add packages/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): push_attachment command (stage file/clipboard via CLI push)"
```

---

### Task 2: ipc + withAttachments (TDD)

**Files:** Modify `src/lib/ipc.ts` (+ test); Modify `src/lib/chat-session.ts` (+ test)

- [ ] **Step 1: Add failing tests**

To `src/lib/ipc.test.ts` (reuse `invokeMock`; the dialog `open` is mocked via `@tauri-apps/plugin-dialog` — add an `openMock = vi.hoisted(() => vi.fn())` + `vi.mock` if not already present):
```ts
import { pickFile, pushAttachment } from "./ipc";

describe("attachment ipc", () => {
  it("pickFile opens a file (not directory) dialog", async () => {
    openMock.mockResolvedValue("/home/r/mock.png");
    expect(await pickFile()).toBe("/home/r/mock.png");
    expect(openMock).toHaveBeenCalledWith({ directory: false, multiple: false });
  });
  it("pickFile returns null on cancel", async () => {
    openMock.mockResolvedValue(null);
    expect(await pickFile()).toBeNull();
  });
  it("pushAttachment (file) invokes push_attachment", async () => {
    invokeMock.mockResolvedValue("/remote/.patchwire-inbox/mock.png");
    const r = await pushAttachment("/l/api", "/home/r/mock.png", false);
    expect(invokeMock).toHaveBeenCalledWith("push_attachment", { projectDir: "/l/api", filePath: "/home/r/mock.png", useClipboard: false });
    expect(r).toBe("/remote/.patchwire-inbox/mock.png");
  });
  it("pushAttachment (clipboard) passes filePath null + useClipboard true", async () => {
    invokeMock.mockResolvedValue("/remote/.patchwire-inbox/clip.png");
    await pushAttachment("/l/api", undefined, true);
    expect(invokeMock).toHaveBeenCalledWith("push_attachment", { projectDir: "/l/api", filePath: null, useClipboard: true });
  });
});
```
To `src/lib/chat-session.test.ts`:
```ts
import { withAttachments } from "./chat-session";

describe("withAttachments", () => {
  it("returns the prompt unchanged when no paths", () => {
    expect(withAttachments("fix the bug", [])).toBe("fix the bug");
  });
  it("appends an Attached block for one path", () => {
    expect(withAttachments("see this", ["/r/.patchwire-inbox/a.png"]))
      .toBe("see this\n\nAttached:\n- /r/.patchwire-inbox/a.png");
  });
  it("lists multiple paths", () => {
    expect(withAttachments("p", ["/r/a", "/r/b"])).toBe("p\n\nAttached:\n- /r/a\n- /r/b");
  });
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Add to `src/lib/ipc.ts`** (the `open` import from `@tauri-apps/plugin-dialog` already exists for `pickFolder`):
```ts
export async function pickFile(): Promise<string | null> {
  const result = await open({ directory: false, multiple: false });
  return typeof result === "string" ? result : null;
}
export async function pushAttachment(projectDir: string, filePath: string | undefined, useClipboard: boolean): Promise<string> {
  return invoke<string>("push_attachment", { projectDir, filePath: filePath ?? null, useClipboard });
}
```

- [ ] **Step 4: Add to `src/lib/chat-session.ts`:**
```ts
export function withAttachments(prompt: string, paths: string[]): string {
  if (paths.length === 0) return prompt;
  return `${prompt}\n\nAttached:\n${paths.map((p) => `- ${p}`).join("\n")}`;
}
```

- [ ] **Step 5: Run, verify pass** — `pnpm --filter patchwire-desktop test src/lib/ipc.test.ts src/lib/chat-session.test.ts`.

- [ ] **Step 6: Commit**
```bash
git add packages/desktop/src/lib/ipc.ts packages/desktop/src/lib/ipc.test.ts packages/desktop/src/lib/chat-session.ts packages/desktop/src/lib/chat-session.test.ts
git commit -m "feat(desktop): pickFile/pushAttachment ipc + withAttachments prompt helper"
```

---

### Task 3: ChatPane attach buttons + chips (TDD)

**Files:** Modify `src/components/ChatPane.svelte` (+ test)

> Add props `attachments: { name: string }[]` + `onattachfile?`, `onattachclip?`, `onremoveattachment?: (i: number) => void`. Render a removable chips row above the composer + 📎/📷 buttons in the composer-bar. Keep existing send/stop behavior.

- [ ] **Step 1: Write/extend `src/components/ChatPane.test.ts`** — add (keep existing tests):
```ts
it("renders attachment chips and fires remove", async () => {
  const onremoveattachment = vi.fn();
  const { getAllByTestId, getByTestId } = render(ChatPane, {
    props: { messages: [], streaming: false, syncing: false, attachments: [{ name: "a.png" }, { name: "b.png" }], onremoveattachment },
  });
  expect(getAllByTestId("attach-chip")).toHaveLength(2);
  await fireEvent.click(getByTestId("chip-remove-0"));
  expect(onremoveattachment).toHaveBeenCalledWith(0);
});
it("attach buttons fire their handlers", async () => {
  const onattachfile = vi.fn(); const onattachclip = vi.fn();
  const { getByTestId } = render(ChatPane, { props: { messages: [], streaming: false, syncing: false, onattachfile, onattachclip } });
  await fireEvent.click(getByTestId("attach-file"));
  await fireEvent.click(getByTestId("attach-clip"));
  expect(onattachfile).toHaveBeenCalled();
  expect(onattachclip).toHaveBeenCalled();
});
```
(Existing ChatPane tests pass `messages/streaming/syncing` without `attachments` — give `attachments` a default `[]` so they keep working.)

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Update `src/components/ChatPane.svelte`** — add to props (with defaults) + markup:
```svelte
  let {
    messages, streaming, syncing, onsend, oncancel,
    attachments = [],
    onattachfile, onattachclip, onremoveattachment,
  }: {
    messages: ChatMessage[]; streaming: boolean; syncing: boolean;
    onsend?: (text: string) => void; oncancel?: () => void;
    attachments?: { name: string }[];
    onattachfile?: () => void; onattachclip?: () => void; onremoveattachment?: (i: number) => void;
  } = $props();
```
Above `.composer-bar`, add a chips row:
```svelte
{#if attachments.length}
  <div class="chips" data-testid="attach-chips">
    {#each attachments as a, i (i)}
      <span class="chip" data-testid="attach-chip">📎 {a.name}<button class="chip-x" data-testid="chip-remove-{i}" onclick={() => onremoveattachment?.(i)}>✕</button></span>
    {/each}
  </div>
{/if}
```
In `.composer-bar`, add the two buttons (before Send):
```svelte
  <button class="attach" data-testid="attach-file" title="Attach file" onclick={() => onattachfile?.()}>📎</button>
  <button class="attach" data-testid="attach-clip" title="Attach clipboard image" onclick={() => onattachclip?.()}>📷</button>
```
Add styles:
```css
  .chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 14px 0; }
  .chip { display: inline-flex; align-items: center; gap: 6px; background: var(--surface-raised); border: 1px solid var(--border); border-radius: 20px; padding: 3px 10px; font-size: 11px; }
  .chip-x { background: transparent; color: var(--text-muted); padding: 0 2px; }
  .attach { background: var(--surface-raised); color: var(--text); padding: 8px 10px; }
```

- [ ] **Step 4: Run, verify pass** — `pnpm --filter patchwire-desktop test src/components/ChatPane.test.ts`.

- [ ] **Step 5: Commit**
```bash
git add packages/desktop/src/components/ChatPane.svelte packages/desktop/src/components/ChatPane.test.ts
git commit -m "feat(desktop): ChatPane attach buttons + removable chips"
```

---

### Task 4: Workspace attachments wiring (TDD)

**Files:** Modify `src/screens/Workspace.svelte` (+ test)

> Add `attachments` state + `attachFile`/`attachClip`/`removeAttachment`; compose the prompt with `withAttachments` on send + clear; pass attachment props to ChatPane. Read the current Workspace.svelte first.

- [ ] **Step 1: Add failing tests to `src/screens/Workspace.test.ts`**
```ts
it("attaching a file calls push_attachment and shows a chip", async () => {
  // mock dialog open + push_attachment
  // (add openMock for @tauri-apps/plugin-dialog if not present)
  openMock.mockResolvedValue("/home/r/mock.png");
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "push_attachment") return Promise.resolve("/remote/.patchwire-inbox/mock.png");
    return Promise.resolve(undefined);
  });
  const { getByTestId, getAllByTestId } = render(Workspace, { props: { project } });
  await fireEvent.click(getByTestId("attach-file"));
  await Promise.resolve(); await Promise.resolve();
  expect(invokeMock).toHaveBeenCalledWith("push_attachment", expect.objectContaining({ projectDir: project.localPath, useClipboard: false }));
  expect(getAllByTestId("attach-chip")).toHaveLength(1);
});

it("send appends attachment paths to the prompt and clears chips", async () => {
  openMock.mockResolvedValue("/home/r/mock.png");
  invokeMock.mockImplementation((cmd: string) => {
    if (cmd === "push_attachment") return Promise.resolve("/remote/.patchwire-inbox/mock.png");
    return Promise.resolve(undefined); // start_chat
  });
  const { getByTestId, queryAllByTestId } = render(Workspace, { props: { project } });
  await fireEvent.click(getByTestId("attach-file"));
  await Promise.resolve(); await Promise.resolve();
  await fireEvent.input(getByTestId("composer"), { target: { value: "use this" } });
  await fireEvent.click(getByTestId("send-btn"));
  await Promise.resolve();
  expect(invokeMock).toHaveBeenCalledWith("start_chat", expect.objectContaining({
    prompt: "use this\n\nAttached:\n- /remote/.patchwire-inbox/mock.png",
  }));
  expect(queryAllByTestId("attach-chip")).toHaveLength(0); // cleared
});
```
(Ensure the test file mocks `@tauri-apps/plugin-dialog`'s `open` via a hoisted `openMock`, and `listenMock` resolves to `()=>{}` as in the existing Workspace tests.)

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Update `src/screens/Workspace.svelte`** — add imports + state + handlers + ChatPane props:
```ts
  import { startChat, cancelChat, applyPatch, onChatEvent, onChatEnd, startSyncWatch, stopSyncWatch, onSyncEvent, syncCommand, pickFile, pushAttachment } from "../lib/ipc";
  import { initChatState, startTurn, applyChatEvent, endStream, withAttachments, type ChatState } from "../lib/chat-session";
  ...
  let attachments = $state<{ name: string; remotePath: string }[]>([]);
  function baseName(p: string): string { return p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? p; }

  async function attachFile() {
    try {
      const f = await pickFile();
      if (!f) return;
      const remotePath = await pushAttachment(project.localPath, f, false);
      attachments = [...attachments, { name: baseName(f), remotePath }];
    } catch (e) {
      chat = applyChatEvent(chat, { type: "error", code: "attach", message: String(e), recoverable: true });
    }
  }
  async function attachClip() {
    try {
      const remotePath = await pushAttachment(project.localPath, undefined, true);
      attachments = [...attachments, { name: "clipboard image", remotePath }];
    } catch (e) {
      chat = applyChatEvent(chat, { type: "error", code: "attach", message: String(e), recoverable: true });
    }
  }
  function removeAttachment(i: number) { attachments = attachments.filter((_, idx) => idx !== i); }
```
Update `send` to compose + clear:
```ts
  async function send(text: string) {
    const paths = attachments.map((a) => a.remotePath);
    chat = startTurn(chat, text);          // bubble shows the user's typed text
    const full = withAttachments(text, paths);
    attachments = [];
    try {
      await startChat(project.localPath, chat.sessionUuid, full);
    } catch (e) {
      chat = applyChatEvent(chat, { type: "error", code: "ipc", message: String(e), recoverable: false });
    }
  }
```
Update the ChatPane usage:
```svelte
<ChatPane messages={chat.messages} streaming={chat.streaming} syncing={chat.syncing}
  {attachments} onsend={send} oncancel={cancel}
  onattachfile={attachFile} onattachclip={attachClip} onremoveattachment={removeAttachment} />
```

- [ ] **Step 4: Run the FULL suite** — `pnpm --filter patchwire-desktop test` → ALL green.

- [ ] **Step 5: Rust + boot check** — `export PATH="$HOME/.rustup/toolchains/stable-aarch64-apple-darwin/bin:$PATH" && pnpm stage-sidecar && cargo check --manifest-path src-tauri/Cargo.toml`. Optionally `pnpm tauri dev`.

- [ ] **Step 6: Manual E2E (human)** — in a real project: 📎 attach a file + 📷 a clipboard image → chips appear → type + Send → Claude sees the files on the remote. Document if not verifiable.

- [ ] **Step 7: Commit**
```bash
git add packages/desktop/src/screens/Workspace.svelte packages/desktop/src/screens/Workspace.test.ts
git commit -m "feat(desktop): wire attachments into the Workspace (attach → chip → append on send)"
```

---

## Self-Review

**Spec coverage:**
- Rust `push_attachment` (file + clip, `--stage-only --json`) → Task 1. ✓
- `pickFile`/`pushAttachment` ipc → Task 2. ✓
- Pure `withAttachments` (append on send) → Task 2. ✓
- ChatPane chips + 📎/📷 → Task 3. ✓
- Workspace attachments state + compose-on-send + clear → Task 4. ✓
- Bubble shows the user's typed text; the appended paths go only to Claude → Task 4. ✓
- Errors → workspace error bar → Task 4. ✓

**Placeholder scan:** No TBD. Task 1 instructs reading `cli.ts` to confirm `--stage-only`. `baseName` is inlined in Workspace (consistent with AddProject's existing inline; consolidation is a noted fast-follow).

**Type consistency:** `push_attachment` arg shape `{projectDir, filePath, useClipboard}` matches Rust (Task 1) + ipc (Task 2) + tests. `withAttachments` shape used by Workspace (Task 4) + tested (Task 2). ChatPane `attachments: {name}[]` prop (Task 3) fed from Workspace's `{name,remotePath}[]` (only `.name` read by ChatPane). `pickFile` uses the existing `open` import.

## Follow-on
- Consolidate `baseName` (Workspace + AddProject + model) into one helper.
- Inline image thumbnail preview in chips; drag-and-drop attach; inbox cleanup (`push --clean`).
