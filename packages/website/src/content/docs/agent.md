---
title: Running the agent
description: launchd, systemd, foreground, logs, and lifecycle.
---

The agent is a small Fastify HTTP server. It has no required state between requests, so you can restart it any time.

## macOS: managed via launchd (recommended)

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
  --host <your-ip> \
  --token "$(cat ~/.tokens/rc)" \
  --claude-bin /opt/homebrew/bin/claude
```

Re-running `install` regenerates the plist and reloads launchd.

### Adding more developers

The agent supports multiple developers. Each gets their own token:

```bash
patchwire-agent user add alice
# → prints a hex token, copy it to Alice's ~/.patchwire/env as PW_TOKEN

patchwire-agent user list       # see who's registered
patchwire-agent user rotate bob # invalidate Bob's old token, issue a new one
patchwire-agent user disable carol  # carol's requests now get 403, no delete
```

Tokens are stored hashed in `~/.patchwire/users.json`; the plaintext is shown
to you exactly once.

### Project layout on the agent

As of v0.2, every project lives under a user namespace:

```
PROJECTS_ROOT/
├── alice/
│   ├── flutter-app/        # rsync target for Alice's `patchwire ask`
│   └── backend/
└── bob/
    └── flutter-app/        # Bob's copy — distinct from Alice's
```

The agent resolves `<projectsRoot>/<username>/<project>` per request, where
`<username>` comes from the authenticated bearer token. This means two
developers can have a project with the same name without collision.

On upgrade from v0.1, the first `patchwire-agent serve` run after install
moves any top-level `PROJECTS_ROOT/<project>/` into `PROJECTS_ROOT/default/<project>/`
automatically, so existing single-user setups keep working without manual
file moves.

### Concurrency + queue (v0.2.2+)

The agent caps simultaneous Claude runs to avoid melting the box under team load:

- `PW_MAX_CONCURRENT_TOTAL` (default `3`) — global ceiling.
- `PW_MAX_CONCURRENT_PER_USER` (default `1`) — per-user ceiling so no single
  developer hogs all slots while teammates wait.

Requests that exceed either cap wait in arrival order (FIFO). The response carries:

- `X-Patchwire-Queue-Wait-Ms` — how long the request waited (always present).
- `X-Patchwire-Queue-Position-At-Entry` — position in the global queue at entry (only when wait > 0).

A read-only `GET /queue` endpoint returns the current snapshot:

```json
{
  "globalCap": 3,
  "perUserCap": 1,
  "inFlight": ["alice"],
  "queued": [{"user": "bob", "position": 1}]
}
```

## macOS or Linux: foreground (for testing)

```bash
export PW_AGENT_TOKEN=…
export PW_PROJECTS_ROOT=~/workspace
export PW_AGENT_HOST=0.0.0.0
patchwire-agent
# → Server listening at http://0.0.0.0:7878
```

Ctrl-C to stop. Useful for tailing logs interactively or debugging.

## Linux: systemd (manual setup)

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

When run via launchd, stdout and stderr go to `~/.patchwire/logs/`. The Fastify logger uses one JSON line per request, which makes it easy to grep:

```bash
tail -f ~/.patchwire/logs/agent.out.log | grep '"url":"/ask"'
```

In the foreground, log lines go to your terminal in the same JSON format.

## Hardening checklist

- [ ] Bind to a private interface (`PW_AGENT_HOST=127.0.0.1` or your tailnet IP). Never `0.0.0.0` on a public network.
- [ ] Long random token (`openssl rand -hex 32`). `install` does this for you.
- [ ] `~/.patchwire/agent.env` is chmod 600.
- [ ] Each project under `PW_PROJECTS_ROOT` is a clean git checkout.
- [ ] The `claude` binary you point at is the official one from Anthropic.
