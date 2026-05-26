# Developer Guide

This document is for people working **on** Remote Claude (not just using it). It maps
the codebase, explains the request flow, and covers the build/test loop. For usage,
see [`README.md`](README.md); for PR mechanics, see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## The big picture

Remote Claude has **two binaries** and **one VS Code extension** sharing one repo:

```
┌─────────────────── your laptop ───────────────────┐      ┌──────── remote Mac ────────┐
│  remote-claude (CLI)            VS Code extension  │      │  remote-claude-agent       │
│  src/cli.ts                     extension/         │      │  src/agent.ts              │
│      │                               │             │      │      │                     │
│      └──── rsync push ───────────────┴─── HTTP ────┼──────┼──► Fastify server          │
│           (one-way, SSH)            (bearer token) │      │      spawns `claude --print`│
│      ◄──── unified diff ────────────────────────── ┼──────┼──── git diff of clean tree │
└────────────────────────────────────────────────────┘      └─────────────────────────────┘
```

The laptop is the source of truth. Files only flow laptop→remote (rsync). Changes only
flow remote→laptop as a **reviewable unified diff** that you `git apply`. We never ask
Claude to emit a diff — the agent lets `claude` edit a clean checkout and derives the
diff from `git`, which is far more reliable than prompt-engineering patch output.

## Repository layout

| Path | What lives here |
|---|---|
| `src/cli.ts` | Laptop CLI entry point — Commander command definitions |
| `src/agent.ts` | Remote agent entry point — boots the Fastify server / launchd install |
| `src/commands/` | One file per CLI subcommand (`setup`, `sync`, `ask`, `apply`, `doctor`, `chat`, `init-remote`, …) |
| `src/agent/` | Server internals: `server.ts` (routes), `auth.ts`, `git.ts`, `claude.ts`, `chat.ts`, session stores |
| `src/lib/` | Shared helpers: `config.ts`, `client.ts` (HTTP), `rsync.ts`, `ssh-runner.ts`, `patch.ts`, `tailscale.ts` |
| `extension/` | The VS Code extension (its own `package.json`, build, and tests) |
| `test/` | Vitest suites, mirroring `src/` structure; `test/integration/` holds e2e flows |
| `scripts/` | `smoke.sh`, `fetch-sshpass.sh`, `smoke-extension.sh` |
| `docs/superpowers/` | Design specs and plans — read these for the "why" behind decisions |

## Build & dev loop

```bash
pnpm install            # repo uses pnpm + a pnpm workspace (see pnpm-workspace.yaml)
pnpm typecheck          # tsc --noEmit (this is also the lint step)
pnpm test               # vitest run
pnpm build              # tsup → dist/cli.js + dist/agent.js (ESM, node20, with shebang banner)
pnpm verify             # typecheck + test + build + smoke — run this before pushing
```

Run the binaries straight from TypeScript without building, via `tsx`:

```bash
pnpm dev:cli -- --help          # remote-claude CLI
pnpm dev:agent                  # remote-claude-agent server (reads RC_* env vars)
```

`tsup` bundles two entry points (`src/cli.ts`, `src/agent.ts`) into `dist/`, prepends a
`#!/usr/bin/env node` banner, and those map to the `remote-claude` / `remote-claude-agent`
bins in `package.json`. The `prepare` hook builds on install so `github:` installs work
without a published artifact.

## Request flow — what `ask` actually does

1. **`runAsk`** (`src/commands/ask.ts`) loads config (`lib/config.ts`), then rsync-pushes
   the project to the remote (`lib/rsync.ts` over `lib/ssh-runner.ts`) unless `--no-sync`.
2. It POSTs the prompt to the agent (`lib/client.ts`, bearer-token auth).
3. The **agent** (`src/agent/server.ts`) authenticates (`auth.ts`, constant-time compare),
   resets the project to a clean git tree (`git.ts`), spawns `claude --print` (`claude.ts`)
   with the prompt, then captures `git diff` + untracked files as a unified patch.
4. The patch comes back over HTTP; the CLI previews it (colorized) and offers
   apply-all / apply-selected / save / reject. Applying is a local `git apply`.

The multi-turn `chat` command (used by the extension) layers session state on top of this
via `agent/session-store.ts` + `agent/turn-state.ts`, streaming JSONL events.

## Testing

- Tests live in `test/` and use **Vitest**. Layout mirrors `src/` (`test/agent/`, `test/lib/`, `test/commands/`).
- `test/integration/bootstrap.e2e.test.ts` exercises a full bootstrap flow end-to-end.
- Add a failing test before a fix when feasible (see `CONTRIBUTING.md`).
- The extension has its own suite (`extension/src/**/*.test.ts`) with a `vscode` stub at
  `extension/src/test/vscode-stub.ts`, plus `pnpm smoke:extension`.

## Configuration & environment

- Laptop config: `remote-claude.yml` (parsed/validated in `lib/config.ts`, supports
  `${ENV}` interpolation). The token typically comes from `~/.remote-claude/env`.
- Agent config is **all env vars** (`RC_AGENT_TOKEN`, `RC_PROJECTS_ROOT`, `RC_AGENT_HOST`,
  `RC_AGENT_PORT`, `RC_CLAUDE_BIN`, `RC_CLAUDE_ARGS`, `RC_TIMEOUT_SEC`). See `src/agent.ts`.
- Set `RC_VERBOSE=1` to print stack traces from the CLI.

## Conventions

- TypeScript strict mode; `pnpm typecheck` must be clean (it is the lint gate).
- ESM throughout; intra-repo imports use explicit `.ts` extensions.
- Each CLI subcommand is its own file in `src/commands/`; shared logic goes in `src/lib/`.
- Keep PRs focused and green on `pnpm typecheck && pnpm test && pnpm build` (CI runs Node 20 & 22).
