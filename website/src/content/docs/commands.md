---
title: CLI commands
description: Every subcommand for remote-claude and remote-claude-agent.
---

## `remote-claude` (laptop)

```
remote-claude <command> [options]
```

### `setup`

```
remote-claude setup [-f, --force]
```

Interactive one-shot configuration. Reads `tailscale status --json`; if it finds peers, lets you pick the Mac Mini from a list (using its Magic-DNS hostname). Falls back to manual host entry if Tailscale isn't running.

Outputs:

- `remote-claude.yml` (committed alongside your code)
- `~/.remote-claude/env` (`export RC_TOKEN=…`, chmod 600)
- `.remote-claude/` cache directory + `.gitignore` entry

`--force` overwrites an existing `remote-claude.yml`.

### `init`

```
remote-claude init [-f, --force]
```

Minimal manual setup with no Tailscale auto-detection. Rarely needed — `setup` is preferred. Asks the same questions but skips peer discovery.

### `sync`

```
remote-claude sync
```

Push local files to the remote with `rsync -az --delete`. Uses your `sync.exclude` list. Does not invoke the AI. Useful for warming the remote before a series of `ask`s, or for verifying connectivity.

### `ask`

```
remote-claude ask "<prompt>" [--no-sync] [--save-only]
```

The main event. Sync → POST `/ask` → preview diff → confirm → apply.

Flags:

- `--no-sync` — skip the rsync step; use whatever's currently on the remote. Faster for follow-up runs.
- `--save-only` — write the patch to `.remote-claude/last.patch` and exit. Useful in scripts or CI.

After the diff is shown, you'll get four options:

- **Apply all changes** — `git apply` the entire patch.
- **Apply selected files…** — multi-select per file, applies only those chunks.
- **Save patch** — write to `.remote-claude/last.patch`, don't apply.
- **Reject** — discard.

### `apply`

```
remote-claude apply [<patch-file>]
```

Apply a previously-saved patch. Defaults to `.remote-claude/last.patch`. Same preview + confirmation flow as `ask`.

### `doctor`

```
remote-claude doctor
```

Run end-to-end diagnostics:

- `rsync`, `ssh`, `git` are on PATH and runnable
- the cwd is a git repo
- `remote-claude.yml` exists and validates
- SSH to `remote.user@remote.host` succeeds (`-o BatchMode=yes`)
- `GET /health` on `remote.agentUrl` returns 200 and reports `claude.found: true`

Exits non-zero if any check fails — useful for `make doctor` or pre-commit hooks.

## `remote-claude-agent` (Mac Mini)

```
remote-claude-agent <command> [options]
```

### `serve` (default)

```
remote-claude-agent
```

Start the HTTP server. Reads config from env vars — see [Configuration → Agent environment variables](/configuration/#agent-environment-variables).

### `install`

```
remote-claude-agent install [options]
```

macOS only. Register the agent as a launchd LaunchAgent so it auto-starts on every login.

Flags (all optional — defaults come from env vars or generation):

- `--projects-root <path>` — defaults to `$RC_PROJECTS_ROOT` or `~/workspace`
- `--port <n>` — defaults to `$RC_AGENT_PORT` or `7878`
- `--host <h>` — defaults to `$RC_AGENT_HOST` or `0.0.0.0`
- `--token <t>` — defaults to `$RC_AGENT_TOKEN` or a fresh `openssl rand`-style 32-byte hex
- `--claude-bin <path>` — defaults to `$RC_CLAUDE_BIN` or `claude`

Re-running `install` regenerates the plist and reloads launchd.

### `uninstall`

```
remote-claude-agent uninstall
```

Stop and remove the LaunchAgent. The env file at `~/.remote-claude/agent.env` is **kept** — delete it manually if you want a clean slate.
