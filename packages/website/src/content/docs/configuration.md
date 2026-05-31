---
title: Configuration
description: Every option in patchwire.yml and every env var the agent reads.
---

## `patchwire.yml`

Lives at the root of each project on the laptop. Created by `patchwire setup` (preferred) or `patchwire init`.

```yaml
project: my_flutter_app
remote:
  host: mac-mini.tail-abc123.ts.net
  user: rebin
  path: ~/workspace/my_flutter_app
  sshPort: 22
  agentUrl: http://mac-mini.tail-abc123.ts.net:7878
  token: ${PW_TOKEN}
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
| `remote.token` | string | yes | — | Bearer token. **Use `${PW_TOKEN}` interpolation** — don't commit secrets. |
| `sync.exclude` | string[] | no | `[]` | Passed to `rsync --exclude-from`. `.git/` and `.patchwire/` are always excluded. |
| `ai.command` | string | no | `claude` | Path/name of the AI CLI to spawn on the remote. |
| `ai.args` | string[] | no | `[--print]` | Args passed to `ai.command`. The prompt is sent on stdin. |
| `ai.timeoutSec` | number | no | 600 | Hard kill after this many seconds. |

### Env var interpolation

Any `${VAR}` in a string value is resolved from the laptop's environment at config-load time. If the var is unset, the CLI fails fast with a clear error. Use this for secrets — keep them out of git.

```yaml
remote:
  token: ${PW_TOKEN}        # ✅
  # token: hardcoded-abc    # 🚫 don't do this
```

## Agent environment variables

The agent reads its config exclusively from environment variables. `patchwire-agent install` writes them to `~/.patchwire/agent.env` and embeds them in the launchd plist.

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `PW_AGENT_TOKEN` | **yes** | — | Bearer token (must match `PW_TOKEN` on the laptop). |
| `PW_PROJECTS_ROOT` | **yes** | — | Parent directory containing each project. |
| `PW_AGENT_HOST` | no | `127.0.0.1` | Bind interface. Use `0.0.0.0` to bind all, or your tailnet IP. |
| `PW_AGENT_PORT` | no | `7878` | TCP port. |
| `PW_AI_BIN` | no | `claude` | Path to the Claude CLI. |
| `PW_AI_ARGS` | no | `--print` | Space-separated args. |
| `PW_TIMEOUT_SEC` | no | `600` | Hard kill timeout for `claude`. |

## Laptop environment variables

| Variable | Required | Notes |
| --- | --- | --- |
| `PW_TOKEN` | yes | Bearer token. Loaded by `source ~/.patchwire/env` after `setup`. |
| `PW_VERBOSE` | no | Set to `1` to print debug info from the CLI. |

## File layout

```
~/.patchwire/                 # laptop or mini
  env                             # `export PW_TOKEN=...` (chmod 600)
  agent.env                       # mini only — `export PW_AGENT_TOKEN=...` (chmod 600)
  logs/agent.{out,err}.log        # mini only — launchd stdout/stderr

<your-project>/
  patchwire.yml               # checked into git
  .patchwire/                 # gitignored
    last.patch                    # most recent diff (optional)
```

## Updating config

### Already know the IP? Three ways to set it directly

If you already have a working address for the Mac Mini (e.g., a fixed Tailscale IP, a LAN IP with a DHCP reservation, or a hostname), you don't need to re-run the Tailscale picker.

**1. Edit `patchwire.yml` by hand.** It's just YAML. Change `remote.host` and `remote.agentUrl`, save, run `patchwire doctor` to verify. No daemon to restart.

**2. Re-run `setup` with `--host`** (and `--force` to overwrite):

```bash
patchwire setup --force --host 100.64.0.7
```

This skips Tailscale detection entirely. Other prompts still come up with their previous defaults — answer or accept.

**3. Fully non-interactive** (all values from flags):

```bash
patchwire setup --force \
  --host 100.64.0.7 \
  --user rebin \
  --project my_app \
  --path '~/workspace/${project}'
```

See [`setup` reference](/commands/#setup) for every flag.

### Other changes

`patchwire.yml` is just YAML — edit it with any editor. Changes are picked up on the next `ask`. There's no daemon or cache to restart.

After changing the **agent**'s env vars (e.g., bumping `PW_TIMEOUT_SEC`):

```bash
launchctl unload ~/Library/LaunchAgents/com.patchwire.agent.plist
launchctl load   ~/Library/LaunchAgents/com.patchwire.agent.plist
```

Or simpler: re-run `patchwire-agent install` with the new flags.
