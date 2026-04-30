---
title: Architecture
description: The request lifecycle, the diff strategy, and the failure model.
---

## Components

```
MacBook (remote-claude CLI)            Mac Mini (remote-claude-agent)
  - source of truth                      - bearer-token HTTP
  - rsync push (one-way)                 - clean git tree per request
  - HTTP /ask                            - spawn `claude --print`
  - colorized diff preview               - capture `git diff` + untracked
  - git apply (selective)                - reset working tree
```

Two binaries, one shared bearer token, one TCP connection. That's the whole product surface.

## Request lifecycle — `remote-claude ask "<prompt>"`

1. **Load config** — `remote-claude.yml`, with `${ENV_VAR}` interpolation.
2. **Sync** — `rsync -az --delete` from your project root to `RC_PROJECTS_ROOT/<project>` on the Mini, with your excludes.
3. **POST `/ask`** — JSON body `{ prompt, project }`, bearer token in `Authorization`.
4. **Agent: pre-flight** — verify the project dir exists, is a git repo, and has a clean working tree. If not, return `404`/`412`/`409`.
5. **Agent: run claude** — `spawn(claudeBin, claudeArgs, { cwd: projectDir })`, prompt sent on stdin. Stdout/stderr captured. Hard timeout via `RC_TIMEOUT_SEC`.
6. **Agent: capture diff** — `git add -A` (so untracked files are included) → `git diff --cached --no-color`. Also `git diff --cached --name-only` for the file list.
7. **Agent: reset** — `git reset HEAD --` → `git checkout -- .` → `git clean -fd`. Working tree is back to where it started.
8. **Agent: respond** — `{ diff, files, durationMs, stdout, stderr, exitCode }`.
9. **CLI: preview** — colorized unified-diff to stdout, summary line.
10. **CLI: confirm** — interactive: apply all / apply selected / save / reject.
11. **CLI: `git apply`** — `git apply --check` first, then `git apply`. On failure, save to `.remote-claude/last.patch` for inspection.

## Why "let claude edit + git diff" instead of "ask claude for a diff"

Two reasons:

**Reliability.** Claude Code is *excellent* at editing files. It uses real edit tools (`Edit`, `Write`, `MultiEdit`) on real files. Asking it to hand-roll a unified diff in text — start lines, hunk headers, exact whitespace — is a form Claude is much weaker at. We avoid the failure mode entirely.

**Coverage.** New files, deleted files, renames, file-mode changes — `git` knows how to express all of these correctly. We don't have to reinvent the format.

The cost is one extra `git` invocation. The benefit is patches that *always* round-trip cleanly through `git apply`.

## Failure model

Each step has a clear failure mode, and a failure never leaves the remote in a half-modified state:

| Stage | Failure | Behavior |
| --- | --- | --- |
| Sync | rsync exits non-zero | CLI surfaces the exit code; nothing on the Mini changed yet. |
| Auth | bad/missing token | `401` from agent, no work done. |
| Project lookup | dir missing | `404`, no work done. |
| Pre-flight | tree dirty | `409`, no work done. The tree was unexpectedly dirty — investigate before retrying. |
| Pre-flight | not a git repo | `412`, no work done. |
| Claude run | non-zero exit | Agent still runs `git diff` (capturing partial work) and resets. CLI shows stderr; the diff may be empty. |
| Capture | `git` errors | Agent attempts the reset in a `finally` block. |
| Reset | `git` errors | Logged; very unlikely. The agent is conservative — `clean -fd` removes untracked, no `-x` (so .gitignored stays). |
| Local apply | `git apply --check` fails | Patch is *not* applied. Saved to `.remote-claude/last.patch` for manual inspection. |

## The agent's filesystem footprint

The agent only ever writes inside `RC_PROJECTS_ROOT/<project>` — a directory you control. Project names are regex-restricted (`[a-zA-Z0-9_.-]+`) so a malicious request can't escape the root. Every run leaves the project tree in the same git state it started in.

## Sequence diagram

```
laptop                             mac mini
  |                                   |
  |  rsync -az --delete              |
  |--------------------------------->|
  |                                   |
  |  POST /ask {prompt, project}     |
  |  Authorization: Bearer <token>   |
  |--------------------------------->|
  |                                   |
  |                                   | git status --porcelain → clean
  |                                   | spawn claude --print "<prompt>"
  |                                   | (claude edits files)
  |                                   | git add -A
  |                                   | git diff --cached    → DIFF
  |                                   | git diff --cached --name-only → FILES
  |                                   | git reset --hard / clean -fd
  |                                   |
  |  200 {diff, files, ...}           |
  |<---------------------------------|
  |                                   |
  | colorize, summarize, confirm      |
  | git apply --check                 |
  | git apply                         |
  |                                   |
```

## What's *not* in this picture

- **No daemon on the laptop.** No file watcher. No background process. The CLI runs once per `ask`.
- **No state on the agent.** Each request is independent. The Mini holds your repo on disk (synced) but holds no per-request state between calls.
- **No third-party services.** Anthropic gets your prompt + relevant code via Claude Code, same as if you ran it locally. Our wire never touches the public internet (assuming Tailscale or LAN).
