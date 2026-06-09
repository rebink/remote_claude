---
title: Roadmap
description: What's shipped, what's next, and what's intentionally deferred.
---

## Shipped (through v0.3.5)

- ✅ `patchwire` CLI with `setup`, `init`, `init-remote`, `sync`, `ask`, `apply`, `chat`, `doctor`, `whoami`
- ✅ `patchwire-agent` HTTP server with `/health`, `/ask`, `/chat`
- ✅ Bearer-token auth (constant-time); published to npm as `@rebink/patchwire`
- ✅ Selective per-file apply
- ✅ `patchwire-agent install/uninstall` (macOS launchd; Linux systemd)
- ✅ Tailscale peer auto-discovery in `setup`
- ✅ Multi-developer isolation: per-user bearer tokens, isolated project directories, fair request queue
- ✅ `patchwire-agent user`: add / list / disable / enable / rm / rotate
- ✅ Per-user policy enforcement: project allowlist + rate limit on `/ask` and `/chat`
- ✅ JSONL audit log (every `/ask` and `/chat`; stores `prompt_sha256`, never plaintext)
- ✅ `patchwire-agent log`: filtered audit log viewer
- ✅ `patchwire-agent usage`: per-user requests / accepted / ask / chat / lines added-removed / duration / **tokens + dollar cost** (`TOK` / `$EQV`)
- ✅ Streamed `/ask` (NDJSON live queue visibility while Claude runs)
- ✅ VS Code extension (bundled; surfaced diff preview and multi-turn chat in the editor); published to the **Marketplace + Open VSX**
- ✅ Secret-safe sync (rsync respects `.gitignore` and `sync.exclude`)
- ✅ **Reliable 3-way apply**: detects local drift since sync and merges instead of failing
- ✅ **Test-before-return**: optional `PW_VERIFY_CMD` runs on the checkout so you review a validated diff
- ✅ **Pre-sync secret scan** (`sync.secretScan`): gitleaks blocks/warns before a tracked-file secret can cross
- ✅ **Cost & token visibility**: `usage` shows `TOK` and `$EQV`; provider-reported cost where available, operator price-table fallback (`~estimated`). See [Configuration → Cost tracking](/configuration/#cost-tracking).
- ✅ **Local file attachments**: `patchwire push` and a VS Code **📎 Attach** button get local files (incl. screenshots/images for vision) to the remote `claude`, via a gitignored `.patchwire-inbox/`. The panel lists staged attachments and lets you open or delete any of them (delete clears the remote copy too). See [Configuration → Attachments](/configuration/#attachments).
- 🧪 **Default-deny egress** (macOS, **experimental, off by default**): the seatbelt deny works, but the Anthropic allowlist is brittle against the API's CDN IPs, so it's **not production-usable yet** and not recommended for trusted-network setups. See [Security → Default-deny egress](/security/#default-deny-egress-experimental--not-recommended-yet).
- ✅ GitHub repo: [rebink/remote_claude](https://github.com/rebink/remote_claude)

## Near-term

- 🔜 Per-request **model selection** + an "allowed models" policy
- 🔜 Dollar-cost **on the chat path** (chat already records real tokens; cost attribution is next)
- 🔜 **Egress: timer-based IP re-resolution** + a Linux (netns) backend

## Exploring / not committed

- 💭 Build-cache sharing across developers on the same agent (Dart/Flutter `pub` cache, `node_modules` snapshots)
- 💭 Hosted agent option: run the agent on a cloud VM without needing a dedicated machine

## Decided against

- ❌ **Android device bridge.** Edits apply to the local working tree, so developers run `flutter run` locally. A remote device bridge is off-model and adds complexity with no benefit.
- ❌ **iOS remote debugging.** Same reasoning as Android.
- ❌ **Bidirectional file sync.** The product premise is one-way. We're not adding the other direction.
- ❌ **Real-time co-editing.** Patchwire is request/response. For inline completions, run Claude Code locally.
- ❌ **Becoming a full remote-IDE.** Editor stays local. Always.

## Want to influence the roadmap?

Open an issue at the [GitHub repo](https://github.com/rebink/remote_claude/issues) and describe the workflow pain you're trying to solve. We weight requests by how concretely they're tied to a real workflow, not by upvote count.
