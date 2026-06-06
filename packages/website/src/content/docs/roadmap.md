---
title: Roadmap
description: What's shipped, what's next, and what's intentionally deferred.
---

## Shipped (through v0.3.0)

- ✅ `patchwire` CLI with `setup`, `init`, `init-remote`, `sync`, `ask`, `apply`, `chat`, `doctor`, `whoami`
- ✅ `patchwire-agent` HTTP server with `/health`, `/ask`, `/chat`
- ✅ Bearer-token auth (constant-time); published to npm as `@rebink/patchwire`
- ✅ Selective per-file apply
- ✅ `patchwire-agent install/uninstall` (macOS launchd; Linux systemd)
- ✅ Tailscale peer auto-discovery in `setup`
- ✅ Multi-developer isolation — per-user bearer tokens, isolated project directories, fair request queue
- ✅ `patchwire-agent user` — add / list / disable / enable / rm / rotate
- ✅ Per-user policy enforcement — project allowlist + rate limit on `/ask` and `/chat`
- ✅ JSONL audit log (every `/ask` and `/chat`; stores `prompt_sha256`, never plaintext)
- ✅ `patchwire-agent log` — filtered audit log viewer
- ✅ `patchwire-agent usage` — per-user requests / accepted / ask / chat / lines added-removed / duration
- ✅ Streamed `/ask` (NDJSON live queue visibility while Claude runs)
- ✅ VS Code extension (bundled; surfaced diff preview and multi-turn chat in the editor)
- ✅ Secret-safe sync (rsync respects `.gitignore` and `sync.exclude`)
- ✅ GitHub repo: [rebink/remote_claude](https://github.com/rebink/remote_claude)

## Near-term

- 🔜 Per-developer **dollar-cost** reporting — needs model name + token counts captured in the audit log; `usage` will then show estimated spend
- 🔜 Publish VS Code extension to the Marketplace and Open VSX Registry

## Exploring / not committed

- 💭 Build-cache sharing across developers on the same agent (Dart/Flutter `pub` cache, `node_modules` snapshots)
- 💭 Hosted agent option — run the agent on a cloud VM without needing a dedicated machine

## Decided against

- ❌ **Android device bridge.** Edits apply to the local working tree, so developers run `flutter run` locally. A remote device bridge is off-model and adds complexity with no benefit.
- ❌ **iOS remote debugging.** Same reasoning as Android.
- ❌ **Bidirectional file sync.** The product premise is one-way. We're not adding the other direction.
- ❌ **Real-time co-editing.** Patchwire is request/response. For inline completions, run Claude Code locally.
- ❌ **Becoming a full remote-IDE.** Editor stays local. Always.

## Want to influence the roadmap?

Open an issue at the [GitHub repo](https://github.com/rebink/remote_claude/issues) and describe the workflow pain you're trying to solve. We weight requests by how concretely they're tied to a real workflow, not by upvote count.
