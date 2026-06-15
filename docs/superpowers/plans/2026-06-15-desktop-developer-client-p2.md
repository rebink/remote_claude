# Desktop Developer Client — Phase 2 (Project Workspace: chat + diff + apply) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the split project workspace: open a project, chat with Claude (streamed), see the returned diff in a Changes panel, and apply or reject it.

**Architecture:** Same UI-shell-over-CLI model as P1. A new Rust `start_chat` command spawns `patchwire chat --session <uuid> --json` (with `current_dir` = the project's local folder) and streams its NDJSON lines back as `pw://chat` Tauri events; `cancel_chat` kills the turn. A new non-interactive CLI seam `apply --yes --json` lets `apply_patch` (Rust) write the streamed patch to disk and apply it without prompts. A pure TS chat-session reducer turns the NDJSON event stream into renderable state.

**Tech Stack:** Tauri 2 + tauri-plugin-shell (sidecar streaming + `current_dir`), Svelte 5 (runes), Vitest + @testing-library/svelte, the `patchwire` CLI (commander).

**Spec:** `docs/superpowers/specs/2026-06-15-desktop-developer-client-design.md`. **Builds on P1** (merged to main: types/model/ipc/stores, Connect, Projects landing, App routing with an `opened` project hook).

**CLI contract (verified from source):**
- `chat <prompt...> --session <uuid> --json [--no-sync]` → NDJSON lines, one JSON object each. Event types (from `packages/protocol/src/events.ts` / `packages/cli/src/agent/chat.ts`):
  `{type:'protocol';version}` · `{type:'sync_start'}` · `{type:'sync_progress';transferred;total}` · `{type:'sync_done';filesChanged;durationMs}` · `{type:'chat_turn_start';sessionId;turnIndex}` · `{type:'chat_text';chunk}` · `{type:'chat_diff';patch;files}` · `{type:'chat_done';tokensIn;tokensOut;durationMs}` · `{type:'error';code;message;recoverable}` · `{type:'cancelled'}`. `chat_text` streams token chunks; `chat_diff` arrives once near the end. Prompt is a positional arg (NOT stdin). `--session <uuid>` required (canonical UUID or hex ≥32 chars).
  `ChangedFile = {path:string; status:'A'|'M'|'D'|'R'; additions:number; deletions:number}`.
- `apply [patch]` currently reads `.patchwire/last.patch` (or a path arg) and applies **interactively**. `chat` does NOT persist its patch. Task 1 adds `--yes` (non-interactive) + `--json` (machine result line).

**Working dir for desktop commands:** `packages/desktop`. CLI tasks run from `packages/cli`. Desktop tests: `pnpm --filter patchwire-desktop test`. CLI tests: `pnpm --filter @rebink/patchwire test`.

---

## File Structure

**CLI (Task 1):**
- Modify: `packages/cli/src/cli.ts` — add `--yes`/`--json` to the `apply` command.
- Modify: `packages/cli/src/commands/apply.ts` — non-interactive + JSON result path.
- Test: `packages/cli/src/commands/apply.test.ts` (create if absent; else extend).

**Desktop frontend:**
- Create: `src/lib/chat-events.ts` — `ChatEvent`/`ChangedFile` types + `parseChatLine`.
- Create: `src/lib/chat-session.ts` — pure session reducer (`initChatState`, `startTurn`, `applyChatEvent`) + `ApplyResult`/`parseApplyResult`.
- Test: `src/lib/chat-session.test.ts`.
- Modify: `src/lib/types.ts` — re-export nothing new; `ChangedFile` lives in chat-events.
- Modify: `src/lib/ipc.ts` — add `startChat`, `cancelChat`, `applyPatch`, `onChatEvent` (event subscription).
- Modify: `src/lib/ipc.test.ts` — tests for the new wrappers.
- Create: `src/components/ChatPane.svelte` + `src/components/ChatPane.test.ts`.
- Create: `src/components/ChangesPanel.svelte` + `src/components/ChangesPanel.test.ts`.
- Create: `src/screens/Workspace.svelte` + `src/screens/Workspace.test.ts`.
- Modify: `src/App.svelte` + `src/App.test.ts` — route the `opened` project into `Workspace`, back to `Projects`.

**Desktop Rust:**
- Modify: `src-tauri/src/lib.rs` — `ChatState` managed struct; `start_chat`, `cancel_chat`, `apply_patch` commands; register them.

---

### Task 1: CLI — non-interactive `apply --yes --json`

**Files:**
- Modify: `packages/cli/src/cli.ts`
- Modify: `packages/cli/src/commands/apply.ts`
- Test: `packages/cli/src/commands/apply.test.ts`

> Read `packages/cli/src/commands/apply.ts` and `packages/cli/src/lib/patch.ts` FIRST. `apply.ts` currently calls `applyPatchInteractive(diff, cwd)`. You need a non-interactive apply. Use whatever non-interactive primitive `patch.ts` exposes (e.g. a `git apply`-based helper or `parsePatch`); if only the interactive function exists, add a sibling `applyPatch(diff, cwd): Promise<{files:string[]}>` in `patch.ts` that applies the whole patch without prompting (apply via the same mechanism the interactive path uses once the user says yes). Keep the interactive path the default; `--yes` selects the non-interactive path.

- [ ] **Step 1: Write the failing test `packages/cli/src/commands/apply.test.ts`**

Match the project's existing CLI test style (check a neighboring `*.test.ts` in `packages/cli/src/commands` for imports and the temp-dir helper). The test must cover:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runApply } from "./apply.ts";

// A minimal valid unified diff that creates one file in the temp project.
const PATCH = `diff --git a/hello.txt b/hello.txt
new file mode 100644
index 0000000..3b18e51
--- /dev/null
+++ b/hello.txt
@@ -0,0 +1 @@
+hello world
`;

describe("runApply --yes --json", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "pw-apply-"));
    await mkdir(join(dir, ".patchwire"), { recursive: true });
    await writeFile(join(dir, ".patchwire", "last.patch"), PATCH, "utf8");
  });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("applies the default patch non-interactively and writes the file", async () => {
    const lines: string[] = [];
    await runApply(dir, undefined, { yes: true, json: true, print: (s) => lines.push(s) });
    const applied = await readFile(join(dir, "hello.txt"), "utf8");
    expect(applied.trim()).toBe("hello world");
    const result = JSON.parse(lines.at(-1)!);
    expect(result).toEqual({ type: "result", applied: true, files: ["hello.txt"] });
  });

  it("emits a JSON error line when the patch file is missing", async () => {
    await rm(join(dir, ".patchwire", "last.patch"));
    const lines: string[] = [];
    await runApply(dir, undefined, { yes: true, json: true, print: (s) => lines.push(s) });
    const result = JSON.parse(lines.at(-1)!);
    expect(result.type).toBe("error");
    expect(result.applied).not.toBe(true);
  });
});
```

(If the existing `runApply` signature differs, adapt: the goal is a `print` injection so the test captures stdout without spying on `process.stdout`. If the codebase already injects stdout differently, follow that convention instead and keep the two behavioral assertions.)

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @rebink/patchwire test apply.test.ts`
Expected: FAIL — `runApply` does not accept `{ yes, json, print }` yet.

- [ ] **Step 3: Update `runApply` in `packages/cli/src/commands/apply.ts`**

Change the signature to accept options with an injectable printer (default `console.log`). Implement:
- Resolve patch path: arg → else `join(cwd, ".patchwire", "last.patch")`.
- Read the patch; if missing/unreadable and `json`, print `{type:"error", applied:false, message:"<err>"}` and return; if not `json`, keep current behavior (throw/log).
- If `yes`: apply non-interactively via the patch primitive (see the task note). Collect applied file paths (parse the patch's `b/<path>` headers via the existing patch parser). On success with `json`: print `{type:"result", applied:true, files:[...]}`. On failure with `json`: print `{type:"error", applied:false, message:"<err>"}`.
- If NOT `yes`: keep the existing `applyPatchInteractive(diff, cwd)` behavior unchanged.

Reference shape (adapt to the real `patch.ts` API you read):
```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { applyPatchInteractive, applyPatch, parsePatch } from "../lib/patch.ts";

interface ApplyOpts {
  yes?: boolean;
  json?: boolean;
  print?: (line: string) => void;
}

export async function runApply(cwd: string, patchPath?: string, opts: ApplyOpts = {}): Promise<void> {
  const print = opts.print ?? ((l: string) => console.log(l));
  const path = patchPath ?? join(cwd, ".patchwire", "last.patch");

  let diff: string;
  try {
    diff = await readFile(path, "utf8");
  } catch (e) {
    if (opts.json) { print(JSON.stringify({ type: "error", applied: false, message: String(e) })); return; }
    throw e;
  }

  if (!opts.yes) {
    await applyPatchInteractive(diff, cwd);
    return;
  }

  try {
    await applyPatch(diff, cwd);                      // non-interactive primitive
    const files = parsePatch(diff).map((c) => c.path); // existing parser → file paths
    if (opts.json) print(JSON.stringify({ type: "result", applied: true, files }));
  } catch (e) {
    if (opts.json) print(JSON.stringify({ type: "error", applied: false, message: String(e) }));
    else throw e;
  }
}
```
If `patch.ts` lacks `applyPatch`/`parsePatch` under those names, add a minimal non-interactive `applyPatch(diff, cwd)` there (apply the full patch the same way the interactive path applies after a "yes") and use the real parser export name for file paths.

- [ ] **Step 4: Wire the flags in `packages/cli/src/cli.ts`**

In the `apply` command definition, add the options and pass them through:
```ts
.command('apply')
.argument('[patch]', 'optional patch file path')
.option('--yes', 'apply without prompting (non-interactive)')
.option('--json', 'emit a JSON result line')
.action(async (patch: string | undefined, opts: { yes?: boolean; json?: boolean }) => {
  const { runApply } = await import('./commands/apply.ts');
  await runApply(process.cwd(), patch, { yes: opts.yes, json: opts.json });
});
```

- [ ] **Step 5: Run tests, verify pass**

Run: `pnpm --filter @rebink/patchwire test apply.test.ts`
Expected: PASS (both cases). Then run the full CLI suite `pnpm --filter @rebink/patchwire test` — Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/cli.ts packages/cli/src/commands/apply.ts packages/cli/src/commands/apply.test.ts packages/cli/src/lib/patch.ts
git commit -m "feat(cli): non-interactive apply --yes --json for desktop client"
```

---

### Task 2: Chat event parsing (TS, pure, TDD)

**Files:**
- Create: `packages/desktop/src/lib/chat-events.ts`
- Test: `packages/desktop/src/lib/chat-events.test.ts`

- [ ] **Step 1: Write the failing test `src/lib/chat-events.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { parseChatLine } from "./chat-events";

describe("parseChatLine", () => {
  it("parses a chat_text event", () => {
    expect(parseChatLine('{"type":"chat_text","chunk":"hi"}')).toEqual({ type: "chat_text", chunk: "hi" });
  });
  it("parses a chat_diff event with files", () => {
    const line = '{"type":"chat_diff","patch":"diff --git a/x b/x","files":[{"path":"x","status":"M","additions":3,"deletions":1}]}';
    const ev = parseChatLine(line);
    expect(ev).toEqual({
      type: "chat_diff",
      patch: "diff --git a/x b/x",
      files: [{ path: "x", status: "M", additions: 3, deletions: 1 }],
    });
  });
  it("returns null for blank or non-JSON lines", () => {
    expect(parseChatLine("")).toBeNull();
    expect(parseChatLine("   ")).toBeNull();
    expect(parseChatLine("not json")).toBeNull();
  });
  it("returns null for JSON without a string type", () => {
    expect(parseChatLine('{"foo":1}')).toBeNull();
  });
  it("passes through known event shapes generically by type", () => {
    expect(parseChatLine('{"type":"sync_start"}')).toEqual({ type: "sync_start" });
    expect(parseChatLine('{"type":"chat_done","tokensIn":10,"tokensOut":20,"durationMs":5}'))
      .toEqual({ type: "chat_done", tokensIn: 10, tokensOut: 20, durationMs: 5 });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter patchwire-desktop test src/lib/chat-events.test.ts`
Expected: FAIL — `./chat-events` not found.

- [ ] **Step 3: Write `src/lib/chat-events.ts`**

```ts
export interface ChangedFile {
  path: string;
  status: "A" | "M" | "D" | "R";
  additions: number;
  deletions: number;
}

export type ChatEvent =
  | { type: "protocol"; version: string }
  | { type: "sync_start" }
  | { type: "sync_progress"; transferred: number; total: number }
  | { type: "sync_done"; filesChanged: number; durationMs: number }
  | { type: "chat_turn_start"; sessionId: string; turnIndex: number }
  | { type: "chat_text"; chunk: string }
  | { type: "chat_diff"; patch: string; files: ChangedFile[] }
  | { type: "chat_done"; tokensIn: number; tokensOut: number; durationMs: number }
  | { type: "error"; code: string; message: string; recoverable: boolean }
  | { type: "cancelled" };

const KNOWN = new Set([
  "protocol", "sync_start", "sync_progress", "sync_done",
  "chat_turn_start", "chat_text", "chat_diff", "chat_done", "error", "cancelled",
]);

export function parseChatLine(line: string): ChatEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  let o: unknown;
  try {
    o = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!o || typeof o !== "object") return null;
  const type = (o as Record<string, unknown>).type;
  if (typeof type !== "string" || !KNOWN.has(type)) return null;
  return o as ChatEvent;
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter patchwire-desktop test src/lib/chat-events.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/lib/chat-events.ts packages/desktop/src/lib/chat-events.test.ts
git commit -m "feat(desktop): chat NDJSON event types and line parser"
```

---

### Task 3: Chat session reducer + apply-result parser (TS, pure, TDD)

**Files:**
- Create: `packages/desktop/src/lib/chat-session.ts`
- Test: `packages/desktop/src/lib/chat-session.test.ts`

- [ ] **Step 1: Write the failing test `src/lib/chat-session.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import {
  initChatState,
  startTurn,
  applyChatEvent,
  parseApplyResult,
  type ChatState,
} from "./chat-session";

const uuid = "11111111-1111-1111-1111-111111111111";

describe("chat session reducer", () => {
  it("initializes empty", () => {
    const s = initChatState(uuid);
    expect(s.sessionUuid).toBe(uuid);
    expect(s.messages).toEqual([]);
    expect(s.streaming).toBe(false);
    expect(s.diff).toBeNull();
  });

  it("startTurn appends a user message and an empty assistant message and sets streaming", () => {
    const s = startTurn(initChatState(uuid), "add retry");
    expect(s.messages).toEqual([
      { role: "user", text: "add retry" },
      { role: "assistant", text: "" },
    ]);
    expect(s.streaming).toBe(true);
    expect(s.error).toBeNull();
    expect(s.diff).toBeNull();
  });

  it("chat_text appends chunks to the last assistant message", () => {
    let s = startTurn(initChatState(uuid), "x");
    s = applyChatEvent(s, { type: "chat_text", chunk: "Hel" });
    s = applyChatEvent(s, { type: "chat_text", chunk: "lo" });
    expect(s.messages.at(-1)).toEqual({ role: "assistant", text: "Hello" });
  });

  it("sync_start/sync_done toggle syncing", () => {
    let s = startTurn(initChatState(uuid), "x");
    s = applyChatEvent(s, { type: "sync_start" });
    expect(s.syncing).toBe(true);
    s = applyChatEvent(s, { type: "sync_done", filesChanged: 2, durationMs: 9 });
    expect(s.syncing).toBe(false);
  });

  it("chat_diff captures the reviewable diff", () => {
    let s = startTurn(initChatState(uuid), "x");
    s = applyChatEvent(s, { type: "chat_diff", patch: "PATCH", files: [{ path: "a", status: "M", additions: 1, deletions: 0 }] });
    expect(s.diff).toEqual({ patch: "PATCH", files: [{ path: "a", status: "M", additions: 1, deletions: 0 }] });
  });

  it("chat_done ends streaming", () => {
    let s = startTurn(initChatState(uuid), "x");
    s = applyChatEvent(s, { type: "chat_done", tokensIn: 1, tokensOut: 2, durationMs: 3 });
    expect(s.streaming).toBe(false);
  });

  it("error sets error and ends streaming", () => {
    let s = startTurn(initChatState(uuid), "x");
    s = applyChatEvent(s, { type: "error", code: "boom", message: "it broke", recoverable: false });
    expect(s.error).toBe("it broke");
    expect(s.streaming).toBe(false);
  });

  it("cancelled ends streaming without an error", () => {
    let s = startTurn(initChatState(uuid), "x");
    s = applyChatEvent(s, { type: "cancelled" });
    expect(s.streaming).toBe(false);
    expect(s.error).toBeNull();
  });

  it("clearing the diff after apply", () => {
    let s = startTurn(initChatState(uuid), "x");
    s = applyChatEvent(s, { type: "chat_diff", patch: "P", files: [] });
    s = { ...s, diff: null };
    expect(s.diff).toBeNull();
  });
});

describe("parseApplyResult", () => {
  it("parses a success result line", () => {
    expect(parseApplyResult('{"type":"result","applied":true,"files":["a","b"]}'))
      .toEqual({ applied: true, files: ["a", "b"] });
  });
  it("parses an error result line", () => {
    expect(parseApplyResult('{"type":"error","applied":false,"message":"nope"}'))
      .toEqual({ applied: false, files: [], error: "nope" });
  });
  it("returns applied:false on unparseable output", () => {
    expect(parseApplyResult("garbage")).toEqual({ applied: false, files: [], error: "unparseable apply output" });
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter patchwire-desktop test src/lib/chat-session.test.ts`
Expected: FAIL — `./chat-session` not found.

- [ ] **Step 3: Write `src/lib/chat-session.ts`**

```ts
import type { ChatEvent, ChangedFile } from "./chat-events";

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export interface PendingDiff {
  patch: string;
  files: ChangedFile[];
}

export interface ChatState {
  sessionUuid: string;
  messages: ChatMessage[];
  streaming: boolean;
  syncing: boolean;
  diff: PendingDiff | null;
  error: string | null;
}

export interface ApplyResult {
  applied: boolean;
  files: string[];
  error?: string;
}

export function initChatState(sessionUuid: string): ChatState {
  return { sessionUuid, messages: [], streaming: false, syncing: false, diff: null, error: null };
}

export function startTurn(state: ChatState, prompt: string): ChatState {
  return {
    ...state,
    messages: [...state.messages, { role: "user", text: prompt }, { role: "assistant", text: "" }],
    streaming: true,
    syncing: false,
    diff: null,
    error: null,
  };
}

export function applyChatEvent(state: ChatState, ev: ChatEvent): ChatState {
  switch (ev.type) {
    case "sync_start":
      return { ...state, syncing: true };
    case "sync_done":
      return { ...state, syncing: false };
    case "chat_text":
      return { ...state, messages: appendToAssistant(state.messages, ev.chunk) };
    case "chat_diff":
      return { ...state, diff: { patch: ev.patch, files: ev.files } };
    case "chat_done":
      return { ...state, streaming: false, syncing: false };
    case "error":
      return { ...state, streaming: false, syncing: false, error: ev.message };
    case "cancelled":
      return { ...state, streaming: false, syncing: false };
    default:
      return state; // protocol, sync_progress, chat_turn_start: no UI state change
  }
}

function appendToAssistant(messages: ChatMessage[], chunk: string): ChatMessage[] {
  if (messages.length === 0) return messages;
  const last = messages[messages.length - 1];
  if (last.role !== "assistant") return messages;
  const updated = { ...last, text: last.text + chunk };
  return [...messages.slice(0, -1), updated];
}

export function parseApplyResult(line: string): ApplyResult {
  try {
    const o = JSON.parse(line.trim());
    if (o && o.type === "result" && o.applied === true) {
      return { applied: true, files: Array.isArray(o.files) ? o.files : [] };
    }
    if (o && o.type === "error") {
      return { applied: false, files: [], error: typeof o.message === "string" ? o.message : "apply failed" };
    }
    return { applied: false, files: [], error: "unparseable apply output" };
  } catch {
    return { applied: false, files: [], error: "unparseable apply output" };
  }
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter patchwire-desktop test src/lib/chat-session.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/lib/chat-session.ts packages/desktop/src/lib/chat-session.test.ts
git commit -m "feat(desktop): pure chat-session reducer and apply-result parser"
```

---

### Task 4: Rust `start_chat` / `cancel_chat` / `apply_patch` commands

**Files:**
- Modify: `packages/desktop/src-tauri/src/lib.rs`

> Mirror the existing `start_provision` streaming pattern (busy `AtomicBool` + `Mutex<Option<CommandChild>>` in a managed state struct; spawn sidecar; stream `CommandEvent::Stdout` → `app.emit`; on `Terminated` clear state + emit end). The sidecar MUST run with `current_dir` set to the project's local folder. Verify the tauri-plugin-shell `Command` builder exposes `.current_dir(PathBuf)` (Tauri v2 it does); if the exact method name differs, use the shell plugin's equivalent. No Rust unit tests (repo convention) — verified by compile + the app run in Task 8.

- [ ] **Step 1: Add a `ChatState` managed struct and register it**

Near the existing `ProvisionState`:
```rust
#[derive(Default)]
struct ChatState {
    busy: std::sync::atomic::AtomicBool,
    child: std::sync::Mutex<Option<tauri_plugin_shell::process::CommandChild>>,
}
```
In the builder (where `.manage(ProvisionState::default())` is, or add a `.manage(...)` call):
```rust
.manage(ChatState::default())
```

- [ ] **Step 2: Add the `start_chat` command**

```rust
#[tauri::command]
async fn start_chat(
    app: tauri::AppHandle,
    state: tauri::State<'_, ChatState>,
    project_dir: String,
    session_uuid: String,
    prompt: String,
) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    use tauri_plugin_shell::ShellExt;
    use tauri_plugin_shell::process::CommandEvent;
    use tauri::Emitter;

    if project_dir.trim().is_empty() { return Err("project_dir is required".into()); }
    if !std::path::Path::new(&project_dir).is_dir() { return Err("project_dir does not exist".into()); }
    if session_uuid.trim().is_empty() { return Err("session_uuid is required".into()); }
    if prompt.trim().is_empty() { return Err("prompt is required".into()); }

    if state.busy.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return Err("a chat turn is already in progress".into());
    }

    let sidecar = match app.shell().sidecar("patchwire") {
        Ok(c) => c,
        Err(e) => { state.busy.store(false, Ordering::SeqCst); return Err(e.to_string()); }
    };

    let (mut rx, child) = match sidecar
        .current_dir(std::path::PathBuf::from(&project_dir))
        .args(["chat", "--session", &session_uuid, "--json", &prompt])
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
                    if !line.is_empty() {
                        let _ = app.emit("pw://chat", line);
                    }
                }
                CommandEvent::Terminated(p) => {
                    if let Some(st) = app.try_state::<ChatState>() {
                        *st.child.lock().unwrap() = None;
                        st.busy.store(false, Ordering::SeqCst);
                    }
                    let _ = app.emit("pw://chat-end", p.code);
                }
                _ => {}
            }
        }
    });
    Ok(())
}
```

- [ ] **Step 3: Add the `cancel_chat` command**

```rust
#[tauri::command]
fn cancel_chat(state: tauri::State<'_, ChatState>) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    if let Some(child) = state.child.lock().unwrap().take() {
        let _ = child.kill();
    }
    state.busy.store(false, Ordering::SeqCst);
    Ok(())
}
```

- [ ] **Step 4: Add the `apply_patch` command**

Writes the streamed patch to `<project_dir>/.patchwire/desktop.patch`, then runs `apply --yes --json <path>` non-interactively in the project dir, returning the CLI's JSON result line (frontend parses it via `parseApplyResult`).
```rust
#[tauri::command]
async fn apply_patch(
    app: tauri::AppHandle,
    project_dir: String,
    patch: String,
) -> Result<String, String> {
    use tauri_plugin_shell::ShellExt;
    if project_dir.trim().is_empty() { return Err("project_dir is required".into()); }
    if !std::path::Path::new(&project_dir).is_dir() { return Err("project_dir does not exist".into()); }

    let pw_dir = std::path::Path::new(&project_dir).join(".patchwire");
    std::fs::create_dir_all(&pw_dir).map_err(|e| e.to_string())?;
    let patch_path = pw_dir.join("desktop.patch");
    std::fs::write(&patch_path, &patch).map_err(|e| e.to_string())?;

    let sidecar = app.shell().sidecar("patchwire").map_err(|e| e.to_string())?;
    let output = sidecar
        .current_dir(std::path::PathBuf::from(&project_dir))
        .args(["apply", "--yes", "--json", &patch_path.to_string_lossy()])
        .output()
        .await
        .map_err(|e| e.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    // Return the last non-empty line (the JSON result line).
    let line = stdout.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("").to_string();
    if line.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("apply produced no result: {stderr}"));
    }
    Ok(line)
}
```

- [ ] **Step 5: Register the three commands in `generate_handler!`**

Add `start_chat, cancel_chat, apply_patch` to the existing handler list (keep all P1 commands). The full list becomes:
```rust
.invoke_handler(tauri::generate_handler![
    start_provision, send_consent, save_host, list_hosts, delete_host,
    host_health, host_uninstall, host_logs,
    read_connection, save_connection, list_projects, save_project,
    start_chat, cancel_chat, apply_patch
])
```

- [ ] **Step 6: Verify it compiles**

Run (from `packages/desktop`, with the Rust toolchain on PATH; stage the sidecar first so the build script's resource path resolves): `pnpm stage-sidecar && cargo check --manifest-path src-tauri/Cargo.toml`
Expected: compiles (warnings OK). If `cargo`/sidecar staging is unavailable in your environment, report DONE_WITH_CONCERNS and note compilation must be verified on the dev Mac.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src-tauri/src/lib.rs
git commit -m "feat(desktop): rust start_chat/cancel_chat/apply_patch sidecar commands"
```

---

### Task 5: IPC wrappers for chat + apply (TDD)

**Files:**
- Modify: `packages/desktop/src/lib/ipc.ts`
- Modify: `packages/desktop/src/lib/ipc.test.ts`

> The event subscription uses `listen` from `@tauri-apps/api/event`. Mock both `@tauri-apps/api/core` (already mocked in this file) and `@tauri-apps/api/event`. Declare all mock fns with `vi.hoisted(() => vi.fn())` (established P1 pattern).

- [ ] **Step 1: Add failing tests to `src/lib/ipc.test.ts`**

At the top, alongside the existing core mock, add (and keep existing mocks):
```ts
const listenMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));
```
Add imports:
```ts
import { startChat, cancelChat, applyPatch, onChatEvent } from "./ipc";
```
Add the describe block:
```ts
describe("startChat", () => {
  it("invokes start_chat with project dir, session uuid, and prompt", async () => {
    invokeMock.mockResolvedValue(undefined);
    await startChat("/home/r/api", "uuid-1", "add retry");
    expect(invokeMock).toHaveBeenCalledWith("start_chat", {
      projectDir: "/home/r/api",
      sessionUuid: "uuid-1",
      prompt: "add retry",
    });
  });
});

describe("cancelChat", () => {
  it("invokes cancel_chat", async () => {
    invokeMock.mockResolvedValue(undefined);
    await cancelChat();
    expect(invokeMock).toHaveBeenCalledWith("cancel_chat");
  });
});

describe("applyPatch", () => {
  it("invokes apply_patch and parses the JSON result line", async () => {
    invokeMock.mockResolvedValue('{"type":"result","applied":true,"files":["a.ts"]}');
    const r = await applyPatch("/home/r/api", "PATCH");
    expect(invokeMock).toHaveBeenCalledWith("apply_patch", { projectDir: "/home/r/api", patch: "PATCH" });
    expect(r).toEqual({ applied: true, files: ["a.ts"] });
  });
});

describe("onChatEvent", () => {
  it("subscribes to pw://chat, forwards parsed events, and returns the unlisten handle", async () => {
    const unlisten = vi.fn();
    let captured: ((e: { payload: string }) => void) | null = null;
    listenMock.mockImplementation((name: string, cb: (e: { payload: string }) => void) => {
      if (name === "pw://chat") captured = cb;
      return Promise.resolve(unlisten);
    });
    const seen: unknown[] = [];
    const stop = await onChatEvent((ev) => seen.push(ev));
    captured!({ payload: '{"type":"chat_text","chunk":"hi"}' });
    captured!({ payload: "blank-ignored-not-json" });
    expect(seen).toEqual([{ type: "chat_text", chunk: "hi" }]); // unparseable line dropped
    expect(typeof stop).toBe("function");
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter patchwire-desktop test src/lib/ipc.test.ts`
Expected: FAIL — new exports not found.

- [ ] **Step 3: Add wrappers to `src/lib/ipc.ts`**

Add imports near the top:
```ts
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { parseChatLine, type ChatEvent } from "./chat-events";
import { parseApplyResult, type ApplyResult } from "./chat-session";
```
Add the functions:
```ts
export async function startChat(projectDir: string, sessionUuid: string, prompt: string): Promise<void> {
  await invoke("start_chat", { projectDir, sessionUuid, prompt });
}

export async function cancelChat(): Promise<void> {
  await invoke("cancel_chat");
}

export async function applyPatch(projectDir: string, patch: string): Promise<ApplyResult> {
  const line = await invoke<string>("apply_patch", { projectDir, patch });
  return parseApplyResult(line);
}

export async function onChatEvent(handler: (ev: ChatEvent) => void): Promise<UnlistenFn> {
  return listen<string>("pw://chat", (e) => {
    const ev = parseChatLine(e.payload);
    if (ev) handler(ev);
  });
}
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter patchwire-desktop test src/lib/ipc.test.ts`
Expected: PASS (existing ipc tests still green + new ones).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/lib/ipc.ts packages/desktop/src/lib/ipc.test.ts
git commit -m "feat(desktop): IPC wrappers for chat streaming and apply"
```

---

### Task 6: ChangesPanel component (TDD)

**Files:**
- Create: `packages/desktop/src/components/ChangesPanel.svelte`
- Test: `packages/desktop/src/components/ChangesPanel.test.ts`

- [ ] **Step 1: Write the failing test `src/components/ChangesPanel.test.ts`**

```ts
import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi } from "vitest";
import ChangesPanel from "./ChangesPanel.svelte";
import type { PendingDiff } from "../lib/chat-session";

const diff: PendingDiff = {
  patch: "diff --git a/src/upload.ts b/src/upload.ts\n@@ -1 +1,2 @@\n-old\n+new\n+more",
  files: [{ path: "src/upload.ts", status: "M", additions: 2, deletions: 1 }],
};

describe("ChangesPanel", () => {
  it("renders a file row with additions/deletions", () => {
    const { getByTestId } = render(ChangesPanel, { props: { diff } });
    expect(getByTestId("changes-summary").textContent).toContain("1 file");
    expect(getByTestId("file-src/upload.ts").textContent).toContain("+2");
    expect(getByTestId("file-src/upload.ts").textContent).toContain("−1");
  });
  it("fires onapply and onreject", async () => {
    const onapply = vi.fn();
    const onreject = vi.fn();
    const { getByTestId } = render(ChangesPanel, { props: { diff, onapply, onreject } });
    await fireEvent.click(getByTestId("apply-btn"));
    await fireEvent.click(getByTestId("reject-btn"));
    expect(onapply).toHaveBeenCalled();
    expect(onreject).toHaveBeenCalled();
  });
  it("shows an empty state when diff is null", () => {
    const { getByTestId } = render(ChangesPanel, { props: { diff: null } });
    expect(getByTestId("changes-empty").textContent).toContain("No changes yet");
  });
  it("disables the apply button while applying", () => {
    const { getByTestId } = render(ChangesPanel, { props: { diff, applying: true } });
    expect((getByTestId("apply-btn") as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter patchwire-desktop test src/components/ChangesPanel.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write `src/components/ChangesPanel.svelte`**

```svelte
<script lang="ts">
  import type { PendingDiff } from "../lib/chat-session";

  let {
    diff,
    applying = false,
    onapply,
    onreject,
  }: {
    diff: PendingDiff | null;
    applying?: boolean;
    onapply?: () => void;
    onreject?: () => void;
  } = $props();
</script>

{#if diff}
  <div class="head">
    <span class="summary" data-testid="changes-summary">
      {diff.files.length} file{diff.files.length === 1 ? "" : "s"}
    </span>
    <span class="actions">
      <button class="ghost" data-testid="reject-btn" disabled={applying} onclick={() => onreject?.()}>Reject</button>
      <button class="primary" data-testid="apply-btn" disabled={applying} onclick={() => onapply?.()}>
        {applying ? "Applying…" : "Apply"}
      </button>
    </span>
  </div>

  <div class="files">
    {#each diff.files as f (f.path)}
      <div class="file" data-testid="file-{f.path}">
        <span class="path mono">{f.path}</span>
        <span class="counts"><span class="add">+{f.additions}</span> <span class="del">−{f.deletions}</span></span>
      </div>
    {/each}
  </div>

  <pre class="patch mono" data-testid="patch-text">{diff.patch}</pre>
{:else}
  <div class="empty" data-testid="changes-empty">
    <p>No changes yet</p>
    <p class="sub">Ask Claude to make a change; the diff shows up here for review.</p>
  </div>
{/if}

<style>
  .head { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; border-bottom: 1px solid var(--border); }
  .summary { font-size: 12px; color: var(--text-muted); }
  .actions { display: flex; gap: 8px; }
  .ghost { background: var(--surface-raised); color: var(--text); padding: 6px 12px; font-size: 12px; }
  .primary { background: var(--accent-strong); color: #fff; padding: 6px 12px; font-size: 12px; font-weight: 600; }
  .primary:disabled, .ghost:disabled { opacity: 0.5; cursor: not-allowed; }
  .files { padding: 8px 16px; }
  .file { display: flex; align-items: center; justify-content: space-between; padding: 5px 0; font-size: 12px; }
  .counts .add { color: var(--ok); }
  .counts .del { color: var(--error); }
  .patch { margin: 0 16px 16px; padding: 10px 12px; background: var(--surface-base); border: 1px solid var(--border); border-radius: var(--radius-sm); font-size: 11px; overflow: auto; max-height: 40vh; white-space: pre; }
  .empty { text-align: center; color: var(--text-muted); padding: 48px 20px; }
  .empty .sub { font-size: 12px; }
</style>
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter patchwire-desktop test src/components/ChangesPanel.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/components/ChangesPanel.svelte packages/desktop/src/components/ChangesPanel.test.ts
git commit -m "feat(desktop): ChangesPanel diff review component"
```

---

### Task 7: ChatPane component (TDD)

**Files:**
- Create: `packages/desktop/src/components/ChatPane.svelte`
- Test: `packages/desktop/src/components/ChatPane.test.ts`

- [ ] **Step 1: Write the failing test `src/components/ChatPane.test.ts`**

```ts
import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi } from "vitest";
import ChatPane from "./ChatPane.svelte";
import type { ChatMessage } from "../lib/chat-session";

const messages: ChatMessage[] = [
  { role: "user", text: "add retry" },
  { role: "assistant", text: "Done — see the diff." },
];

describe("ChatPane", () => {
  it("renders user and assistant messages", () => {
    const { getAllByTestId } = render(ChatPane, { props: { messages, streaming: false, syncing: false } });
    const bubbles = getAllByTestId("bubble");
    expect(bubbles).toHaveLength(2);
    expect(bubbles[0].textContent).toContain("add retry");
    expect(bubbles[1].textContent).toContain("Done");
  });

  it("shows a syncing indicator when syncing", () => {
    const { getByTestId } = render(ChatPane, { props: { messages, streaming: true, syncing: true } });
    expect(getByTestId("sync-indicator").textContent).toContain("Syncing");
  });

  it("fires onsend with the composer text and clears it", async () => {
    const onsend = vi.fn();
    const { getByTestId } = render(ChatPane, { props: { messages: [], streaming: false, syncing: false, onsend } });
    const input = getByTestId("composer") as HTMLTextAreaElement;
    await fireEvent.input(input, { target: { value: "fix the bug" } });
    await fireEvent.click(getByTestId("send-btn"));
    expect(onsend).toHaveBeenCalledWith("fix the bug");
  });

  it("disables send while streaming and shows Stop", async () => {
    const oncancel = vi.fn();
    const { getByTestId } = render(ChatPane, { props: { messages, streaming: true, syncing: false, oncancel } });
    expect((getByTestId("send-btn") as HTMLButtonElement).disabled).toBe(true);
    await fireEvent.click(getByTestId("stop-btn"));
    expect(oncancel).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter patchwire-desktop test src/components/ChatPane.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write `src/components/ChatPane.svelte`**

```svelte
<script lang="ts">
  import type { ChatMessage } from "../lib/chat-session";

  let {
    messages,
    streaming,
    syncing,
    onsend,
    oncancel,
  }: {
    messages: ChatMessage[];
    streaming: boolean;
    syncing: boolean;
    onsend?: (text: string) => void;
    oncancel?: () => void;
  } = $props();

  let draft = $state("");

  function send() {
    const text = draft.trim();
    if (!text || streaming) return;
    onsend?.(text);
    draft = "";
  }
</script>

<div class="messages" data-testid="messages">
  {#each messages as m, i (i)}
    <div class="bubble {m.role}" data-testid="bubble">{m.text}</div>
  {/each}
  {#if syncing}
    <div class="sync" data-testid="sync-indicator">⇅ Syncing…</div>
  {/if}
</div>

<div class="composer-bar">
  <textarea
    class="composer"
    data-testid="composer"
    bind:value={draft}
    placeholder="Ask Claude to change something…"
    rows="2"
  ></textarea>
  {#if streaming}
    <button class="stop" data-testid="stop-btn" onclick={() => oncancel?.()}>Stop</button>
  {/if}
  <button class="send" data-testid="send-btn" disabled={streaming || draft.trim() === ""} onclick={send}>Send</button>
</div>

<style>
  .messages { flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
  .bubble { padding: 8px 11px; border-radius: 10px; max-width: 80%; line-height: 1.45; font-size: 13px; white-space: pre-wrap; }
  .bubble.user { background: var(--accent-bg); align-self: flex-end; }
  .bubble.assistant { background: var(--surface-raised); border: 1px solid var(--border); align-self: flex-start; }
  .sync { font-size: 11px; color: var(--warn); align-self: flex-start; }
  .composer-bar { display: flex; gap: 8px; align-items: flex-end; padding: 10px 14px; border-top: 1px solid var(--border); }
  .composer { flex: 1; resize: none; }
  .send { background: var(--accent-strong); color: #fff; padding: 8px 14px; font-weight: 600; }
  .send:disabled { opacity: 0.5; cursor: not-allowed; }
  .stop { background: var(--surface-raised); color: var(--text); padding: 8px 14px; }
</style>
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter patchwire-desktop test src/components/ChatPane.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/components/ChatPane.svelte packages/desktop/src/components/ChatPane.test.ts
git commit -m "feat(desktop): ChatPane streaming conversation component"
```

---

### Task 8: Workspace screen + App routing (TDD, then live verification)

**Files:**
- Create: `packages/desktop/src/screens/Workspace.svelte`
- Test: `packages/desktop/src/screens/Workspace.test.ts`
- Modify: `packages/desktop/src/App.svelte`
- Modify: `packages/desktop/src/App.test.ts`

> Workspace owns a `ChatState` (via `initChatState`/`startTurn`/`applyChatEvent`), subscribes to chat events on mount, and drives the split layout (ChatPane left, ChangesPanel right). It generates a session uuid once per open via `crypto.randomUUID()`.

- [ ] **Step 1: Write the failing test `src/screens/Workspace.test.ts`**

```ts
import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import Workspace from "./Workspace.svelte";
import type { Project } from "../lib/types";

const project: Project = {
  id: "a", name: "api-server", branch: "main",
  localPath: "/home/r/api", remotePath: "/remote/api",
  lastStatus: "in-sync", syncPaused: false,
};

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
  listenMock.mockResolvedValue(() => {});
});

describe("Workspace", () => {
  it("renders the project header and a back control", () => {
    const onback = vi.fn();
    const { getByTestId } = render(Workspace, { props: { project, onback } });
    expect(getByTestId("ws-title").textContent).toContain("api-server");
  });

  it("sending a prompt starts a chat turn via IPC with the project dir", async () => {
    invokeMock.mockResolvedValue(undefined);
    const { getByTestId } = render(Workspace, { props: { project } });
    await fireEvent.input(getByTestId("composer"), { target: { value: "add retry" } });
    await fireEvent.click(getByTestId("send-btn"));
    expect(invokeMock).toHaveBeenCalledWith("start_chat", expect.objectContaining({
      projectDir: "/home/r/api",
      prompt: "add retry",
    }));
    // user + assistant bubbles appear
    expect(getByTestId("messages").textContent).toContain("add retry");
  });

  it("subscribes to chat events on mount", () => {
    render(Workspace, { props: { project } });
    expect(listenMock).toHaveBeenCalledWith("pw://chat", expect.any(Function));
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter patchwire-desktop test src/screens/Workspace.test.ts`
Expected: FAIL — component not found.

- [ ] **Step 3: Write `src/screens/Workspace.svelte`**

```svelte
<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import type { Project } from "../lib/types";
  import {
    initChatState, startTurn, applyChatEvent, type ChatState,
  } from "../lib/chat-session";
  import { startChat, cancelChat, applyPatch, onChatEvent } from "../lib/ipc";
  import ChatPane from "../components/ChatPane.svelte";
  import ChangesPanel from "../components/ChangesPanel.svelte";
  import type { UnlistenFn } from "@tauri-apps/api/event";

  let { project, onback }: { project: Project; onback?: () => void } = $props();

  let chat = $state<ChatState>(initChatState(crypto.randomUUID()));
  let applying = $state(false);
  let unlisten: UnlistenFn | null = null;

  onMount(async () => {
    unlisten = await onChatEvent((ev) => {
      chat = applyChatEvent(chat, ev);
    });
  });
  onDestroy(() => unlisten?.());

  async function send(text: string) {
    chat = startTurn(chat, text);
    try {
      await startChat(project.localPath, chat.sessionUuid, text);
    } catch (e) {
      chat = applyChatEvent(chat, { type: "error", code: "ipc", message: String(e), recoverable: false });
    }
  }

  async function cancel() {
    await cancelChat();
    chat = applyChatEvent(chat, { type: "cancelled" });
  }

  async function apply() {
    if (!chat.diff) return;
    applying = true;
    try {
      const result = await applyPatch(project.localPath, chat.diff.patch);
      if (result.applied) chat = { ...chat, diff: null };
      else chat = applyChatEvent(chat, { type: "error", code: "apply", message: result.error ?? "apply failed", recoverable: true });
    } finally {
      applying = false;
    }
  }

  function reject() {
    chat = { ...chat, diff: null };
  }
</script>

<div class="ws">
  <header class="ws-head">
    <button class="back" data-testid="ws-back" onclick={() => onback?.()}>←</button>
    <span class="title" data-testid="ws-title">{project.name} <span class="branch">{project.branch}</span></span>
  </header>

  {#if chat.error}
    <div class="error" role="alert" data-testid="ws-error">{chat.error}</div>
  {/if}

  <div class="split">
    <section class="left">
      <ChatPane messages={chat.messages} streaming={chat.streaming} syncing={chat.syncing} onsend={send} oncancel={cancel} />
    </section>
    <section class="right">
      <ChangesPanel diff={chat.diff} {applying} onapply={apply} onreject={reject} />
    </section>
  </div>
</div>

<style>
  .ws { display: flex; flex-direction: column; height: 100%; }
  .ws-head { display: flex; align-items: center; gap: 12px; padding: 12px 16px; border-bottom: 1px solid var(--border); }
  .back { background: var(--surface-raised); color: var(--text); padding: 4px 10px; }
  .title { font-weight: 600; }
  .branch { color: var(--text-muted); font-weight: 400; font-size: 12px; margin-left: 6px; }
  .error { color: var(--error); padding: 8px 16px; font-size: 13px; }
  .split { flex: 1; display: flex; min-height: 0; }
  .left { width: 50%; display: flex; flex-direction: column; border-right: 1px solid var(--border); min-height: 0; }
  .right { width: 50%; display: flex; flex-direction: column; min-height: 0; overflow-y: auto; }
</style>
```

- [ ] **Step 4: Run test, verify pass**

Run: `pnpm --filter patchwire-desktop test src/screens/Workspace.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire Workspace into `src/App.svelte`**

Update the routing: when a project is `opened`, render `Workspace`; its `onback` clears `opened`. Replace the App template/script so the `opened` state from P1 now drives a real route. Full updated `App.svelte`:
```svelte
<script lang="ts">
  import "./styles/tokens.css";
  import { onMount } from "svelte";
  import { connection, projects, route, loadConnection, loadProjects } from "./lib/stores";
  import Connect from "./screens/Connect.svelte";
  import Projects from "./screens/Projects.svelte";
  import Workspace from "./screens/Workspace.svelte";
  import AddProjectDialog from "./components/AddProjectDialog.svelte";
  import type { Connection, Project } from "./lib/types";

  let adding = $state(false);
  let opened = $state<Project | null>(null);

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
  {:else if opened}
    <Workspace project={opened} onback={() => (opened = null)} />
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

- [ ] **Step 6: Update `src/App.test.ts`**

Keep the two P1 routing tests and add one: opening a project shows the Workspace. Add `listen` mock (Workspace subscribes on mount) and a project in the store:
```ts
import { render, fireEvent } from "@testing-library/svelte";
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());
const listenMock = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: listenMock }));

import App from "./App.svelte";
import { connection, projects } from "./lib/stores";

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
  listenMock.mockResolvedValue(() => {});
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

  it("opens the Workspace when a project row is clicked", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_connection") return Promise.resolve({ host: "h", user: "u", sshPort: 22, keyPath: "/k", agentPort: 7878 });
      if (cmd === "list_projects") return Promise.resolve([
        { id: "a", name: "api-server", branch: "main", localPath: "/l/a", remotePath: "/r/a", lastStatus: "in-sync", syncPaused: false },
      ]);
      return Promise.resolve(undefined);
    });
    const { findByTestId } = render(App);
    const row = await findByTestId("row");
    await fireEvent.click(row);
    expect((await findByTestId("ws-title")).textContent).toContain("api-server");
  });
});
```

- [ ] **Step 7: Run the full suite, verify pass**

Run: `pnpm --filter patchwire-desktop test`
Expected: ALL tests pass (P1 + the new P2 tests).

- [ ] **Step 8: Manual end-to-end verification (best effort)**

Run (from `packages/desktop`, Rust toolchain on PATH): `pnpm stage-sidecar && pnpm tauri dev`. Verify by observation against a reachable, already-configured project (one with a `patchwire.yml`):
1. Open a project → split workspace (chat left, empty Changes right).
2. Type a prompt → user bubble appears, assistant streams text, sync indicator shows during sync.
3. When Claude finishes, the diff appears in the Changes panel (file list + patch text).
4. **Apply** applies the patch to the local folder (verify the file changed) and clears the panel; **Reject** clears it without applying.
5. **Stop** during streaming cancels the turn.
6. Back returns to the Projects list.

If the environment lacks the Rust toolchain / a reachable agent, document which steps could not be verified (do not fake results). Note the assumption: a project must already be patchwire-initialized (`patchwire.yml` present) — the in-app setup wizard is P4; surface CLI errors in the workspace error bar until then.

- [ ] **Step 9: Commit**

```bash
git add packages/desktop/src/screens/Workspace.svelte packages/desktop/src/screens/Workspace.test.ts packages/desktop/src/App.svelte packages/desktop/src/App.test.ts
git commit -m "feat(desktop): project Workspace (split chat + diff + apply) and routing"
```

---

## Self-Review

**Spec coverage (P2 portions):**
- Split workspace (chat left, Changes/diff right) → Tasks 6, 7, 8. ✓
- Chat session via `/chat`, streamed token-by-token → Tasks 2, 3, 4, 5, 7. ✓
- Diff lands in Changes panel; Apply / Reject → Tasks 1, 4, 5, 6, 8. ✓
- Sync status shown during a turn (sync_start/sync_done from the chat stream) → Tasks 3, 7. ✓ (Dedicated per-project sync supervision + pause/resume is P3.)
- Apply via `patchwire apply` (non-interactive) → Task 1 (CLI seam) + Task 4 (`apply_patch`). ✓
- Errors (session fail, apply fail) surfaced in the workspace error bar → Tasks 3, 8. ✓
- Sidecar runs with `current_dir` = project local folder → Task 4. ✓
- Out of scope for P2 (per-project sync pause/resume, setup wizard, settings, multi-session persistence, fancy side-by-side diff) → P3–P5. ✓

**Placeholder scan:** No TBD/TODO. The CLI apply task (Task 1) intentionally instructs reading `patch.ts` to use the real non-interactive primitive — its interface, behavior, JSON shapes, and tests are fully specified; only the internal helper name is resolved by reading, because that file's internals are not quoted here.

**Type consistency:** `ChatEvent`/`ChangedFile` defined once in `chat-events.ts` (Task 2), consumed by `chat-session.ts` (Task 3), `ipc.ts` (Task 5), and components (6–8). `ChatState`/`ChatMessage`/`PendingDiff`/`ApplyResult` defined once in `chat-session.ts` and reused unchanged. IPC command names (`start_chat`, `cancel_chat`, `apply_patch`) match between Rust (Task 4), TS wrappers (Task 5), and component/screen tests (Tasks 5, 8). Event channel name `pw://chat` matches between Rust emit (Task 4) and `onChatEvent` (Task 5). `parseApplyResult` shape matches the `apply --json` output defined in Task 1.

## Follow-on (P3+)
- **P3** Sync: dedicated supervised per-project `patchwire sync --json`, status pills on the landing, pause/resume, conflict surfacing (P2 only shows sync status incidental to a chat turn).
- **P4** Onboarding/setup wizard (so newly added folders get a `patchwire.yml`) + Settings; until then the Workspace surfaces CLI "not configured" errors in its error bar.
- **P5** Diff polish (per-file collapse, syntax/line coloring), motion, accessibility, multi-session persistence.
