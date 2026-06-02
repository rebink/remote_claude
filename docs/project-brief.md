# Patchwire — project brief

## One line

Shared AI infrastructure for engineering teams — run any coding agent (Claude, Codex, Aider) on hardware you control; every change returns as a reviewable Git diff, with isolation, a fair queue, and an audit trail across the whole team.

## Positioning

**Category:** shared AI infrastructure for software teams — *not* a remote-dev
platform (we do not compete with Codespaces / Coder / DevPod) and *not* a solo-dev
tool.

The defensible model (rare in combination):

1. The agent runs on infrastructure **you** control — never a vendor cloud.
2. Developers don't need AI credentials; one subscription lives on the server.
3. The agent works on a clean checkout and never touches the working tree.
4. Every change returns as a real Git diff; nothing lands without a human.
5. A team safely shares one expensive AI environment — isolation, queue, and
   (roadmap) audit + cost visibility.

**Flutter is the proving ground / origin story, never the product identity.** The
model is horizontal: any repo, any agent.

**Roadmap tiers:**
- *High:* queue visibility, diff-review UX, multi-model, usage/cost tracking,
  audit history, policy enforcement.
- *Medium:* Android device bridge (adb-over-Tailscale), simulator forwarding,
  build-cache sharing.
- *Low / out of scope:* full remote Flutter dev, Codespaces replacement, remote IDE.

See `docs/marketing-positioning-monetization.md` and
`docs/build-vs-buy-and-remote-flutter.md` for the evidence base.

## The problem

Running AI coding agents (Claude Code, Codex, aider, …) on a laptop is painful:
the laptop gets hot and slow, in-editor AI forgets context, and "AI edits your
files in place" means you `git reset` half the time. The usual fixes are worse:
code-server is laggy, a mounted filesystem is a coin flip, and a shared remote
box turns into developers clobbering each other's checkouts.

## What it does

1. The laptop `rsync`s the project (one-way) to a remote machine.
2. The laptop calls the agent's HTTP `/ask` with a prompt.
3. The agent runs the configured AI CLI against a **clean checkout**, captures
   the result as a real `git diff`, then resets the tree.
4. The diff streams back. The developer reviews it and `git apply`s selectively
   (or never). Nothing lands without a human.

Because the diff is derived from `git`, it is exactly what changed — never an
AI-hallucinated patch.

## Shape of the product

- **Two binaries:** `patchwire` (laptop CLI) and `patchwire-agent` (remote
  Fastify HTTP server, typically run under launchd/systemd).
- **Transport:** bearer-token HTTP over Tailscale or LAN. The laptop is always
  the source of truth; sync is one-way.
- **AI-agnostic:** any CLI that reads a prompt on stdin and edits files. Swap
  providers in one line of config.
- **Two front ends:** the terminal CLI and a VS Code extension (chat side panel,
  inline diff preview, one-keystroke apply).

## Multi-developer (v0.2)

One agent now serves a whole team without collisions:

- **Identity:** per-user bearer tokens (`patchwire-agent user add/list/rotate/
  disable/rm`); tokens stored hashed, resolved to a username on every request.
- **Isolation:** each developer rsyncs into their own `<user>/<project>`
  directory on the remote. Same project name, different people, no collisions.
- **Fairness:** per-user and global concurrency caps; over-cap requests wait
  FIFO. `/ask` is a streamed NDJSON endpoint, so a waiting request watches its
  live queue position (`queued → accepted → result`).
- **Audit:** one JSONL line per successful turn (who, project, prompt hash,
  lines changed, duration); read with `patchwire-agent log`.

## Who it's for

The buyer is the **engineering manager / platform / security lead** at a team that
either pays for many AI coding seats or cannot send source code to a vendor's
cloud. The solo developer is explicitly **not** the ICP — they will use Cursor or
Claude Code directly. Patchwire wins where one controlled, shared environment plus
governance matters more than a per-seat IDE assistant.

## Repository (pnpm monorepo)

| Package | Role |
| --- | --- |
| `packages/cli` | `patchwire` + `patchwire-agent` binaries (the core product) |
| `packages/protocol` | Shared HTTP/NDJSON wire types (`AskEvent`, `ChatBody`, …) |
| `packages/extension` | VS Code extension |
| `packages/website` | Astro + Starlight docs site and landing page |

## Status

v0.2.4. Phase 5 (streamed `/ask` with live queue visibility) is merged and
tagged. Pre-1.0. MIT licensed. Source: github.com/rebink/patchwire.
