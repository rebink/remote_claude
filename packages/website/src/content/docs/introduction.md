---
title: Introduction
description: What Patchwire is, what it isn't, and who it's for.
---

## What it is

Patchwire is a small CLI plus HTTP agent that lets you run [Claude Code](https://docs.claude.com/en/docs/claude-code/) on a different machine than the one you're typing on. Your laptop stays the source of truth. The remote does the heavy AI work. Changes come back as a reviewable unified diff.

It's two binaries:

| Binary | Where it runs | What it does |
| --- | --- | --- |
| `patchwire` | Your laptop | Syncs the project, calls the agent, previews diffs, runs `git apply` |
| `patchwire-agent` | A bigger machine (Mac or Linux) | Runs `claude --print` on a clean checkout and returns a `git diff` |

## Who it's for

- Mobile, Flutter, and Dart engineers whose builds and AI runs are heavy enough that they want a dedicated machine doing them.
- Anyone with a desktop that's faster than their laptop and wants the laptop to stay quiet.
- Teams curious about "remote dev" but allergic to filesystem latency. This isn't `code-server`. The IDE never touches the remote.
- Privacy-aware folks who want the network plane to stay inside Tailscale, with bearer-token auth, and no exposure to the public internet.

## What it isn't

- Not a full remote IDE. Your editor, formatter, debugger, and hot-reload all stay local. Only the AI is remote.
- Not a sync product. `rsync` runs on demand, one-way, with explicit excludes. Nothing watches your filesystem in the background.
- Not multi-tenant. v1 assumes one developer, one remote. Multi-developer isolation is a future enhancement.
- Not a Claude replacement. It calls `claude` on the remote, so you still need a Claude Code subscription.

## Design principles

1. **Local stays local.** Your machine is always the truth.
2. **Reviewable changes only.** Nothing is applied without a diff and your `enter`.
3. **Boring transport.** SSH, rsync, and HTTP. No custom protocols.
4. **Defense in depth.** Bearer-token auth plus SSH keys plus a private network (Tailscale).
5. **Fail safe.** A failed AI run leaves the remote tree exactly as it was.

## Status

v0.1.0. Core MVP is shipped. See [Roadmap](/roadmap/) for what's next.
