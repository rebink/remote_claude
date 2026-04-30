---
title: Security model
description: What's protected, by what, and where the trust boundaries live.
---

## Threat model

Remote Claude is **single-developer** software. The threat model assumes:

- One person controls both the laptop and the Mac Mini.
- Both machines live behind your home firewall (or, ideally, inside a Tailscale tailnet).
- The attacker is *not* on your private network. If they are, you have bigger problems than Remote Claude.

It does *not* assume:

- A multi-tenant Mac Mini with hostile users — that's out of scope for v1.
- Public internet exposure — strongly discouraged (see [Networking](/networking/)).

## Layers of defense

```
1. Network plane          → Tailscale (or LAN, or your own tunnel)
2. SSH                    → key-based, no passwords
3. HTTP API               → bearer token (constant-time compare)
4. Project sandboxing     → strict project name regex, fixed root dir
5. Working-tree contract  → clean before run, restored after run
6. Local apply gate       → diff preview + git apply --check
```

If any one layer fails, the next still applies. We rely on no single check.

## What's signed / encrypted

| Channel | Protected by |
| --- | --- |
| Laptop ↔ Mini transport | Tailscale's WireGuard (or your equivalent) |
| Bearer token in HTTP | Same as above. **Plain HTTP** is fine *only* over Tailscale/VPN. If you ever expose the agent on the public internet, terminate TLS in front (nginx + Let's Encrypt) and rotate the token. |
| SSH | Standard SSH host keys + your client key. |

## Project name allowlist

The `project` field in `/ask` is regex-restricted to `[a-zA-Z0-9_.-]+`. This blocks `..`, slashes, and shell metacharacters at the API boundary, so a malicious caller can't escape `RC_PROJECTS_ROOT` and read or overwrite files outside it.

## Working-tree contract

The agent refuses to run if the project's git working tree is dirty (`409`). Why:

1. We use `git diff --cached` to capture changes *the AI made*. Any pre-existing dirt would corrupt that diff.
2. We restore the tree afterwards with `git reset --hard HEAD && git clean -fd`. If there were pre-existing untracked files, that reset would destroy them. The 409 prevents that.

If you ever see a `409`, **don't** force the run — investigate. Either the previous run failed in a way that didn't reset, or someone (you, a hook, another tool) edited the project on the Mini.

## What we don't do

- **No automatic apply on the laptop.** Every change is gated on your `enter`. Even with `--save-only`, nothing is applied until you run `remote-claude apply`.
- **No automatic ranges of files in selective apply.** You explicitly toggle each file.
- **No execution of arbitrary remote commands.** The CLI's only RPC is `/ask`. There is no `/exec`. There never will be.
- **No outbound calls to anywhere except your configured agent URL.** No telemetry. No analytics. No "phone home".

## Token handling

- `remote-claude-agent install` generates a 32-byte hex token (256 bits of entropy).
- Stored on the Mini in `~/.remote-claude/agent.env` and embedded in the launchd plist (which lives under `~/Library/LaunchAgents` — only your user can read it).
- Stored on the laptop in `~/.remote-claude/env`, chmod 600.
- Never written to git (the `.gitignore` is auto-configured by `setup`).
- Comparison is `crypto.timingSafeEqual` to defeat timing attacks.

To rotate: regenerate on the Mini (`remote-claude-agent install --token <new>`) and update `~/.remote-claude/env` on the laptop. Re-source.

## What Anthropic sees

Same as if you ran `claude` locally. Claude Code on the Mini sends prompts and relevant file context to Anthropic's API per its own data policy. Remote Claude doesn't add to or subtract from that surface. Read [Anthropic's data handling docs](https://docs.claude.com/en/docs/claude-code/security) for specifics.

## What we'd like to add

- **Optional TLS** for the agent (likely a flag on `install` that wires up a self-signed cert + cert pinning on the CLI).
- **Per-project tokens** so each project has its own credential.
- **Audit log** of every `/ask` with timestamps and prompt hash.

Open an issue if you'd find any of these load-bearing.
