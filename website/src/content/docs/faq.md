---
title: FAQ
description: Frequently asked questions about Remote Claude.
---

### Does this work without Tailscale?

Yes. Tailscale is just the easiest way to give the laptop a stable, private route to the Mini. LAN works the same way. So does any VPN. The CLI doesn't know about Tailscale beyond `setup`'s peer-discovery convenience.

### Does this work outside macOS?

The CLI runs on any platform with Node ≥ 20, `git`, `rsync`, and `ssh` (so: macOS and Linux).

The agent **server** runs anywhere too. The `install` subcommand for launchd is macOS-only — on Linux, write a `systemd` unit (one is shown in [Running the agent](/agent/)).

### Can the agent run on Linux instead of a Mac?

Yes. We just need `claude`, `git`, and Node. The "Mac Mini" framing in docs is the common case, not a hard requirement.

### What happens if the laptop and Mini are out of sync (different commits)?

The agent doesn't care about your laptop's git state. It only cares that *its own* working tree is clean before each run. The diff it returns is computed against whatever's on the Mini. As long as your laptop tree is at the same commit as the Mini (which is what `rsync --delete` enforces), `git apply` will work.

If you've committed locally between sync and apply, the patch may still apply — `git apply` is line-based, not commit-based. If it doesn't, you'll see a `git apply --check` failure and the patch is saved to `.remote-claude/last.patch`.

### Can two laptops share one Mac Mini?

In v1, no isolation between laptops/users. Two callers using different `project` names won't collide on disk, but they share `RC_AGENT_TOKEN` and there's no per-call concurrency control inside one project. Multi-user is on the [roadmap](/roadmap/).

### Is the prompt sent to Anthropic?

Yes — by `claude` running on the Mini, exactly as if you ran `claude` locally. Remote Claude doesn't add any third party to the picture. See [Anthropic's data policy](https://docs.claude.com/en/docs/claude-code/security).

### Can I use a different LLM CLI?

Yes, in principle. The agent just spawns `RC_CLAUDE_BIN` with `RC_CLAUDE_ARGS` and pipes the prompt to stdin. Any tool that *edits files in place* and exits 0 on success will work. We've only tested with `claude`.

### Does this stream output?

Not yet. v1 is request/response — you wait for the whole run, then see the diff. Streaming is on the roadmap, but harder than it sounds because we don't know what changed until `git diff` runs at the end.

### How big can the project be?

Tested up to ~1k files post-excludes. The bottlenecks are (a) Claude's own context handling and (b) initial rsync time. Incremental syncs are tiny regardless of repo size.

### Why one-way sync?

Bidirectional sync sounds nicer in theory and is a nightmare in practice. Conflicts, ".sync-conflict-X.dart" files, surprise deletes. The diff-back model is strictly better for this use case: you always know exactly what's changing, and you decide when.

### How do I uninstall everything?

```bash
# laptop
pnpm remove -g remote-claude
rm -rf ~/.remote-claude

# mini
remote-claude-agent uninstall
pnpm remove -g remote-claude
rm -rf ~/.remote-claude
```

Per-project: delete `remote-claude.yml` and `.remote-claude/`.

### Can I use this from a CI runner instead of a laptop?

Technically yes — the CLI is just node + commander. But CI is a weird fit: the diff preview prompts are interactive, and the value prop (local IDE stays fast) doesn't apply. If you have a use case for non-interactive AI runs in CI, open an issue and we'll talk.

### Does `--save-only` skip the apply prompt?

Yes. The patch goes to `.remote-claude/last.patch` and the command exits. Apply later with `remote-claude apply`.

### How do I see what `claude` actually output?

The CLI prints a summary; the full stdout is in the JSON response. With `RC_VERBOSE=1`, you'll see more. Or hit the API directly (see [HTTP API](/api/)).
