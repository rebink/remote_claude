# Desktop: computer-name remote-path namespace + folder-exists overwrite prompt

**Date:** 2026-06-17
**Status:** Approved design, ready for plan
**Relates to:** commit `5501a9f` (namespace remote path by SSH user — this supersedes that segment), `packages/extension/src/setup/SetupWizard.ts` (the `target_exists` overwrite UX being mirrored).

---

## Problem

Two changes to the desktop **Add Project** flow (`packages/desktop/src/screens/AddProject.svelte`):

1. **Path namespace.** The auto remote path is currently `~/patchwire/<sshUser>/<project>` (`AddProject.svelte:28`, `${chosen.user}`). Use the **local machine's computer name** instead, e.g. `~/patchwire/Admin/CureocityApps`, falling back to the SSH user when the computer name can't be read.
2. **Overwrite prompt.** When the remote folder already exists, the desktop currently swallows the CLI's `target_exists` signal into a generic error. Mirror the VS Code extension: prompt **Overwrite / Use existing / Cancel** and re-run accordingly.

The CLI already supports everything needed: `init-remote` accepts `--overwrite`, `--use-existing`, `--json`, and emits a `{type:'step', status:'fail', code:'target_exists'}` NDJSON event (`packages/cli/src/commands/init-remote.ts`, `packages/cli/src/lib/bootstrap-snapshot.ts`). No CLI change.

## Decisions (from brainstorm)

| Topic | Decision |
|---|---|
| Name source | **Local machine computer name** — macOS `scutil --get ComputerName`; other OS hostname. Fallback to SSH user when unreadable/empty. |
| Overwrite UX | **3-way, mirror the extension:** Overwrite (rm -rf + re-push) / Use existing (skip copy) / Cancel. |
| Overwrite surface | **In-app Svelte modal** (not a native OS dialog — native can't do 3 buttons cleanly and a Svelte modal is unit-testable and matches the dark-indigo UI). |
| Parsing | Pure JS parser of the `--json` NDJSON stream (testable), mirroring `SetupWizard.ts`. |

## Architecture

### A. Local computer name

**Rust — `computer_name` Tauri command** (`packages/desktop/src-tauri/src/lib.rs`, registered in `invoke_handler`):
- macOS (`#[cfg(target_os = "macos")]`): run `scutil --get ComputerName`, trim stdout. On failure fall through to hostname.
- Other OS: hostname via `std::env::var("COMPUTERNAME")` (Windows) or the `hostname` crate / `gethostname` (Unix). Keep it simple — return whatever the platform gives.
- Returns `Result<String, String>`. The friendly name may contain spaces/punctuation; sanitization is done JS-side.

**JS — `lib/slug.ts` `slugifySegment(name: string): string`** (pure, tested):
- Trim; replace runs of whitespace with `-`; drop any char outside `[A-Za-z0-9._-]`; collapse repeated `-`; trim leading/trailing `-._`. Return `""` if nothing usable remains.
- Examples: `"Admin"` → `"Admin"`; `"Apple's MacBook Pro"` → `"Apples-MacBook-Pro"`; `"   "` → `""`; `"💻"` → `""`.

**JS — `ipc.ts` `computerName(): Promise<string>`**: `invoke<string>("computer_name")`, return `""` on reject (so the caller falls back).

**`AddProject.svelte`**:
- `let computer = $state("")`; on mount `computerName().then(v => computer = v)`.
- In `choose()`: `const seg = slugifySegment(computer) || chosen.user; remotePath = \`~/patchwire/${seg}/${name}\`;`
- The remote-path input stays editable (unchanged), so the user can still override.

### B. Overwrite prompt

**Rust — extend `init_remote_copy`** to `init_remote_copy(project_dir, remote_path, mode)` where `mode: "create" | "overwrite" | "use_existing"`:
- Always append `--json`. Append `--overwrite` when `mode == "overwrite"`, `--use-existing` when `mode == "use_existing"`.
- Return the **full stdout** (NDJSON) to JS regardless of exit code (the `target_exists` case exits non-zero but its signal is on stdout). Only `Err` on spawn failure / non-existent `project_dir`.
- (Today's signature is `(project_dir, remote_path)` with no `--json`; this replaces it.)

**JS — `lib/init-remote-events.ts` `parseInitRemoteResult(stdout: string): InitRemoteResult`** (pure, tested):
```ts
export type InitRemoteResult =
  | { ok: true }
  | { ok: false; code: 'target_exists' }
  | { ok: false; code: string; stderr?: string };
```
- Split stdout into lines; JSON.parse each (skip non-JSON lines). Track the last `{type:'step', status:'fail', code, stderr}` and whether a `{type:'done', ok:true}` arrived.
- If `done.ok === true` → `{ok:true}`. Else if last fail code is `'target_exists'` → `{ok:false, code:'target_exists'}`. Else `{ok:false, code: lastFailCode ?? 'unknown_error', stderr}`.

**JS — `ipc.ts` `initRemoteCopy(projectDir, remotePath, mode: InitRemoteMode = 'create'): Promise<InitRemoteResult>`**: invoke `init_remote_copy` with `{ projectDir, remotePath, mode }`, return `parseInitRemoteResult(stdout)`. (Signature changes from `Promise<string>` — update the single caller in AddProject.)

**`AddProject.svelte` flow**:
- New state: `let existsPrompt = $state(false)`.
- Refactor the copy step into `runCopy(mode: InitRemoteMode)`:
  - `phase = "Copying to remote…"`; `const r = await initRemoteCopy(localPath, remotePath, mode)`.
  - `r.ok` → continue to `syncCommand` + `saveProject` + `onfinish()`.
  - `r.code === 'target_exists'` → `existsPrompt = true; busy = false;` and return (await user choice).
  - other → `error = ...`.
- `create()` calls `runCopy('create')` (after `writeProjectYml`).
- Modal (shown when `existsPrompt`): title "`{remotePath}` already exists on the remote." Buttons:
  - **Overwrite (rm -rf + re-push)** → `existsPrompt=false; busy=true; runCopy('overwrite')`.
  - **Use existing (skip copy)** → `existsPrompt=false; busy=true; runCopy('use_existing')`.
  - **Cancel** → `existsPrompt=false; error="Cancelled: target exists on remote."`.
- `data-testid`s: `exists-modal`, `exists-overwrite`, `exists-use-existing`, `exists-cancel` (for tests).

> Note: `writeProjectYml` runs once in `create()` before the first `runCopy`; re-running `runCopy` with a new mode does not rewrite the yml (the remote path is unchanged), matching the extension which re-invokes only the init-remote step.

## Testing

- `lib/slug.test.ts` — `slugifySegment`: plain name, spaces, apostrophe, leading/trailing junk, all-unicode → `""`, empty → `""`.
- `lib/init-remote-events.test.ts` — `parseInitRemoteResult`: success stream (`done ok:true`), `target_exists` fail stream, other fail code, mixed/non-JSON lines ignored.
- `screens/AddProject.test.ts` (extend) — mock `computerName` → assert `choose()` builds `~/patchwire/<slug>/<name>`; mock `computerName` reject → asserts fallback to `chosen.user`; mock `initRemoteCopy` returning `target_exists` → assert the modal shows; click Overwrite → assert `initRemoteCopy` re-called with `'overwrite'` and flow completes.
- Rust `computer_name` + `init_remote_copy` mode arg: **live-verify** (no Rust unit tests in this repo). Manual check: real Add Project against a fresh path (computer-name segment) and an existing path (each of the 3 choices).

## Out of scope

- Streaming rsync progress into the desktop (keep the existing `phase` strings).
- Any CLI change (already supports `--json`/`--overwrite`/`--use-existing`).
- Changing the SSH-user default anywhere except the AddProject auto-path (e.g. `lib/wizard.ts defaultRemotePath` is unrelated and untouched).
- Persisting/caching the computer name beyond the component lifetime.

## Build sequence (for the plan)

1. `lib/slug.ts` + tests.
2. `lib/init-remote-events.ts` + tests.
3. Rust: `computer_name` command + `init_remote_copy` `mode` param; register `computer_name` in `invoke_handler`.
4. `ipc.ts`: `computerName()`, `initRemoteCopy(..., mode)` returning `InitRemoteResult`.
5. `AddProject.svelte`: computer-name path build (fallback), `runCopy(mode)` refactor, exists modal; extend `AddProject.test.ts`.
