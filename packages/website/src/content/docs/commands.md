---
title: CLI commands
description: Every subcommand for patchwire and patchwire-agent.
---

## `patchwire` (laptop)

```
patchwire <command> [options]
```

### `setup`

```
patchwire setup [options]
```

Interactive one-shot configuration. Reads `tailscale status --json`. If it finds peers, it lets you pick the remote from a list (using its Magic-DNS hostname). Falls back to manual host entry if Tailscale isn't running.

Outputs:

- `patchwire.yml` (committed alongside your code)
- `~/.patchwire/env` with `export PW_TOKEN=…` (chmod 600)
- `.patchwire/` cache directory and a `.gitignore` entry

#### Flags

Every prompt has a matching flag. Pass any flag and that prompt is skipped (the value is used directly). Pass them all for a fully non-interactive setup.

| Flag | Effect |
| --- | --- |
| `-f, --force` | Overwrite existing `patchwire.yml`. |
| `--no-tailscale` | Skip Tailscale auto-detection entirely. |
| `--host <ip-or-hostname>` | Remote host. Implies `--no-tailscale` (the Tailscale picker is skipped). |
| `--user <user>` | Remote SSH user. |
| `--project <name>` | Project folder name on the remote. |
| `--path <path>` | Remote project path. `${project}` placeholder is expanded. |
| `--ssh-port <n>` | SSH port (default 22). |
| `--agent-port <n>` | Agent HTTP port (default 7878). |
| `--token <token>` | Bearer token. Default is a fresh 32-byte hex string. |

#### Common patterns

**You already know the IP** (a fixed Tailscale address you've memorized):

```bash
patchwire setup --host <your-ip>
# everything else is still prompted, with sensible defaults
```

**Fully scripted** (bootstrapping a project from a Makefile, for example):

```bash
patchwire setup --force \
  --host <your-remote-host> \
  --user <your-user> \
  --project my_app \
  --path '~/workspace/${project}' \
  --ssh-port 22 \
  --agent-port 7878 \
  --token "$PW_TOKEN"
```

**You don't have Tailscale and don't want the warning:**

```bash
patchwire setup --no-tailscale
```

### `init`

```
patchwire init [-f, --force]
```

Minimal manual setup with no Tailscale auto-detection. Rarely needed; `setup` is preferred. Asks the same questions but skips peer discovery.

### `init-remote`

```
patchwire init-remote --from-local
```

Bootstrap a project on the remote by pushing the current working directory. Useful for first-time project setup when you already have local code that you want to copy up.

### `sync`

```
patchwire sync
```

Push local files to the remote with `rsync -az --delete`. Uses your `sync.exclude` list. Does not invoke the AI. Useful for warming the remote before a series of `ask`s, or for verifying connectivity.

### `ask`

```
patchwire ask "<prompt>" [--no-sync] [--save-only]
```

The main event: sync, then POST `/ask`, then preview the diff, then confirm, then apply.

Flags:

- `--no-sync`: skip the rsync step and use whatever's currently on the remote. Faster for follow-up runs.
- `--save-only`: write the patch to `.patchwire/last.patch` and exit. Useful in scripts or CI.

After the diff is shown, you'll get four options:

- **Apply all changes:** `git apply` the entire patch.
- **Apply selected files…**: multi-select per file, applies only those chunks.
- **Save patch:** write to `.patchwire/last.patch`, don't apply.
- **Reject:** discard.

### `apply`

```
patchwire apply [<patch-file>]
```

Apply a previously-saved patch. Defaults to `.patchwire/last.patch`. Same preview and confirmation flow as `ask`.

### `doctor`

```
patchwire doctor
```

Run end-to-end diagnostics:

- `rsync`, `ssh`, and `git` are on PATH and runnable.
- The cwd is a git repo.
- `patchwire.yml` exists and validates.
- SSH to `remote.user@remote.host` succeeds (`-o BatchMode=yes`).
- `GET /health` on `remote.agentUrl` returns 200 and reports `claude.found: true`.

Exits non-zero if any check fails. Useful for `make doctor` or pre-commit hooks.

### `whoami`

```
patchwire whoami
```

Asks the agent which user it recognises you as (based on your `PW_TOKEN`). Quick sanity-check that your credentials are wired up correctly.

### Extension-internal commands

The CLI also exposes three commands used by the VS Code extension. You don't need to call them by hand, but they're listed for completeness:

- `patchwire chat <prompt...> [--no-sync]`: multi-turn chat with Claude on the remote.
- `patchwire session-status --session <uuid>`: get the in-memory status of a chat session.
- `patchwire delete-session --session <uuid>`: remove a chat session from the agent.

## `patchwire-agent` (remote)

```
patchwire-agent <command> [options]
```

### `serve` (default)

```
patchwire-agent
```

Start the HTTP server. Reads config from env vars. See [Configuration → Agent environment variables](/configuration/#agent-environment-variables).

### `install`

```
patchwire-agent install [options]
```

macOS only. Registers the agent as a launchd LaunchAgent so it auto-starts on every login.

Flags (all optional, defaults come from env vars or generation):

- `--projects-root <path>`: defaults to `$PW_PROJECTS_ROOT` or `~/workspace`.
- `--port <n>`: defaults to `$PW_AGENT_PORT` or `7878`.
- `--host <h>`: defaults to `$PW_AGENT_HOST` or `0.0.0.0`.
- `--token <t>`: defaults to `$PW_AGENT_TOKEN` or a fresh `openssl rand`-style 32-byte hex.
- `--ai-bin <path>`: defaults to `$PW_AI_BIN` or `claude`.

Re-running `install` regenerates the plist and reloads launchd.

### `uninstall`

```
patchwire-agent uninstall
```

Stop and remove the LaunchAgent. The env file at `~/.patchwire/agent.env` is **kept**. Delete it manually if you want a clean slate.

### `user`

```
patchwire-agent user <subcommand>
```

Manage per-developer users for multi-developer mode.

| Subcommand | Description |
| --- | --- |
| `user add <name>` | Create a new user; prints the generated token once. Pass `--token <value>` to supply your own. |
| `user list` | List all users with status and last-seen timestamp. |
| `user disable <name>` | Disable a user (token stays registered but every request 403s). |
| `user enable <name>` | Re-enable a previously disabled user. |
| `user rm <name>` | Permanently remove a user; token stops working immediately. |
| `user rotate <name>` | Generate a new token for an existing user; old token is revoked. Pass `--token <value>` to supply your own. |

#### `user policy`

```
patchwire-agent user policy <subcommand>
```

View or set per-user access policy.

| Subcommand | Description |
| --- | --- |
| `user policy show <name>` | Print the project allowlist and rate limit for a user. |
| `user policy projects <name> [projects...]` | Set the project allowlist. Pass `--clear` (or no projects) to allow all. |
| `user policy rate <name> <max> <window>` | Set a rate limit, e.g. `rate ana 50 1h`. Pass `--clear` to remove. |

### `log`

```
patchwire-agent log [options]
```

Tail the JSONL audit log in human-readable form.

| Flag | Description |
| --- | --- |
| `--user <name>` | Show only entries for this user. |
| `--project <name>` | Show only entries for this project. |
| `--since <duration>` | Show only entries newer than this (e.g. `30m`, `6h`, `7d`). |
| `--limit <n>` | Show only the last N entries (default 100). |
| `--json` | Emit raw JSONL instead of pretty text. |

### `usage`

```
patchwire-agent usage [options]
```

Per-user usage summary aggregated from the audit log. Columns: requests, accepted, ask, chat, lines added, lines removed, duration.

| Flag | Description |
| --- | --- |
| `--user <name>` | Show only this user. |
| `--project <name>` | Show only this project. |
| `--since <duration>` | Only entries newer than this (e.g. `30m`, `6h`, `7d`). |
| `--json` | Emit the structured report as JSON. |
