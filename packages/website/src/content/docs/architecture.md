---
title: Architecture
description: How a request becomes a diff, and what happens when something breaks.
---

## Components

```
laptop (patchwire CLI)            remote (patchwire-agent)
  - source of truth                      - bearer-token HTTP
  - rsync push (one-way)                 - clean git tree per request
  - HTTP /ask                            - spawn `claude --print`
  - colorized diff preview               - capture `git diff` + untracked
  - git apply (selective)                - reset working tree
```

Two binaries, per-user bearer tokens, one TCP connection. That's the whole product surface. One agent serves a whole team; see [Multi-developer](/multi-developer/).

## Request lifecycle: `patchwire ask "<prompt>"`

1. **Load config.** `patchwire.yml`, with `${ENV_VAR}` interpolation.
2. **Sync.** `rsync -az --delete` from your project root to `PW_PROJECTS_ROOT/<project>` on the remote, honoring your excludes.
3. **POST `/ask`.** JSON body `{ prompt, project }`, bearer token in `Authorization`.
4. **Agent: pre-flight.** Verify the project dir exists, is a git repo, and has a clean working tree. If not, return `404`, `412`, or `409`.
5. **Agent: run claude.** `spawn(claudeBin, claudeArgs, { cwd: projectDir })`. Prompt is sent on stdin. Stdout and stderr captured. Hard timeout via `PW_TIMEOUT_SEC`.
6. **Agent: capture diff.** `git add -A` (so untracked files are included), then `git diff --cached --no-color`. Also `git diff --cached --name-only` for the file list.
7. **Agent: reset.** `git reset HEAD --`, then `git checkout -- .`, then `git clean -fd`. The working tree is back where it started.
8. **Agent: respond.** `{ diff, files, durationMs, stdout, stderr, exitCode }`.
9. **CLI: preview.** Colorized unified diff to stdout, plus a summary line.
10. **CLI: confirm.** Interactive: apply all, apply selected, save, or reject.
11. **CLI: `git apply`.** `git apply --check` first, then `git apply`. On failure, save to `.patchwire/last.patch` for inspection.

## Why "let claude edit + git diff" instead of "ask claude for a diff"

Two reasons.

**Reliability.** Claude Code is *excellent* at editing files. It uses real edit tools (`Edit`, `Write`, `MultiEdit`) on real files. Asking it to hand-roll a unified diff in text (start lines, hunk headers, exact whitespace) is a form Claude is much weaker at. We avoid the failure mode entirely.

**Coverage.** New files, deleted files, renames, file-mode changes: `git` knows how to express all of these correctly. We don't have to reinvent the format.

The cost is one extra `git` invocation. The benefit is patches that *always* round-trip cleanly through `git apply`.

## Failure model

Each step has a clear failure mode, and a failure never leaves the remote in a half-modified state.

| Stage | Failure | Behavior |
| --- | --- | --- |
| Sync | rsync exits non-zero | CLI surfaces the exit code. Nothing on the remote changed yet. |
| Auth | bad or missing token | `401` from agent, no work done. |
| Project lookup | dir missing | `404`, no work done. |
| Pre-flight | tree dirty | `409`, no work done. The tree was unexpectedly dirty; investigate before retrying. |
| Pre-flight | not a git repo | `412`, no work done. |
| Claude run | non-zero exit | Agent still runs `git diff` (capturing partial work) and resets. CLI shows stderr. The diff may be empty. |
| Capture | `git` errors | Agent attempts the reset in a `finally` block. |
| Reset | `git` errors | Logged. Very unlikely. The agent is conservative: `clean -fd` removes untracked files, no `-x`, so `.gitignored` files stay. |
| Local apply | `git apply --check` fails | The patch is *not* applied. It's saved to `.patchwire/last.patch` for manual inspection. |

## The agent's filesystem footprint

The agent only ever writes inside `PW_PROJECTS_ROOT/<project>`, a directory you control. Project names are regex-restricted to `[a-zA-Z0-9_.-]+` so a malicious request can't escape the root. Every run leaves the project tree in the same git state it started in.

## Sequence diagram

```
laptop                             remote
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
- **No state on the agent.** Each request is independent. The remote holds your repo on disk (synced) but holds no per-request state between calls.
- **No third-party services.** Anthropic gets your prompt and relevant code via Claude Code, the same as if you ran it locally. Our wire never touches the public internet (assuming Tailscale or LAN).
