---
title: Running the agent
description: launchd, systemd, foreground, logs, and lifecycle.
---

The agent is a small Fastify HTTP server. It has no required state between requests — restart it any time.

## macOS — managed via launchd (recommended)

```bash
patchwire-agent install
```

Writes `~/Library/LaunchAgents/com.patchwire.agent.plist`, loads it, and prints the bearer token. The service auto-starts on every login and restarts if it crashes (`KeepAlive=true`).

### Where things live

| Path | Purpose |
| --- | --- |
| `~/Library/LaunchAgents/com.patchwire.agent.plist` | launchd config |
| `~/.patchwire/agent.env` | env vars (chmod 600) |
| `~/.patchwire/logs/agent.out.log` | stdout |
| `~/.patchwire/logs/agent.err.log` | stderr |

### Lifecycle

```bash
# stop
launchctl unload ~/Library/LaunchAgents/com.patchwire.agent.plist

# start
launchctl load ~/Library/LaunchAgents/com.patchwire.agent.plist

# remove entirely
patchwire-agent uninstall
```

### Customizing the install

```bash
patchwire-agent install \
  --projects-root /Volumes/Code/projects \
  --port 9090 \
  --host 100.64.0.7 \
  --token "$(cat ~/.tokens/rc)" \
  --claude-bin /opt/homebrew/bin/claude
```

Re-running `install` regenerates the plist and reloads launchd.

## macOS / Linux — foreground (for testing)

```bash
export PW_AGENT_TOKEN=…
export PW_PROJECTS_ROOT=~/workspace
export PW_AGENT_HOST=0.0.0.0
patchwire-agent
# → Server listening at http://0.0.0.0:7878
```

Ctrl-C to stop. Useful for tailing logs interactively or debugging.

## Linux — systemd (manual setup)

The `install` subcommand is currently macOS-only. On Linux, write a unit yourself:

```ini
# /etc/systemd/system/patchwire-agent.service
[Unit]
Description=Patchwire Agent
After=network.target

[Service]
Type=simple
User=rebin
EnvironmentFile=/home/rebin/.patchwire/agent.env
ExecStart=/usr/bin/env patchwire-agent
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now patchwire-agent
systemctl status patchwire-agent
journalctl -u patchwire-agent -f
```

## Health check

```bash
curl -s http://<host>:7878/health
# → {"ok":true,"version":"0.1.0","claude":{"found":true,"path":"/usr/local/bin/claude"}}
```

`/health` is the only endpoint that doesn't require a bearer token. Use it for monitoring / readiness checks.

## Logs

When run via launchd, stdout/stderr go to `~/.patchwire/logs/`. The Fastify logger uses one JSON line per request — easy to grep:

```bash
tail -f ~/.patchwire/logs/agent.out.log | grep '"url":"/ask"'
```

In the foreground, log lines go to your terminal in the same JSON format.

## Hardening checklist

- [ ] Bind to a private interface (`PW_AGENT_HOST=127.0.0.1` or your tailnet IP) — never `0.0.0.0` on a public network.
- [ ] Long random token (`openssl rand -hex 32`) — `install` does this for you.
- [ ] `~/.patchwire/agent.env` is chmod 600.
- [ ] Each project under `PW_PROJECTS_ROOT` is a clean git checkout.
- [ ] The `claude` binary you point at is the official one from Anthropic.
