# Remote Claude

[![CI](https://github.com/rebink/remote_claude/actions/workflows/ci.yml/badge.svg)](https://github.com/rebink/remote_claude/actions/workflows/ci.yml)
[![Docs](https://github.com/rebink/remote_claude/actions/workflows/docs.yml/badge.svg)](https://github.com/rebink/remote_claude/actions/workflows/docs.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](#requirements)

📖 **Full docs:** [remote-claude.vercel.app](https://remote-claude.vercel.app) — quickstart, architecture, API reference, troubleshooting.

> **Local-first development. AI executes remotely. Diffs come back for review.**

You keep coding on your laptop with full IDE speed. A bigger Mac (or any remote box) runs Claude Code with full repo context. The result comes back as a **unified diff** that you preview and `git apply` — no surprise file edits, no commits you didn't see.

```
MacBook (remote-claude CLI)            Mac Mini (remote-claude-agent)
  - source of truth                      - bearer-token HTTP server
  - rsync push (one-way)                 - clean git tree per request
  - HTTP /ask                            - spawn `claude --print`
  - colorized diff preview               - capture `git diff` + untracked
  - git apply (selective)                - reset working tree
```

We deliberately **don't** ask Claude to "produce a diff". Claude Code is reliable at editing files (its native behavior) but flaky at hand-rolling unified diffs. Instead the agent lets it edit a clean checkout, then derives the diff from `git`. Robust, no prompt fragility.

## Why this exists

Remote development is slow because the filesystem is far away. `code-server` over SSH? Laggy. Sync everything bidirectionally? Conflict hell. We pick a different cut: **local stays local, AI stays remote, only diffs cross the wire.**

## Requirements

- Node.js **>= 20** on both machines
- `git`, `rsync`, `ssh` on both machines
- `claude` CLI on the remote ([install](https://docs.claude.com/en/docs/claude-code/quickstart))
- SSH key-based access from your laptop to the remote

## Install

### From GitHub (works today, no npm publish required)

```bash
pnpm add -g github:rebink/remote_claude
# or
npm  i  -g github:rebink/remote_claude
```

The `prepare` lifecycle hook builds the bundle automatically during install.

### From npm (after first published release)

```bash
pnpm add -g remote-claude
# or
npm  i  -g remote-claude
```

You now have two binaries on `$PATH`:

- `remote-claude` — the CLI (run on your laptop)
- `remote-claude-agent` — the HTTP server (run on the Mac Mini)

### From source (development)

```bash
git clone https://github.com/rebink/remote_claude.git
cd remote_claude
pnpm install
pnpm build
npm link            # exposes both bins globally
```

## Quickstart — three commands per side

> Assumes Tailscale is already running on both Macs (`brew install tailscale && sudo tailscale up`). If it isn't, the laptop setup falls back to a manual host prompt.

### On the Mac Mini

```bash
pnpm add -g github:rebink/remote_claude         # 1. install
remote-claude-agent install                     # 2. registers as a launchd service, prints a TOKEN
                                                #    (writes ~/Library/LaunchAgents/com.remote-claude.agent.plist)
# 3. nothing — the service is already running. Logs in ~/.remote-claude/logs/.
```

`install` generates a random token (or reuses `RC_AGENT_TOKEN` if set), saves it in `~/.remote-claude/agent.env` (chmod 600), and starts the agent in the background. It will auto-start on every login.

### On your laptop

```bash
pnpm add -g github:rebink/remote_claude         # 1. install
cd ~/code/my_flutter_app
remote-claude setup                             # 2. interactive: picks Mac Mini from your tailnet,
                                                #    writes remote-claude.yml + ~/.remote-claude/env
source ~/.remote-claude/env                     # 3. load the token (paste the agent's TOKEN here once)
remote-claude doctor                            # verify everything connects
remote-claude ask "refactor login_bloc to use freezed"
```

`setup` reads `tailscale status --json`, lists your peers, and lets you pick the Mac Mini — no IP typing. It writes `remote-claude.yml` with the Magic-DNS hostname (`mac-mini.tail-abc123.ts.net`) so the config survives Wi-Fi changes.

## Commands

### Laptop CLI (`remote-claude`)

| Command | Description |
|---|---|
| `remote-claude setup` | One-shot interactive setup: detects Tailscale peers, generates token, writes config |
| `remote-claude init` | Minimal config (no auto-detection) — rarely needed; `setup` is preferred |
| `remote-claude sync` | Push to remote (no AI call) |
| `remote-claude ask "<prompt>"` | Sync → run AI → preview → apply (or selective) |
| `remote-claude apply [patch]` | Apply a saved patch (default: `.remote-claude/last.patch`) |
| `remote-claude doctor` | Verify rsync, ssh, agent, config |

### Agent (`remote-claude-agent`)

| Command | Description |
|---|---|
| `remote-claude-agent` | Start the HTTP server (default; reads env vars) |
| `remote-claude-agent install` | macOS: register as a launchd LaunchAgent (auto-starts on login) |
| `remote-claude-agent uninstall` | macOS: remove the LaunchAgent |

`ask` flags:

- `--no-sync` — skip sync (use last synced state on remote)
- `--save-only` — save patch without prompting to apply

When you run `ask`, you get four options after the diff preview:

- **Apply all changes** — `git apply` the whole patch
- **Apply selected files…** — multi-select per file (space toggles, enter confirms)
- **Save patch** — write to `.remote-claude/last.patch` for later
- **Reject** — discard

## Configuration — `remote-claude.yml`

```yaml
project: my_flutter_app
remote:
  host: 192.168.1.10
  user: rebin
  path: ~/workspace/my_flutter_app
  sshPort: 22
  agentUrl: http://192.168.1.10:7878
  token: ${RC_TOKEN}            # env var interpolation
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

### Agent environment variables

| Var | Required | Default |
|---|---|---|
| `RC_AGENT_TOKEN` | yes | — |
| `RC_PROJECTS_ROOT` | yes | — |
| `RC_AGENT_HOST` | no | `127.0.0.1` |
| `RC_AGENT_PORT` | no | `7878` |
| `RC_CLAUDE_BIN` | no | `claude` |
| `RC_CLAUDE_ARGS` | no | `--print` |
| `RC_TIMEOUT_SEC` | no | `600` |

## Networking — connecting your laptop to the Mac Mini

Remote Claude isn't opinionated about how your laptop reaches the Mac Mini — it just needs **SSH** and **HTTP** reachability to whatever hostname you put in `remote-claude.yml`. Pick whichever fits your situation:

| Setup | Cost | Best for |
|---|---|---|
| **Same LAN** (home Wi-Fi / Ethernet) | free | Both machines on the same network. Simplest. |
| **Tailscale** ⭐ | free (personal plan) | Working from anywhere — cafés, hotels, different ISPs. |
| **Self-hosted WireGuard** | free | You want to own the entire tunnel. |
| **Cloudflare Tunnel (`cloudflared`)** | free | OK with Cloudflare in the path; no router changes. |
| **Router port-forward + DDNS** | free | **Not recommended** — exposes SSH publicly. |

### Recommended: Tailscale

```bash
# on both Macs
brew install tailscale
sudo tailscale up
```

You get a stable `100.x.y.z` IP and a Magic DNS hostname like `mac-mini.tail-abc123.ts.net`. Drop that into `remote-claude.yml`:

```yaml
remote:
  host: mac-mini.tail-abc123.ts.net
  agentUrl: http://mac-mini.tail-abc123.ts.net:7878
```

**Why Tailscale for this use case:**

1. The agent only listens on your tailnet — never the public internet.
2. Stable hostnames survive Wi-Fi / ISP changes; no port-forwarding.
3. Bearer-token auth + SSH keys still apply — defense in depth.
4. Zero code changes — switching networks is a one-line YAML edit.

## Security

- **SSH keys** for rsync (no passwords).
- **Bearer token** (constant-time compared) for the HTTP API.
- Bind the agent to **LAN-only** or `127.0.0.1` + an SSH tunnel.
- Project names are **regex-restricted** (`[a-zA-Z0-9_.-]+`) — no path traversal.
- The local machine remains the source of truth; nothing flows remote → local except via reviewable diff.

## Architecture

See [`docs/superpowers/specs/2026-04-30-devbridge-design.md`](docs/superpowers/specs/2026-04-30-devbridge-design.md) for the design spec.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test          # 15 vitest tests, including end-to-end agent flow
pnpm build
pnpm dev:cli -- --help
pnpm dev:agent
```

## Contributing

PRs and issues welcome — see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Mohamed Rebin K
