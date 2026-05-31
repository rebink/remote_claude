---
title: Quickstart
description: Get a working laptop ↔ Mac Mini setup in under five minutes.
---

> Three commands per machine. The whole flow assumes Tailscale is running for connectivity — see [Networking](/networking/) for alternatives.

## Prerequisites

- Node.js **≥ 20** on both machines
- `git`, `rsync`, `ssh` on both
- [`claude` CLI](https://docs.claude.com/en/docs/claude-code/quickstart) on the **remote** Mac
- SSH key-based access from the laptop to the remote

```bash
# install Tailscale on both Macs (if not already)
brew install tailscale && sudo tailscale up
```

## On the Mac Mini

```bash
# 1. install
pnpm add -g github:rebink/patchwire

# 2. register as a launchd LaunchAgent (auto-starts on login)
patchwire-agent install
# → prints TOKEN — copy it for the next step
```

What `install` does:

- Generates a 32-byte token (or reuses `PW_AGENT_TOKEN` if you already exported one)
- Writes `~/Library/LaunchAgents/com.patchwire.agent.plist`
- `launchctl load`s it so the agent runs on every login
- Saves env vars to `~/.patchwire/agent.env` (chmod 600)
- Logs to `~/.patchwire/logs/agent.{out,err}.log`

That's it on the Mini. The agent is now serving on `PW_AGENT_PORT` (default `7878`).

## On the laptop

```bash
# 1. install
pnpm add -g github:rebink/patchwire

# 2. interactive setup
cd ~/code/my_flutter_app
patchwire setup
# → reads `tailscale status --json`, lists peers, you pick the Mac Mini
# → writes patchwire.yml + ~/.patchwire/env
```

Then:

```bash
# load the token in your shell (paste the TOKEN from the agent install above
# into ~/.patchwire/env first if you didn't already)
echo 'source ~/.patchwire/env' >> ~/.zshrc
source ~/.patchwire/env

# 3. verify the connection
patchwire doctor
```

If `doctor` is all green, you're done. Try a real ask:

```bash
patchwire ask "add a HELLO.md with a friendly hello"
# → syncs, runs claude on remote, shows a diff, asks before applying
```

## What just happened

1. `patchwire` rsync'd your project to `PW_PROJECTS_ROOT/<project>` on the Mini.
2. The Mini's agent verified the working tree was clean, ran `claude --print "<prompt>"` in that dir.
3. After Claude finished, the agent ran `git add -A && git diff --cached`, captured the patch, then `git reset --hard HEAD && git clean -fd` to restore the tree.
4. The patch came back over HTTP, you previewed it, and `git apply` ran locally.

Your laptop never executed any AI; the remote never modified your local files.

## Next steps

- [Architecture](/architecture/) — what's actually happening under the hood
- [Configuration](/configuration/) — every option in `patchwire.yml`
- [Networking](/networking/) — Tailscale, LAN, alternatives
- [Troubleshooting](/troubleshooting/) — when `doctor` isn't green
