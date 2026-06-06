---
title: Quickstart
description: Get a working laptop ↔ remote setup in under five minutes.
---

> Three commands per machine. The whole flow assumes Tailscale is running for connectivity. See [Networking](/networking/) for alternatives.

## Prerequisites

- Node.js **≥ 20** on both machines
- `git`, `rsync`, and `ssh` on both
- [`claude` CLI](https://docs.claude.com/en/docs/claude-code/quickstart) on the **remote** machine
- SSH key-based access from your laptop to the remote

```bash
# install Tailscale on both machines if you don't have it
brew install tailscale && sudo tailscale up
```

## On the remote

```bash
# 1. install
npm i -g @rebink/patchwire

# 2. register as a launchd LaunchAgent (auto-starts on login, macOS only)
patchwire-agent install
# prints a TOKEN. Copy it. You'll paste it on the laptop in a moment.
```

What `install` does:

- Generates a 32-byte token, or reuses `PW_AGENT_TOKEN` if you already exported one.
- Writes `~/Library/LaunchAgents/com.patchwire.agent.plist`.
- Runs `launchctl load` so the agent starts on every login.
- Saves env vars to `~/.patchwire/agent.env` (chmod 600).
- Logs to `~/.patchwire/logs/agent.{out,err}.log`.

That's it on the remote. The agent now serves on `PW_AGENT_PORT` (default `7878`).

## On the laptop

```bash
# 1. install
npm i -g @rebink/patchwire

# 2. interactive setup
cd ~/code/my_flutter_app
patchwire setup
# reads `tailscale status --json`, lists peers, you pick the remote
# writes patchwire.yml and ~/.patchwire/env
```

> **Multi-user agents:** if you're connecting to a shared agent box, pass
> `--username <yourname>` to `patchwire setup`. The agent admin will have
> issued you a token via `patchwire-agent user add <yourname>`. Your projects
> will live under `PROJECTS_ROOT/<yourname>/` on the agent so they don't
> collide with teammates' projects of the same name.

Then:

```bash
# load the token in your shell. Paste the TOKEN from the agent install
# into ~/.patchwire/env first if you didn't already.
echo 'source ~/.patchwire/env' >> ~/.zshrc
source ~/.patchwire/env

# 3. verify the connection
patchwire doctor
```

If `doctor` is all green, you're done. Try a real ask:

```bash
patchwire ask "add a HELLO.md with a friendly hello"
# syncs, runs claude on the remote, shows a diff, asks before applying
```

## What just happened

1. `patchwire` rsync'd your project to `PW_PROJECTS_ROOT/<project>` on the remote.
2. The remote's agent verified the working tree was clean, then ran `claude --print "<prompt>"` in that directory.
3. After Claude finished, the agent ran `git add -A && git diff --cached`, captured the patch, then `git reset --hard HEAD && git clean -fd` to restore the tree.
4. The patch came back over HTTP. You previewed it. `git apply` ran locally.

The remote never modified your local files. Your laptop never executed the AI.

## Next steps

- [Architecture](/architecture/) for what's actually happening under the hood
- [Configuration](/configuration/) for every option in `patchwire.yml`
- [Networking](/networking/) for Tailscale, LAN, and alternatives
- [Troubleshooting](/troubleshooting/) for when `doctor` isn't green
