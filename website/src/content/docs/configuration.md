---
title: Configuration
description: Every option in remote-claude.yml and every env var the agent reads.
---

## `remote-claude.yml`

Lives at the root of each project on the laptop. Created by `remote-claude setup` (preferred) or `remote-claude init`.

```yaml
project: my_flutter_app
remote:
  host: mac-mini.tail-abc123.ts.net
  user: rebin
  path: ~/workspace/my_flutter_app
  sshPort: 22
  agentUrl: http://mac-mini.tail-abc123.ts.net:7878
  token: ${RC_TOKEN}
sync:
  exclude:
    - build/
    - .dart_tool/
    - ios/Pods/
    - node_modules/
    - .git/
ai:
  command: claude
  args: [--print]
  timeoutSec: 600
```

### Field reference

| Path | Type | Required | Default | Notes |
| --- | --- | --- | --- | --- |
| `project` | string | yes | — | Folder name on remote. Must match `[a-zA-Z0-9_.-]+`. |
| `remote.host` | string | yes | — | Hostname or IP (Tailscale Magic-DNS recommended). |
| `remote.user` | string | yes | — | SSH user on the Mini. |
| `remote.path` | string | yes | — | Absolute or `~`-relative path on the Mini. |
| `remote.sshPort` | number | no | 22 | Override if SSH listens elsewhere. |
| `remote.agentUrl` | URL | yes | — | Where the CLI will POST `/ask`. |
| `remote.token` | string | yes | — | Bearer token. **Use `${RC_TOKEN}` interpolation** — don't commit secrets. |
| `sync.exclude` | string[] | no | `[]` | Passed to `rsync --exclude-from`. `.git/` and `.remote-claude/` are always excluded. |
| `ai.command` | string | no | `claude` | Path/name of the AI CLI to spawn on the remote. |
| `ai.args` | string[] | no | `[--print]` | Args passed to `ai.command`. The prompt is sent on stdin. |
| `ai.timeoutSec` | number | no | 600 | Hard kill after this many seconds. |

### Env var interpolation

Any `${VAR}` in a string value is resolved from the laptop's environment at config-load time. If the var is unset, the CLI fails fast with a clear error. Use this for secrets — keep them out of git.

```yaml
remote:
  token: ${RC_TOKEN}        # ✅
  # token: hardcoded-abc    # 🚫 don't do this
```

## Agent environment variables

The agent reads its config exclusively from environment variables. `remote-claude-agent install` writes them to `~/.remote-claude/agent.env` and embeds them in the launchd plist.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `RC_AGENT_TOKEN` | **yes** | — | Bearer token (must match `RC_TOKEN` on the laptop). |
| `RC_PROJECTS_ROOT` | **yes** | — | Parent directory containing each project. |
| `RC_AGENT_HOST` | no | `127.0.0.1` | Bind interface. Use `0.0.0.0` to bind all, or your tailnet IP. |
| `RC_AGENT_PORT` | no | `7878` | TCP port. |
| `RC_CLAUDE_BIN` | no | `claude` | Path to the Claude CLI. |
| `RC_CLAUDE_ARGS` | no | `--print` | Space-separated args. |
| `RC_TIMEOUT_SEC` | no | `600` | Hard kill timeout for `claude`. |

## Laptop environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `RC_TOKEN` | yes | Bearer token. Loaded by `source ~/.remote-claude/env` after `setup`. |
| `RC_VERBOSE` | no | Set to `1` to print debug info from the CLI. |

## File layout

```
~/.remote-claude/                 # laptop or mini
  env                             # `export RC_TOKEN=...` (chmod 600)
  agent.env                       # mini only — `export RC_AGENT_TOKEN=...` (chmod 600)
  logs/agent.{out,err}.log        # mini only — launchd stdout/stderr

<your-project>/
  remote-claude.yml               # checked into git
  .remote-claude/                 # gitignored
    last.patch                    # most recent diff (optional)
```

## Updating config

### Already know the IP? Three ways to set it directly

If you already have a working address for the Mac Mini (e.g., a fixed Tailscale IP, a LAN IP with a DHCP reservation, or a hostname), you don't need to re-run the Tailscale picker.

**1. Edit `remote-claude.yml` by hand.** It's just YAML. Change `remote.host` and `remote.agentUrl`, save, run `remote-claude doctor` to verify. No daemon to restart.

**2. Re-run `setup` with `--host`** (and `--force` to overwrite):

```bash
remote-claude setup --force --host 100.64.0.7
```

This skips Tailscale detection entirely. Other prompts still come up with their previous defaults — answer or accept.

**3. Fully non-interactive** (all values from flags):

```bash
remote-claude setup --force \
  --host 100.64.0.7 \
  --user rebin \
  --project my_app \
  --path '~/workspace/${project}'
```

See [`setup` reference](/commands/#setup) for every flag.

### Other changes

`remote-claude.yml` is just YAML — edit it with any editor. Changes are picked up on the next `ask`. There's no daemon or cache to restart.

After changing the **agent**'s env vars (e.g., bumping `RC_TIMEOUT_SEC`):

```bash
launchctl unload ~/Library/LaunchAgents/com.remote-claude.agent.plist
launchctl load   ~/Library/LaunchAgents/com.remote-claude.agent.plist
```

Or simpler: re-run `remote-claude-agent install` with the new flags.
