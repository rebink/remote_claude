---
title: Roadmap
description: What's shipped, what's next, and what's intentionally deferred.
---

## Shipped (v0.1.0)

- ✅ `remote-claude` CLI with `setup`, `init`, `sync`, `ask`, `apply`, `doctor`
- ✅ `remote-claude-agent` HTTP server with `/health` + `/ask`
- ✅ Bearer-token auth (constant-time)
- ✅ Selective per-file apply
- ✅ `remote-claude-agent install/uninstall` (macOS launchd)
- ✅ Tailscale peer auto-discovery in `setup`
- ✅ 15 vitest tests + GitHub Actions CI on Node 20+22
- ✅ Installable via `pnpm add -g github:rebink/remote_claude` (no npm publish required)
- ✅ Docs site

## Near-term (v0.2.x)

- 🔜 Publish to npm (`remote-claude` registry slot)
- 🔜 Streaming Claude stdout to the laptop while it runs
- 🔜 Linux `systemd` install command (parity with macOS launchd)
- 🔜 Per-project tokens (one credential per project, not one per machine)
- 🔜 Audit log of every `/ask` (timestamp + prompt hash + diff stats)
- 🔜 `remote-claude diff <last-N>` to inspect prior runs

## Mid-term (v0.3.x)

- 📋 Smart context selection — pre-trim the prompt to imports/dependencies of the touched files (Dart-aware first, language-by-language)
- 📋 VS Code extension — surface the diff preview in the editor side panel
- 📋 Optional TLS for the agent (self-signed + cert pinning)
- 📋 Multiple agents per laptop (e.g. one Mini at home, one at the office)

## Long-term (vision)

- 💭 Multi-developer isolation on a single Mini (per-user `RC_PROJECTS_ROOT`, per-user tokens, fair queuing)
- 💭 Plugin layer for non-Claude LLMs (anything with a "edit files in cwd" mode)
- 💭 Hosted/cloud agent option for teams without a Mini
- 💭 Pre-flight `git apply --check` against your laptop's *local* tree as part of the agent response, so you know up-front if a patch will need rebasing

## Explicit non-goals

- ❌ **Bidirectional file sync.** The whole product premise is one-way. We're not adding the other direction.
- ❌ **Real-time co-editing.** Remote Claude is request/response. If you want autocomplete or inline ghost-text, run Claude Code locally.
- ❌ **Becoming a full remote-IDE.** Editor stays local. Always.

## Want to influence the roadmap?

Open an issue at the [GitHub repo](https://github.com/rebink/remote_claude/issues) and describe the workflow pain you're trying to solve. We weight requests by how concretely they're tied to a real workflow, not by upvote count.
