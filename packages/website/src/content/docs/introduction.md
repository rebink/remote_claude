---
title: Introduction
description: What Remote Claude is, what it isn't, and who it's for.
---

## What it is

Remote Claude is a tiny CLI + HTTP agent pair that lets you run [Claude Code](https://docs.claude.com/en/docs/claude-code/) on a different machine than the one you're typing on. The local machine stays the source of truth; the remote does the AI heavy-lifting; changes come back as a **reviewable unified diff**.

It's two binaries:

| Binary | Where it runs | What it does |
| --- | --- | --- |
| `remote-claude` | Your laptop | Syncs the project, calls the agent, previews diffs, runs `git apply` |
| `remote-claude-agent` | A bigger Mac (or any Linux box) | Runs `claude --print` on a clean checkout and returns a `git diff` |

## Who it's for

- **Mobile/Flutter/Dart engineers** whose builds and AI runs are heavy enough that they want a dedicated Mac doing them.
- **Anyone with a desktop Mac** who wants their laptop to feel light.
- **Teams** considering "remote dev" but who hate filesystem latency. This isn't `code-server`. The IDE never touches the remote.
- **Privacy-aware folks** who want the network plane to stay inside Tailscale, with bearer-token auth, and *no internet exposure*.

## What it isn't

- **Not a full remote IDE.** Your editor, formatter, debugger, hot-reload — all local. Only the AI is remote.
- **Not a sync product.** `rsync` runs on demand, one-way, with explicit excludes. Nothing watches your filesystem in the background.
- **Not multi-tenant.** v1 assumes one developer, one Mac Mini. Multi-developer isolation is a future enhancement.
- **Not a Claude alternative.** It calls `claude` on the remote — you still need a Claude Code subscription.

## Design principles

1. **Local stays local.** Your machine is always the truth.
2. **Reviewable changes only.** Nothing is applied without a diff and your `enter`.
3. **Boring transport.** SSH + rsync + HTTP. No custom protocols.
4. **Defense in depth.** Bearer-token auth + SSH keys + private network (Tailscale).
5. **Fail safe.** A failed AI run leaves the remote tree exactly as it was.

## Status

v0.1.0 — core MVP shipped. See [Roadmap](/roadmap/) for what's next.
