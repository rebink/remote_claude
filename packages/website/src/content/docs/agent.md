---
title: Running the agent
description: launchd, systemd, foreground, logs, and lifecycle.
---

The agent is a small Fastify HTTP server. It has no required state between requests — restart it any time.

## macOS — managed via launchd (recommended)

```bash
remote-claude-agent install
```

Writes `~/Library/LaunchAgents/com.remote-claude.agent.plist`, loads it, and prints the bearer token. The service auto-starts on every login and restarts if it crashes (`KeepAlive=true`).

### Where things live

| Path | Purpose |
| --- | --- |
| `~/Library/LaunchAgents/com.remote-claude.agent.plist` | launchd config |
| `~/.remote-claude/agent.env` | env vars (chmod 600) |
| `~/.remote-claude/logs/agent.out.log` | stdout |
| `~/.remote-claude/logs/agent.err.log` | stderr |

### Lifecycle

```bash
# stop
launchctl unload ~/Library/LaunchAgents/com.remote-claude.agent.plist

# start
launchctl load ~/Library/LaunchAgents/com.remote-claude.agent.plist

# remove entirely
remote-claude-agent uninstall
```

### Customizing the install

```bash
remote-claude-agent install \
  --projects-root /Volumes/Code/projects \
  --port 9090 \
  --host 100.64.0.7 \
  --token "$(cat ~/.tokens/rc)" \
  --claude-bin /opt/homebrew/bin/claude
```

Re-running `install` regenerates the plist and reloads launchd.

## macOS / Linux — foreground (for testing)

```bash
export RC_AGENT_TOKEN=…
export RC_PROJECTS_ROOT=~/workspace
export RC_AGENT_HOST=0.0.0.0
remote-claude-agent
# → Server listening at http://0.0.0.0:7878
```

Ctrl-C to stop. Useful for tailing logs interactively or debugging.

## Linux — systemd (manual setup)

The `install` subcommand is currently macOS-only. On Linux, write a unit yourself:

```ini
# /etc/systemd/system/remote-claude-agent.service
[Unit]
Description=Remote Claude Agent
After=network.target

[Service]
Type=simple
User=rebin
EnvironmentFile=/home/rebin/.remote-claude/agent.env
ExecStart=/usr/bin/env remote-claude-agent
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now remote-claude-agent
systemctl status remote-claude-agent
journalctl -u remote-claude-agent -f
```

## Health check

```bash
curl -s http://<host>:7878/health
# → {"ok":true,"version":"0.1.0","claude":{"found":true,"path":"/usr/local/bin/claude"}}
```

`/health` is the only endpoint that doesn't require a bearer token. Use it for monitoring / readiness checks.

## Logs

When run via launchd, stdout/stderr go to `~/.remote-claude/logs/`. The Fastify logger uses one JSON line per request — easy to grep:

```bash
tail -f ~/.remote-claude/logs/agent.out.log | grep '"url":"/ask"'
```

In the foreground, log lines go to your terminal in the same JSON format.

## Hardening checklist

- [ ] Bind to a private interface (`RC_AGENT_HOST=127.0.0.1` or your tailnet IP) — never `0.0.0.0` on a public network.
- [ ] Long random token (`openssl rand -hex 32`) — `install` does this for you.
- [ ] `~/.remote-claude/agent.env` is chmod 600.
- [ ] Each project under `RC_PROJECTS_ROOT` is a clean git checkout.
- [ ] The `claude` binary you point at is the official one from Anthropic.
