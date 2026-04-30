# DevBridge — Implementation Plan

Linked spec: `docs/superpowers/specs/2026-04-30-devbridge-design.md`

## Build order (each step is independently runnable)

### Step 1 — Project skeleton
- `package.json` with two bin entries
- `tsconfig.json`, `tsup.config.ts`, `.gitignore`, `.npmrc`
- Install deps (declared, not actually run since no network in this session)
- `src/cli.ts` and `src/agent.ts` stubs
- **Verify:** `pnpm build` produces dist/cli.js + dist/agent.js (deferred — depends on install)

### Step 2 — Config + logging primitives
- `src/lib/log.ts` — chalk-based level logger
- `src/lib/config.ts` — load + zod-validate `devbridge.yml`, env interpolation

### Step 3 — `init` command
- Interactive prompts (host/user/path/token) with `prompts`
- Write `devbridge.yml` + `.devbridge/` dir + `.gitignore` entries

### Step 4 — `sync` command + rsync wrapper
- `src/lib/rsync.ts` — child_process.spawn wrapper, stream output, return code
- Build exclude list as temp file, pass via `--exclude-from`
- Compose remote target `user@host:path`

### Step 5 — Agent server
- `src/agent/server.ts` — Fastify with auth hook
- `src/agent/auth.ts` — constant-time token compare
- `src/agent/git.ts` — status / diff (incl. untracked) / reset
- `src/agent/claude.ts` — spawn `claude --print`, capture stdout/stderr/exitcode
- `POST /ask` orchestration: dirty check → claude → diff → reset
- `GET /health` returns version + claude path detection

### Step 6 — `ask` command
- `src/lib/client.ts` — undici fetch wrapper
- `src/commands/ask.ts` — sync → POST /ask → preview → confirm → apply
- `src/lib/patch.ts` — colorize unified diff, per-file selection, `git apply` invocation

### Step 7 — `apply` command (saved patches)
- Read patch file or `.devbridge/last.patch`
- Same preview + confirm + git apply flow

### Step 8 — `doctor` command
- Check: `rsync --version`, `ssh -o BatchMode=yes user@host true`, GET /health, `git rev-parse` in cwd
- Pretty-print pass/fail per check

### Step 9 — Wiring + README
- `commander` registers all subcommands in `src/cli.ts`
- README.md with quickstart for both halves

### Step 10 — Verify
- `pnpm typecheck` (tsc --noEmit) clean
- `pnpm build` produces both bins
- Smoke test `init` + `doctor` locally (no remote)

## Risk register
- `claude --print` flag may differ — agent abstracts via config (`ai.command`/`ai.args`).
- rsync `--delete` is dangerous remote-side; restrict to configured `remote.path` only.
- Untracked files: `git add -A` before diff covers them; reset uses `git clean -fd`.
