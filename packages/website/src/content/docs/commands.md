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

Interactive one-shot configuration. Reads `tailscale status --json`; if it finds peers, lets you pick the Mac Mini from a list (using its Magic-DNS hostname). Falls back to manual host entry if Tailscale isn't running.

Outputs:

- `patchwire.yml` (committed alongside your code)
- `~/.patchwire/env` (`export PW_TOKEN=…`, chmod 600)
- `.patchwire/` cache directory + `.gitignore` entry

#### Flags

Every prompt has a matching flag. Pass any flag and that prompt is skipped (the value is used directly). Pass them all for a fully non-interactive setup.

| Flag | Effect |
| --- | --- |
| `-f, --force` | Overwrite existing `patchwire.yml`. |
| `--no-tailscale` | Skip Tailscale auto-detection entirely. |
| `--host <ip-or-hostname>` | Mac Mini host. **Implies `--no-tailscale`** — the Tailscale picker is skipped. |
| `--user <user>` | Remote SSH user. |
| `--project <name>` | Project folder name on the remote. |
| `--path <path>` | Remote project path. `${project}` placeholder is expanded. |
| `--ssh-port <n>` | SSH port (default 22). |
| `--agent-port <n>` | Agent HTTP port (default 7878). |
| `--token <token>` | Bearer token. Default is a fresh 32-byte hex string. |

#### Common patterns

**You already know the IP** (e.g., a fixed Tailscale `100.x` address you've memorized):

```bash
patchwire setup --host 100.64.0.7
# everything else is still prompted, with sensible defaults
```

**Fully scripted** (e.g., bootstrapping a project from a Makefile):

```bash
patchwire setup --force \
  --host mac-mini.tail-abc123.ts.net \
  --user rebin \
  --project my_app \
  --path '~/workspace/${project}' \
  --ssh-port 22 \
  --agent-port 7878 \
  --token "$PW_TOKEN"
```

**You don't have Tailscale and don't want the warning**:

```bash
patchwire setup --no-tailscale
```

### `init`

```
patchwire init [-f, --force]
```

Minimal manual setup with no Tailscale auto-detection. Rarely needed — `setup` is preferred. Asks the same questions but skips peer discovery.

### `sync`

```
patchwire sync
```

Push local files to the remote with `rsync -az --delete`. Uses your `sync.exclude` list. Does not invoke the AI. Useful for warming the remote before a series of `ask`s, or for verifying connectivity.

### `ask`

```
patchwire ask "<prompt>" [--no-sync] [--save-only]
```

The main event. Sync → POST `/ask` → preview diff → confirm → apply.

Flags:

- `--no-sync` — skip the rsync step; use whatever's currently on the remote. Faster for follow-up runs.
- `--save-only` — write the patch to `.patchwire/last.patch` and exit. Useful in scripts or CI.

After the diff is shown, you'll get four options:

- **Apply all changes** — `git apply` the entire patch.
- **Apply selected files…** — multi-select per file, applies only those chunks.
- **Save patch** — write to `.patchwire/last.patch`, don't apply.
- **Reject** — discard.

### `apply`

```
patchwire apply [<patch-file>]
```

Apply a previously-saved patch. Defaults to `.patchwire/last.patch`. Same preview + confirmation flow as `ask`.

### `doctor`

```
patchwire doctor
```

Run end-to-end diagnostics:

- `rsync`, `ssh`, `git` are on PATH and runnable
- the cwd is a git repo
- `patchwire.yml` exists and validates
- SSH to `remote.user@remote.host` succeeds (`-o BatchMode=yes`)
- `GET /health` on `remote.agentUrl` returns 200 and reports `claude.found: true`

Exits non-zero if any check fails — useful for `make doctor` or pre-commit hooks.

## `patchwire-agent` (Mac Mini)

```
patchwire-agent <command> [options]
```

### `serve` (default)

```
patchwire-agent
```

Start the HTTP server. Reads config from env vars — see [Configuration → Agent environment variables](/configuration/#agent-environment-variables).

### `install`

```
patchwire-agent install [options]
```

macOS only. Register the agent as a launchd LaunchAgent so it auto-starts on every login.

Flags (all optional — defaults come from env vars or generation):

- `--projects-root <path>` — defaults to `$PW_PROJECTS_ROOT` or `~/workspace`
- `--port <n>` — defaults to `$PW_AGENT_PORT` or `7878`
- `--host <h>` — defaults to `$PW_AGENT_HOST` or `0.0.0.0`
- `--token <t>` — defaults to `$PW_AGENT_TOKEN` or a fresh `openssl rand`-style 32-byte hex
- `--claude-bin <path>` — defaults to `$PW_AI_BIN` or `claude`

Re-running `install` regenerates the plist and reloads launchd.

### `uninstall`

```
patchwire-agent uninstall
```

Stop and remove the LaunchAgent. The env file at `~/.patchwire/agent.env` is **kept** — delete it manually if you want a clean slate.
