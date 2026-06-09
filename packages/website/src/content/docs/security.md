---
title: Security model
description: What's protected, by what, and where the trust boundaries live.
---

## Threat model

Patchwire is **single-developer** software. The threat model assumes:

- One person controls both the laptop and the remote.
- Both machines live behind your home firewall (or, ideally, inside a Tailscale tailnet).
- The attacker is *not* on your private network. If they are, you have bigger problems than Patchwire.

It does *not* assume:

- A multi-tenant remote with hostile users, that's out of scope for v1.
- Public internet exposure, strongly discouraged (see [Networking](/networking/)).

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
| Laptop ↔ remote transport | Tailscale's WireGuard (or your equivalent) |
| Bearer token in HTTP | Same as above. **Plain HTTP** is fine *only* over Tailscale/VPN. If you ever expose the agent on the public internet, terminate TLS in front (nginx + Let's Encrypt) and rotate the token. |
| SSH | Standard SSH host keys + your client key. |

## Project name allowlist

The `project` field in `/ask` is regex-restricted to `[a-zA-Z0-9_.-]+`. This blocks `..`, slashes, and shell metacharacters at the API boundary, so a malicious caller can't escape `PW_PROJECTS_ROOT` and read or overwrite files outside it.

## Working-tree contract

The agent refuses to run if the project's git working tree is dirty (`409`). Why:

1. We use `git diff --cached` to capture changes *the AI made*. Any pre-existing dirt would corrupt that diff.
2. We restore the tree afterwards with `git reset --hard HEAD && git clean -fd`. If there were pre-existing untracked files, that reset would destroy them. The 409 prevents that.

If you ever see a `409`, **don't** force the run, investigate. Either the previous run failed in a way that didn't reset, or someone (you, a hook, another tool) edited the project on the remote.

## What we don't do

- **No automatic apply on the laptop.** Every change is gated on your `enter`. Even with `--save-only`, nothing is applied until you run `patchwire apply`.
- **No automatic ranges of files in selective apply.** You explicitly toggle each file.
- **No execution of arbitrary remote commands.** The CLI's only RPC is `/ask`. There is no `/exec`. There never will be.
- **No outbound calls to anywhere except your configured agent URL.** No telemetry. No analytics. No "phone home".

## Token handling

- `patchwire-agent install` generates a 32-byte hex token (256 bits of entropy).
- Stored on the remote in `~/.patchwire/agent.env` and embedded in the launchd plist (which lives under `~/Library/LaunchAgents`, only your user can read it).
- Stored on the laptop in `~/.patchwire/env`, chmod 600.
- Never written to git (the `.gitignore` is auto-configured by `setup`).
- Comparison is `crypto.timingSafeEqual` to defeat timing attacks.

To rotate: regenerate on the remote (`patchwire-agent install --token <new>`) and update `~/.patchwire/env` on the laptop. Re-source.

## Per-user tokens (v0.2+)

The agent now supports multiple developers via per-user bearer tokens:

- `patchwire-agent user add <name>` generates a 256-bit token and prints it once.
- Tokens are stored hashed (SHA-256) in `~/.patchwire/users.json`; plaintext is never persisted on the agent.
- A laptop authenticates by putting `PW_TOKEN=<the-token>` in `~/.patchwire/env`.
- `patchwire-agent user rotate <name>` invalidates the old token immediately.

A v0.1 install upgrades transparently: on first v0.2 agent start, if `PW_AGENT_TOKEN`
is set and `users.json` does not exist, a `default` user is created with that token's
hash. Existing laptops keep working with no config change.

For the full multi-developer model (identity, isolated checkouts, the fair queue,
and the audit log) see [Multi-developer](/multi-developer/).

## What Anthropic sees

Same as if you ran `claude` locally. Claude Code on the remote sends prompts and relevant file context to Anthropic's API per its own data policy. Patchwire doesn't add to or subtract from that surface. Read [Anthropic's data handling docs](https://docs.claude.com/en/docs/claude-code/security) for specifics.

## Already shipped

- **Audit log** of every `/ask` and `/chat` — JSONL with timestamps and a `prompt_sha256` (never the plaintext prompt). View it with `patchwire-agent log`. See [Multi-developer](/multi-developer/).

## Default-deny egress (experimental — not recommended yet)

:::caution[Experimental; off by default; not recommended for trusted-network setups]
Egress lock-down is **dormant capability, not a recommended control.** On a
trusted network (your own machine on Tailscale, running your own repos), the
practical security comes from **read-minimization, Tailscale, per-user tokens,
and the audit log** — egress is marginal defense-in-depth against a low-probability
prompt-injection-exfiltration threat. And there's a real limitation today (below).
**Leave `PW_EGRESS=off`** unless you're hardening against untrusted code for a
regulated/enterprise context, and even then, verify carefully.
:::

The idea: read-minimization stops the agent from *seeing* un-synced secrets;
egress lock-down would stop it from *exfiltrating* the code you did sync.
Setting **`PW_EGRESS=deny`** runs `claude` under a macOS seatbelt (`sandbox-exec`)
profile that blocks **all** outbound except localhost, DNS, and a resolved
allowlist (the Anthropic API by default). It's **fail-closed** and uses IP
literals only (no hostname-suffix matching).

**Known limitation:** the allowlist pins the Anthropic API by *resolved IP*, but
`api.anthropic.com` sits behind a CDN with rotating IPs (and IPv6), so `claude`'s
connection often lands on an IP that isn't pinned — and gets blocked along with
everything else. `patchwire-agent egress-check` surfaces this: it will show the
deny working (`example.com` blocked) but the API unreachable. A robust fix
(a hostname-allowlisting local proxy) is future work; until then egress is not
production-usable.

**Always verify before enabling:** `patchwire-agent egress-check` — and if the
Anthropic API shows unreachable, keep it off.

## What we'd like to add

- **Optional TLS** for the agent (likely a flag on `install` that wires up a self-signed cert + cert pinning on the CLI).
- **Per-project tokens** so each project has its own credential.
- **Egress on Linux** (network-namespace backend) + timer-based IP re-resolution.

Open an issue if you'd find any of these load-bearing.
