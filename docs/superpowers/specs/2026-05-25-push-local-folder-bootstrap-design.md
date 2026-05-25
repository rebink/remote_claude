# Remote Claude — Push-Local-Folder Bootstrap

> **Status:** Spec, awaiting plan stage.
> **Supersedes:** the git-URL bootstrap path in `2026-05-20-vscode-extension-v2-design.md` §Setup wizard Step 3. v2 stays in the repo for reference; this design replaces the bootstrap flow only.
> **Driving requirement:** keep the Mac Mini fully isolated from git remotes so commits made by other developers under the shared SSH account cannot leak to GitHub/GitLab.

---

## Problem statement

The v2 wizard's Step 3 takes a git URL and runs `git clone` on both the laptop and the Mac Mini. That establishes a `remote` named `origin` on the Mini pointing at the source URL. Two failure modes:

1. **Leaked code via accidental push.** Several developers share one SSH account on the Mini. A stray `git push` from that account (manual or scripted) sends the wrong dev's code to the wrong place under the wrong identity.
2. **Identity leakage in any commit made on the Mini.** Even if commits are local-only, the Mini's `~/.gitconfig` (likely set to a generic admin identity) is the author of those commits. If a patch round-trips, it carries the wrong author/email.

We also have developers whose repos live on private hosts the Mini can't reach.

The fix is to **stop cloning from a git URL on the Mini entirely.** The laptop is the only place that talks to git remotes. The Mini receives bytes via `rsync` and runs a local-only git repo purely for the diff/reset/rollback machinery that the agent's turn cycle needs.

---

## Goals

- Replace the git-URL bootstrap with a push-local-folder bootstrap.
- Guarantee, by construction, that the Mini's project directory has **zero** git remotes configured.
- Use a sandbox-only git identity (`Remote Claude (sandbox) <remote-claude@local>`) repo-locally so the Mini's global `~/.gitconfig` cannot pollute commit metadata.
- Preserve every other v2 behavior — diff cards, live sync, ask-time guard, reload reconciliation, etc.
- Keep wizard time-to-first-chat in the under-3-minute envelope set by v2.

## Non-goals

- A "pull from URL" bootstrap mode (intentionally removed, not just deprecated).
- Mid-flight rsync resumability across CLI invocations. A killed bootstrap is wipe-and-retry.
- Multi-laptop write into the same `~/workspace/<project>` directory. Two laptops pushing to the same project name clobber each other; spec assumes one laptop per project per dev (per the v2 multi-dev-isolation decision).
- A built-in pre-flight disk-space check on the Mini.
- Bootstrap via web UI without an SSH-capable local CLI.

---

## Locked decisions

| # | Decision |
|---|---|
| 1 | **Bootstrap source** is always the local working tree on the laptop. The git-URL path is removed from the wizard, the CLI, and the agent. |
| 2 | **`POST /init` is deleted.** No new agent endpoint replaces it. The CLI does everything over SSH using the per-project key established in Step 2. |
| 3 | **Sandbox git identity** on the Mini: `user.email=remote-claude@local`, `user.name=Remote Claude (sandbox)`, set with `git config --local` so the Mini's `~/.gitconfig` is never consulted. |
| 4 | **No git remotes ever.** The CLI's final step verifies `git remote -v` is empty on the Mini and refuses to finish if anything is configured. |
| 5 | **Rsync filter** uses `--filter=:- .gitignore` to honor the project's own ignore rules, matching what `SyncController` does for incremental syncs. |
| 6 | **Conflict on existing remote path** is surfaced as a modal with three choices: *Overwrite (rm -rf + re-push)*, *Use existing (skip mkdir+rsync, write config only)*, *Cancel*. |
| 7 | **CLI ↔ wizard protocol** is NDJSON over stdout via a new `--json` flag, matching the existing `chat` and `sync --json` patterns. |

---

## Architecture

```
┌─────── Laptop ────────┐                  ┌──── Mac Mini ────┐
│                       │                  │                  │
│  VS Code Extension    │                  │  agent (Fastify) │
│  ├─ SetupWizard       │                  │  /chat, /sync... │
│  │  └─ Step 3 (new)   │                  │  (unchanged)     │
│  │     └─ calls →     │  ssh + rsync     │                  │
│  ├─ CliClient ────────┼─────────────────►│  ~/workspace/    │
│  └─ SyncController    │                  │  └─ <project>/   │
│                       │                  │     ├─ .git/     │  ◄── local-only,
│                       │                  │     │  └─ no     │      no remote refs,
│                       │                  │     │     origin │      sandbox identity
│                       │                  │     └─ <files>   │
│                       │                  │                  │
└───────────────────────┘                  └──────────────────┘
```

Three changed components, no new ones:

- **CLI** — `init-remote --git-url` is replaced by `init-remote --from-local`. The new command opens an SSH connection using the per-project key and runs `mkdir`, `rsync`, `git init + sandbox identity + initial commit`.
- **Extension Step 3** — the git-URL form is replaced by a two-field form (local folder + project name, both auto-filled). The wizard shells out to `remote-claude init-remote --from-local --json` and parses the NDJSON stream.
- **Agent** — `POST /init` is deleted along with the `runInit` function and the `InitBody` schema. Nothing else in the agent changes.

### Safety invariants the architecture guarantees

- No code path in the laptop CLI or the agent ever calls `git remote add`, `git push`, `git fetch`, or `git clone` with a URL argument against the Mini.
- The Mini's git repo is initialized with `git init -q` followed immediately by `git config --local user.email/user.name`. The developer's `~/.gitconfig` on the Mini cannot leak into commits.
- A post-bootstrap `git remote -v` assertion (step 8 below) refuses to finish if any remote is configured. This is a defensive check — by construction the preceding steps cannot create one, but if a future code change ever does, the safety check trips.

---

## Wizard UX (Step 3)

The current Step 3 has four input fields (git URL, branch, project name, local path). The new Step 3 has **two**, both auto-filled:

```
┌──────────────────────────────────────────────────────────────┐
│  1. Pick host  ✓   2. Sign in  ✓   3. Push project  4. Verify │
├──────────────────────────────────────────────────────────────┤
│  Step 3 — Push your project to the Mac Mini                  │
│                                                              │
│  Local folder                                                │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ /Users/apple/Documents/my-flutter-app                  │  │
│  └────────────────────────────────────────────────────────┘  │
│  ℹ Defaults to your current VS Code workspace folder.        │
│                                                              │
│  Project name (folder on the Mac Mini)                       │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ my-flutter-app                                         │  │
│  └────────────────────────────────────────────────────────┘  │
│  ℹ Will be created at ~/workspace/my-flutter-app             │
│                                                              │
│  ⚠ The Mac Mini copy stays isolated from git — no remotes,   │
│    no pushes, no leaked identity. You commit only on the     │
│    laptop with your own git identity.                        │
│                                                              │
│              [ Back ]    [ Push & continue → ]              │
└──────────────────────────────────────────────────────────────┘
```

### Field rules

- **Local folder** — pre-filled with `vscode.workspace.workspaceFolders[0].uri.fsPath`. User can override. Must exist and be a directory.
- **Project name** — pre-filled with `basename(localFolder)`. Validated against `^[a-zA-Z0-9._-]+$` (no path traversal, no shell metachars — same regex `setup --project` already uses).
- **Pre-flight conflict on `~/workspace/<name>`** — if the directory exists on the Mini, the wizard surfaces a modal: *Overwrite* (rm -rf then re-bootstrap), *Use existing* (skip mkdir+rsync, just write `remote-claude.yml`), or *Cancel*.

### Progress feedback during the push

Rsync can take 10s–60s on real projects. The wizard shows a live progress line in the same place Step 2 already shows ssh-copy-id output:

```
  Pushing files…  3,421 files, 287 MB (rsync 67% — main.dart)
```

Driven by parsing rsync's `--info=progress2,stats1` output line-by-line.

### Error display

Same pattern as Step 2 today: failed bootstrap stays on Step 3 with a red error block showing the last 500 chars of stderr, plus a *Retry* button. Wizard state (host, user, folder, project name) is preserved across retry.

---

## CLI surface

### `remote-claude init-remote --from-local`

```
Usage: remote-claude init-remote [options]

Bootstrap a project on the remote Mac Mini by pushing the local working
tree. The remote copy is kept isolated from any git remote.

Required:
  --from-local            push the current working directory (the only mode)
  --project <name>        project directory name on the remote (^[a-zA-Z0-9._-]+$)

Optional:
  --host <host>           override host from remote-claude.yml
  --user <user>           override user from remote-claude.yml
  --ssh-port <n>          override SSH port (default: 22)
  --key-path <path>       per-project SSH key
                            (default: ~/.remote-claude/keys/<host>-<user>)
  --overwrite             if ~/workspace/<project> exists on the remote,
                          rm -rf it first
  --use-existing          if ~/workspace/<project> exists, skip mkdir + rsync
                          (config-only bootstrap)
  --json                  machine-readable progress stream
                          (used by the extension wizard)
```

The old `--git-url`, `--branch` flags are **removed**. `--from-local` is required and the only mode.

### Execution steps

| # | Step | Command | Failure code |
|---|---|---|---|
| 1 | Resolve config | Read `remote-claude.yml` for host/user/port if not overridden | `missing_config` |
| 2 | Check key exists | `stat ~/.remote-claude/keys/<host>-<user>` | `missing_key` |
| 3 | Probe remote dir | `ssh -i <key> <user>@<host> "test -d ~/workspace/<project>"` | If exists and neither `--overwrite` nor `--use-existing`: exit 4, `target_exists` |
| 4 | (if `--overwrite`) Wipe | `ssh ... "rm -rf ~/workspace/<project>"` | `wipe_failed` |
| 5 | Create directory | `ssh ... "mkdir -p ~/workspace/<project>"` | `mkdir_failed` |
| 6 | Rsync working tree | `rsync -a --delete --filter=:- .gitignore --info=progress2,stats1 -e "ssh -i <key> -p <port>" ./ <user>@<host>:~/workspace/<project>/` | `rsync_failed` |
| 7 | Init + sandbox identity | `ssh ... "cd ~/workspace/<project> && git init -q && git config --local user.email 'remote-claude@local' && git config --local user.name 'Remote Claude (sandbox)' && git add -A && git -c commit.gpgsign=false commit -q --allow-empty -m 'snapshot from laptop'"` | `git_init_failed` |
| 8 | Safety check | `ssh ... "cd ~/workspace/<project> && git remote -v"` — assert output is empty | `unsafe_state` |

### JSON mode (for the wizard)

`--json` emits NDJSON, one event per line:

```jsonl
{"type":"step","name":"probe","status":"start"}
{"type":"step","name":"probe","status":"ok"}
{"type":"step","name":"rsync","status":"start"}
{"type":"progress","stage":"rsync","files":3421,"bytes":300941312,"pct":67,"current":"lib/main.dart"}
{"type":"step","name":"rsync","status":"ok","duration_ms":24180}
{"type":"step","name":"git_init","status":"ok"}
{"type":"done","ok":true,"projectName":"my-flutter-app","remotePath":"~/workspace/my-flutter-app"}
```

On failure:

```jsonl
{"type":"step","name":"rsync","status":"fail","code":"rsync_failed","stderr":"...","exit":23}
{"type":"done","ok":false}
```

### Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | generic |
| 2 | invalid args |
| 3 | missing dependency (key, config) |
| 4 | target conflict (`~/workspace/<project>` exists) |
| 5 | ssh/rsync failure |
| 6 | safety check failed (git remote configured) |
| 130 | SIGINT/SIGTERM |

### Adjacent changes

- `remote-claude setup` — no change.
- `remote-claude doctor` — adds a new check: *Remote project has no git remotes configured.* If `git remote -v` on the Mini returns anything, doctor flags it red.
- `extension/src/setup/SetupWizard.ts` Step 3 — stops calling `runInit` (deleted) and stops doing a local `git clone`. Spawns `remote-claude init-remote --from-local --json` and parses NDJSON.

---

## Error handling

### Failure matrix

| Code | Detection | What the wizard shows | Recovery |
|---|---|---|---|
| `missing_config` | `remote-claude.yml` not readable | "No `remote-claude.yml` found. Restart the wizard from Step 1." | *Restart wizard* button |
| `missing_key` | `~/.remote-claude/keys/<host>-<user>` missing | "SSH key for `<host>` not installed. Re-run Step 2." | *Back to Step 2* button |
| `ssh_unreachable` | exit code from `ssh` step 3, stderr matches `Connection refused\|No route to host\|Connection timed out` | "Can't reach the Mac Mini. Check Tailscale and the agent." | *Retry*; *Back to Step 1* |
| `ssh_auth_failed` | stderr matches `Permission denied (publickey)` | "SSH key was rejected by the Mac Mini." | *Back to Step 2* |
| `target_exists` | step 3 probe returns 0 and neither override flag set | Modal: *Overwrite*, *Use existing*, *Cancel* | Modal returns user choice; CLI re-invoked |
| `wipe_failed` | non-zero exit on `rm -rf` | Friendly mapped message + collapsible stderr details | *Retry* |
| `mkdir_failed` | non-zero on `mkdir -p` | Same shape as wipe_failed | *Retry* |
| `rsync_failed` | non-zero on rsync; sub-categorized by stderr keywords (`disk quota`, `permission denied`, `protocol mismatch`, generic) | Friendly mapped message + collapsible stderr | *Retry*; quota errors link to docs |
| `rsync_partial` | rsync killed (SIGINT/255) | "Push was interrupted. The remote project is in a partial state." | Modal: *Wipe & retry*, *Continue anyway* |
| `git_init_failed` | non-zero on step 7 | "Files copied but git init failed." | *Retry git step* — wizard re-spawns CLI with `--use-existing` (skips mkdir+rsync, re-runs steps 7+8; git init is idempotent so this is safe on a partial state) |
| `unsafe_state` | step 8 finds a git remote configured | **Hard fail.** "Safety check failed: remote project has git remotes: `<list>`. Refusing to continue. Remove them with `ssh <user>@<host> 'cd ~/workspace/<project> && git remote remove <name>'`." | After manual cleanup, *Retry safety check* — wizard re-spawns CLI with `--use-existing` (re-runs steps 7+8 only) |

### State preservation across failures

The wizard's `state` field holds `step`, `host`, `user`, `localPath`, `projectName`. On error, all of it is preserved so *Retry* re-uses the same inputs. Only `error` and `busy` are cleared on retry.

### CLI process lifecycle

- Wizard spawns the CLI with `stdio: ['ignore', 'pipe', 'pipe']` and `detached: false`.
- On VS Code window reload during bootstrap: SIGTERM to the child; on reopen, wizard returns to Step 3 with no progress; user retries. Same pattern as a reload during incremental sync.
- The CLI handles SIGINT/SIGTERM with a 500ms grace then exits 130. Any rsync in flight is cleaned up by the SSH connection closing.

### Logging

Every step (start, ok, fail) is appended to the **Remote Claude** output channel regardless of `--json` mode. Matches the existing pattern in Step 2.

### Deliberately not handled

- Partial-rsync resumability across CLI invocations.
- Disk-space pre-flight check on the Mini.
- Symlink loop protection (rsync's default behavior is acceptable).

---

## Testing

### Unit tests (failing-test-first)

**`test/commands/init-remote-from-local.test.ts`** — drives the CLI logic with a stubbed `ssh`/`rsync` runner so no real Mini is needed:

| Test | Asserts |
|---|---|
| validates `--project` against unsafe characters | `--project '../etc'` exits 2 with `invalid_project_name` |
| fails fast when key missing | exits 3 with `missing_key`, no SSH call attempted |
| aborts when target exists, no override | exits 4 with `target_exists`; rsync/git steps NOT invoked |
| wipes on `--overwrite` then proceeds | `rm -rf` is the first remote command; rsync runs after |
| skips mkdir+rsync on `--use-existing` | only step 7 (git init) and step 8 (safety) execute |
| emits NDJSON events in order under `--json` | sequence `probe → rsync → git_init → done` |
| safety check fails on configured remote | stub `git remote -v` → `origin\thttps://…`; exits 6 with `unsafe_state` |
| safety check passes on empty remote list | exits 0 |

**`test/lib/ssh-runner.test.ts`** — new helper module for shelling out to ssh:

| Test | Asserts |
|---|---|
| rejects unsafe project name at the boundary | `'$(rm -rf /)'` never reaches an SSH call |
| composes ssh args with `-i` and `-p` correctly | snapshot of argv passed to spawned `ssh` |
| propagates non-zero exit codes with stderr capture | rejects with `{ code, stderr }` shape |

**`test/lib/git-sandbox-identity.test.ts`** — runs git locally on a temp dir (no network):

| Test | Asserts |
|---|---|
| init script produces a repo with no remotes | `git remote -v` empty |
| init script sets local-only `user.email`/`user.name` | local config matches; `~/.gitconfig` untouched |
| initial commit succeeds on empty dir | `--allow-empty` path works |
| initial commit succeeds on populated dir | exactly one commit, all files staged |

### Integration test (opt-in)

`test/integration/bootstrap.e2e.test.ts` — runs end-to-end against `localhost` posing as the Mini. Skipped unless `RC_E2E=1`.

Flow: spin a temp dir as `~/workspace`, run the real CLI against `ssh user@127.0.0.1`, then assert:

- `~/workspace/<project>/.git/` exists
- `git log` shows the snapshot commit
- `git remote -v` is empty
- author/email is `Remote Claude (sandbox) <remote-claude@local>`

Teardown removes the temp dir. SSH-localhost setup documented at the top of the file.

### Extension test

**`extension/src/setup/SetupWizard.test.ts`** — new file, mocks `child_process.spawn`:

| Test | Asserts |
|---|---|
| `step3Submit` spawns `init-remote --from-local --json` with parsed inputs | argv contains `--from-local`, `--project <basename>`, `--json` |
| `step3Submit` parses NDJSON progress events | for each progress event, `panel.postMessage` fires with `{type:'progress', ...}` |
| `step3Submit` surfaces `target_exists` as a modal | mock CLI exits 4; assert `vscode.window.showWarningMessage` called with 3 buttons; "Overwrite" picked → CLI re-spawned with `--overwrite` |
| `step3Submit` forbids invalid project name in the UI | basename containing `..` triggers inline error, no spawn |

### Manual smoke (task in plan, not automated)

1. Fresh laptop, fresh Mini. Run wizard end-to-end. Step 3 finishes in <60s for a 50 MB project; <10s for an empty repo.
2. From a turn: `git diff HEAD` produces a patch on the Mini after Claude edits files (proves snapshot commit gave the agent something to diff against).
3. After bootstrap, `ssh user@mini "cd ~/workspace/<project> && git remote -v"` → empty.
4. After bootstrap, `ssh user@mini "cd ~/workspace/<project> && git log -1 --format='%ae %an'"` → `remote-claude@local Remote Claude (sandbox)`.

### CI

`scripts/smoke-extension.sh` already runs `pnpm -r typecheck` and `pnpm -r test`. New unit tests and the SetupWizard test get picked up automatically. The integration test stays opt-in (`RC_E2E=1`).

---

## Migration

- `extension/src/setup/SetupWizard.ts` Step 3 handler rewritten in one commit. Old git-URL UI removed; new two-field UI added.
- `src/commands/init-remote.ts` rewritten to call the new SSH+rsync+git-init flow. `--git-url`/`--branch` flags removed.
- `src/agent/init.ts`, `src/agent/server.ts` `POST /init` route, `InitBody` schema → deleted.
- `src/agent/runInit` and its tests (`test/agent/init.test.ts`) → deleted.
- `remote-claude.yml` written by Step 3 changes only its provenance comment ("snapshot bootstrap" vs "git-url bootstrap"); the YAML schema is unchanged.
- Existing projects already bootstrapped via git-URL continue to work — the agent's runtime is unchanged. New bootstraps use the new path.

## Known v1 limitations (carry forward)

- One laptop per project per dev.
- No mid-rsync resumability across invocations.
- The snapshot commit is the literal first commit on the Mini; if you re-bootstrap with `--overwrite`, the Mini's git history is wiped and recreated.
