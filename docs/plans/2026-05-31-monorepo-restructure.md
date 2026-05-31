# Monorepo Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tidy the repository root, fix latent bugs from the pnpm-monorepo migration, and extract a small shared protocol package — without changing runtime behavior of CLI, agent, or extension.

**Architecture:** Three existing packages (`cli`, `extension`, `website`) are preserved. A new tiny `packages/protocol` package owns the HTTP/NDJSON wire types shared by the CLI's agent and the VS Code extension. Configuration fixes touch `vercel.json`, the extension's `tsup` configs, and a new `tsconfig.base.json`. Junk directories at the root are deleted and the `.gitignore` is tightened so they don't recur.

**Tech Stack:** pnpm 10 workspaces, TypeScript 5, tsup, vitest, zod, Fastify, Astro/Starlight (docs site, untouched).

**Spec:** `docs/specs/2026-05-31-monorepo-restructure-design.md`

---

## File Structure

**New files:**
- `packages/protocol/package.json`
- `packages/protocol/tsconfig.json`
- `packages/protocol/src/index.ts`
- `packages/protocol/src/events.ts`
- `packages/protocol/src/chat.ts`
- `packages/cli/README.md`
- `packages/extension/scripts/smoke-extension.sh` (moved, see Task 8)
- `tsconfig.base.json`

**Modified files:**
- `.gitignore` (tightened)
- `vercel.json` (paths fixed)
- `README.md` (rewritten as monorepo overview)
- `packages/cli/package.json` (add protocol dep, drop smoke:extension script)
- `packages/cli/src/agent/server.ts` (import `ChatBody` from protocol)
- `packages/cli/tsconfig.json` (extend base)
- `packages/extension/package.json` (add protocol dep, add smoke script)
- `packages/extension/src/cli/CliClient.ts` (import `CliEvent` from protocol)
- `packages/extension/tsconfig.json` (extend base)
- `packages/extension/tsup.config.ts` (consolidated multi-config)

**Deleted files / directories:**
- `dist/` (root, stale)
- `node-compile-cache/`
- `.qodo/`
- `.superpowers/brainstorm/`
- `.worktrees/vscode-extension/`
- `rc-init-http-*` × 9 (empty leak dirs at root)
- `.remote-claude/sessions/` and `.remote-claude/pull-*.patch` (runtime artifacts)
- `packages/extension/src/cli/events.ts` (moved to `packages/protocol/src/events.ts`)
- `packages/extension/tsup.webview.config.ts`
- `packages/extension/tsup.setup-webview.config.ts`
- `packages/cli/scripts/smoke-extension.sh` (moved to extension; see Task 8)
- `docs/superpowers/` (after contents flatten in Task 11)

---

## Task 1: Cleanup root + tighten .gitignore

**Files:**
- Delete: `dist/`, `node-compile-cache/`, `.qodo/`, `.superpowers/brainstorm/`, `.worktrees/vscode-extension/`, all `rc-init-http-*/` directories at root, `.remote-claude/sessions/`, `.remote-claude/pull-*.patch`
- Modify: `.gitignore`

- [ ] **Step 1: Verify what will be deleted is untracked or gitignored**

Run:
```bash
git -C /Users/apple/Documents/Workspace/dev_sync_cli status --short
git -C /Users/apple/Documents/Workspace/dev_sync_cli ls-files dist/ node-compile-cache/ .qodo/ .superpowers/ .worktrees/ .remote-claude/ 2>/dev/null | head
```
Expected: `git status` shows no staged/unstaged changes (or only `.remote-claude/state.json` if that's the dogfooding artifact). `ls-files` shows zero tracked files inside any of those directories. **If anything inside is tracked, stop and investigate before proceeding.**

- [ ] **Step 2: Delete the junk directories**

Run:
```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
rm -rf dist node-compile-cache .qodo .superpowers .worktrees
rm -rf rc-init-http-4NNVTJ rc-init-http-9ksI6r rc-init-http-A4TUxM rc-init-http-b3yaXh rc-init-http-D0GYuc rc-init-http-Fe4DGC rc-init-http-G0IJEt rc-init-http-J6J7mS rc-init-http-PlW9PS
rm -rf .remote-claude/sessions
rm -f .remote-claude/pull-*.patch
```
Expected: commands return cleanly. `.remote-claude/state.json` (a single 22-byte file) is preserved.

- [ ] **Step 3: Tighten `.gitignore`**

Modify `/Users/apple/Documents/Workspace/dev_sync_cli/.gitignore` — append these lines below the existing block (do not duplicate entries that already exist):

```gitignore
# Runtime/leak directories from the CLI itself
rc-init-*/

# TypeScript incremental build info
*.tsbuildinfo
.tsbuildinfo

# Editor / AI tool caches
.qodo/
```

After saving, the relevant section of `.gitignore` should read (top half unchanged):

```gitignore
node_modules/
dist/
.remote-claude/
.superpowers/
.worktrees/
*.log
.DS_Store
.env
.env.local
vendor/sshpass/sshpass-*
*.vsix

# Override the user's global gitignore for files that ARE part of this project
!README.md
!CHANGELOG.md
!CONTRIBUTING.md
remote-claude.yml
rc-del-*/
tsx-501/
node-compile-cache/

# Runtime/leak directories from the CLI itself
rc-init-*/

# TypeScript incremental build info
*.tsbuildinfo
.tsbuildinfo

# Editor / AI tool caches
.qodo/
```

- [ ] **Step 4: Verify working tree is clean**

Run:
```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git status --short
ls -la | grep -E "^d" | awk '{print $NF}' | grep -vE "^(\.|\.\.|\.git|\.github|\.claude|node_modules|packages|docs|\.remote-claude)$"
```
Expected:
- `git status` shows only `.gitignore` modified.
- The second command outputs nothing (no stray dot-directories or `rc-*` dirs remaining at the root).

- [ ] **Step 5: Commit**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git add .gitignore
git commit -m "chore: remove root junk + tighten .gitignore

Deletes leaked rc-init-http-* temp dirs, stale pre-monorepo dist/,
node-compile-cache/, .qodo/, .superpowers/brainstorm/, the stale
.worktrees/vscode-extension/, and .remote-claude/ runtime artifacts.
Adds rc-init-*/, *.tsbuildinfo, .qodo/ to .gitignore so they do not
recur."
```

---

## Task 2: Scaffold packages/protocol

**Files:**
- Create: `packages/protocol/package.json`
- Create: `packages/protocol/tsconfig.json`
- Create: `packages/protocol/src/index.ts` (empty placeholder for now)

- [ ] **Step 1: Create the package directory**

```bash
mkdir -p /Users/apple/Documents/Workspace/dev_sync_cli/packages/protocol/src
```

- [ ] **Step 2: Write `packages/protocol/package.json`**

Create `/Users/apple/Documents/Workspace/dev_sync_cli/packages/protocol/package.json`:

```json
{
  "name": "@remote-claude/protocol",
  "version": "0.0.0",
  "private": true,
  "description": "Shared HTTP/NDJSON wire types for the remote-claude CLI agent and the VS Code extension.",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "typescript": "^5.5.3"
  }
}
```

- [ ] **Step 3: Write `packages/protocol/tsconfig.json`**

Create `/Users/apple/Documents/Workspace/dev_sync_cli/packages/protocol/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 4: Write the placeholder `index.ts`**

Create `/Users/apple/Documents/Workspace/dev_sync_cli/packages/protocol/src/index.ts`:

```ts
// Populated in Task 3.
export {};
```

- [ ] **Step 5: Install — pnpm picks up the new workspace package**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm install
```
Expected: pnpm reports `+1 package` (`@remote-claude/protocol`), no errors.

- [ ] **Step 6: Verify typecheck on the new package**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm --filter @remote-claude/protocol typecheck
```
Expected: exits 0, no output.

- [ ] **Step 7: Commit**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git add packages/protocol pnpm-lock.yaml
git commit -m "feat(protocol): scaffold @remote-claude/protocol workspace package

Empty package with tsconfig + package.json. Wire types will land in
the next commit."
```

---

## Task 3: Move wire types into `packages/protocol`

**Files:**
- Create: `packages/protocol/src/events.ts`
- Create: `packages/protocol/src/chat.ts`
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1: Write `packages/protocol/src/events.ts`**

Create `/Users/apple/Documents/Workspace/dev_sync_cli/packages/protocol/src/events.ts` — content is the verbatim current body of `packages/extension/src/cli/events.ts`:

```ts
export interface ChangedFile {
  path: string;
  status: 'A' | 'M' | 'D' | 'R';
  additions: number;
  deletions: number;
}

export type CliEvent =
  | { type: 'protocol'; version: string }
  | { type: 'sync_start' }
  | { type: 'sync_progress'; transferred: number; total: number }
  | { type: 'sync_done'; filesChanged: number; durationMs: number }
  | { type: 'chat_turn_start'; sessionId: string; turnIndex: number }
  | { type: 'chat_text'; chunk: string }
  | { type: 'chat_diff'; patch: string; files: ChangedFile[] }
  | { type: 'chat_done'; tokensIn: number; tokensOut: number; durationMs: number }
  | { type: 'error'; code: string; message: string; recoverable: boolean }
  | { type: 'cancelled' };

export const SUPPORTED_PROTOCOL = '1';
```

- [ ] **Step 2: Write `packages/protocol/src/chat.ts`**

Create `/Users/apple/Documents/Workspace/dev_sync_cli/packages/protocol/src/chat.ts` — content is the `ChatBody` zod schema currently in `packages/cli/src/agent/server.ts`:

```ts
import { z } from 'zod';

export const ChatBody = z.object({
  // Accept canonical UUID v1-5 or a generic hex-ish session id (>=32 hex chars + optional dashes).
  uuid: z
    .string()
    .uuid()
    .or(z.string().regex(/^[a-f0-9-]{32,}$/i, 'invalid uuid')),
  prompt: z.string().min(1),
  projectName: z.string().min(1).regex(/^[a-zA-Z0-9_.-]+$/, 'invalid project name'),
});

export type ChatBody = z.infer<typeof ChatBody>;
```

- [ ] **Step 3: Replace `packages/protocol/src/index.ts` with the real re-exports**

Overwrite `/Users/apple/Documents/Workspace/dev_sync_cli/packages/protocol/src/index.ts`:

```ts
export type { ChangedFile, CliEvent } from './events.ts';
export { SUPPORTED_PROTOCOL } from './events.ts';
export { ChatBody } from './chat.ts';
```

- [ ] **Step 4: Verify typecheck**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm --filter @remote-claude/protocol typecheck
```
Expected: exits 0, no output.

- [ ] **Step 5: Commit**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git add packages/protocol/src
git commit -m "feat(protocol): add CliEvent union and ChatBody schema

Centralizes the wire format shared between the CLI agent and the
VS Code extension. Consumers wired up in the next commit."
```

---

## Task 4: Migrate consumers to `@remote-claude/protocol`

**Files:**
- Modify: `packages/cli/package.json` (add protocol dep)
- Modify: `packages/cli/src/agent/server.ts` (import ChatBody)
- Modify: `packages/extension/package.json` (add protocol dep)
- Modify: `packages/extension/src/cli/CliClient.ts` (import CliEvent)
- Delete: `packages/extension/src/cli/events.ts`

- [ ] **Step 1: Confirm consumer list with grep**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
grep -rn "from ['\"].*events\(\.ts\)\?['\"]" packages/extension/src packages/cli/src
grep -rn "ChatBody" packages/cli/src packages/extension/src
```
Expected:
- One match in `packages/extension/src/cli/CliClient.ts:2` (`import type { CliEvent } from './events.ts';`)
- `ChatBody` references in `packages/cli/src/agent/server.ts` only (the export at ~line 77 plus any internal usage).

**If grep reveals additional consumers, add an import-rewrite step for each before proceeding.**

- [ ] **Step 2: Add protocol dep to `packages/cli/package.json`**

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/cli/package.json`, locate the `"dependencies"` block:

```json
  "dependencies": {
    "chalk": "^5.3.0",
    "commander": "^12.1.0",
    "fastify": "^4.28.1",
    "prompts": "^2.4.2",
    "undici": "^6.19.8",
    "yaml": "^2.5.1",
    "zod": "^3.23.8"
  },
```

Replace with (alphabetical insertion):

```json
  "dependencies": {
    "@remote-claude/protocol": "workspace:*",
    "chalk": "^5.3.0",
    "commander": "^12.1.0",
    "fastify": "^4.28.1",
    "prompts": "^2.4.2",
    "undici": "^6.19.8",
    "yaml": "^2.5.1",
    "zod": "^3.23.8"
  },
```

- [ ] **Step 3: Add protocol dep to `packages/extension/package.json`**

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/extension/package.json`, locate the `"dependencies"` block:

```json
  "dependencies": {
    "yaml": "^2.5.1"
  },
```

Replace with:

```json
  "dependencies": {
    "@remote-claude/protocol": "workspace:*",
    "yaml": "^2.5.1"
  },
```

- [ ] **Step 4: `pnpm install` so workspace links resolve**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm install
```
Expected: pnpm reports the new workspace links wired into `cli` and `extension`, no errors.

- [ ] **Step 5: Rewrite import in `packages/extension/src/cli/CliClient.ts`**

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/extension/src/cli/CliClient.ts`, line 2 currently reads:

```ts
import type { CliEvent } from './events.ts';
```

Replace with:

```ts
import type { CliEvent } from '@remote-claude/protocol';
```

- [ ] **Step 6: Rewrite `ChatBody` in `packages/cli/src/agent/server.ts`**

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/cli/src/agent/server.ts`, remove the local declaration:

```ts
export const ChatBody = z.object({
  // Accept canonical UUID v1-5 or a generic hex-ish session id (>=32 hex chars + optional dashes).
  uuid: z
    .string()
    .uuid()
    .or(z.string().regex(/^[a-f0-9-]{32,}$/i, 'invalid uuid')),
  prompt: z.string().min(1),
  projectName: z.string().min(1).regex(/^[a-zA-Z0-9_.-]+$/, 'invalid project name'),
});
```

Then add this import alongside the existing imports near the top of the file (after the existing `import Fastify, ...` line):

```ts
import { ChatBody } from '@remote-claude/protocol';
```

If `ChatBody` is no longer the only `zod` consumer in this file, leave the `import { z } from 'zod';` import alone. Verify with `grep -n "z\\." packages/cli/src/agent/server.ts` — if there are no remaining `z.` usages, also remove the `import { z } from 'zod';` line.

- [ ] **Step 7: Delete the now-redundant `events.ts`**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
rm packages/extension/src/cli/events.ts
```

- [ ] **Step 8: Verify no orphan imports of the deleted file remain**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
grep -rn "cli/events" packages/ || echo "OK: no references"
```
Expected: `OK: no references`.

- [ ] **Step 9: Run typecheck and tests across the workspace**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm -r typecheck
pnpm -r test
```
Expected: typecheck exits 0 with no errors across all packages. `vitest` reports all existing tests passing. If any tests reference the deleted `events.ts` path or the in-place `ChatBody` export, update those imports before continuing — they should now import from `@remote-claude/protocol`.

- [ ] **Step 10: Commit**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git add packages/cli/package.json packages/cli/src/agent/server.ts packages/extension/package.json packages/extension/src/cli/CliClient.ts pnpm-lock.yaml
git rm packages/extension/src/cli/events.ts
git commit -m "refactor: import wire types from @remote-claude/protocol

CLI agent and VS Code extension now both import CliEvent and the
ChatBody zod schema from the shared protocol package, eliminating
the duplicated declarations that were drifting in two places."
```

---

## Task 5: Fix `vercel.json`

**Files:**
- Modify: `vercel.json`

- [ ] **Step 1: Inspect current content**

Run:
```bash
cat /Users/apple/Documents/Workspace/dev_sync_cli/vercel.json
```
Expected: shows `"buildCommand": "cd website && pnpm install --no-frozen-lockfile && pnpm build"` and `"outputDirectory": "website/dist"` — both reference the pre-monorepo `website/` path.

- [ ] **Step 2: Rewrite `vercel.json`**

Overwrite `/Users/apple/Documents/Workspace/dev_sync_cli/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "pnpm install --no-frozen-lockfile && pnpm --filter remote-claude-docs build",
  "outputDirectory": "packages/website/dist",
  "installCommand": "echo 'install handled by buildCommand'",
  "framework": null,
  "cleanUrls": true,
  "trailingSlash": true
}
```

- [ ] **Step 3: Verify the docs build still works locally**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm --filter remote-claude-docs build
```
Expected: Astro reports a successful build, producing `packages/website/dist/`. (This mirrors what Vercel will run.)

- [ ] **Step 4: Commit**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git add vercel.json
git commit -m "fix(vercel): use monorepo paths for build + output

buildCommand now uses pnpm --filter; outputDirectory targets
packages/website/dist. Previous configuration broke the deploy
when the repo restructured into a pnpm monorepo."
```

---

## Task 6: Add `packages/cli/README.md`

**Files:**
- Create: `packages/cli/README.md`

- [ ] **Step 1: Write `packages/cli/README.md`**

Create `/Users/apple/Documents/Workspace/dev_sync_cli/packages/cli/README.md`:

````markdown
# remote-claude

Local-first dev tool: push your project to a remote Mac Mini (or any remote box), run Claude Code there, and pull back a reviewable unified diff. The remote machine never edits your laptop's filesystem directly — every change crosses the wire as a patch you preview and `git apply` yourself.

**Full docs:** [remote-claude.vercel.app](https://remote-claude.vercel.app)

## Install

```bash
npm install -g remote-claude
```

This installs two binaries:

- `remote-claude` — laptop CLI (sync, ask, apply, doctor, setup, init-remote)
- `remote-claude-agent` — bearer-token HTTP server that runs on the remote Mac

## Quickstart

On the remote Mac:

```bash
remote-claude-agent
```

On your laptop:

```bash
remote-claude init-remote   # one-time bootstrap
remote-claude ask "refactor the login flow to use the new session helper"
remote-claude apply         # review and git-apply the returned diff
```

See [remote-claude.vercel.app/quickstart](https://remote-claude.vercel.app/quickstart) for the full walkthrough.

## License

MIT
````

- [ ] **Step 2: Verify `npm pack` will now include a README**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli/packages/cli
pnpm pack --pack-destination /tmp
tar -tzf /tmp/remote-claude-0.1.0.tgz | grep -E "(README|package\\.json|LICENSE)"
rm /tmp/remote-claude-0.1.0.tgz
```
Expected: the listing contains `package/README.md`, `package/package.json`, and (if `LICENSE` is symlinked or copied per repo conventions) `package/LICENSE`. **If `package/LICENSE` is missing, the `files` glob in `package.json` should be updated in a follow-up — but do not block this task on it.**

- [ ] **Step 3: Commit**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git add packages/cli/README.md
git commit -m "docs(cli): add CLI README required by package.json files glob

packages/cli/package.json lists README.md under \"files\" but no
README existed in the package directory — npm publish would have
shipped without one."
```

---

## Task 7: Rewrite root `README.md` as a monorepo overview

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Overwrite `README.md` with a monorepo overview**

Replace the entire content of `/Users/apple/Documents/Workspace/dev_sync_cli/README.md` with:

````markdown
# Remote Claude — Monorepo

[![CI](https://github.com/rebink/remote_claude/actions/workflows/ci.yml/badge.svg)](https://github.com/rebink/remote_claude/actions/workflows/ci.yml)
[![Docs](https://github.com/rebink/remote_claude/actions/workflows/docs.yml/badge.svg)](https://github.com/rebink/remote_claude/actions/workflows/docs.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](#requirements)

> **Local-first development. AI executes remotely. Diffs come back for review.**

You keep coding on your laptop with full IDE speed. A bigger Mac (or any remote box) runs Claude Code with full repo context. The result comes back as a **unified diff** that you preview and `git apply` — no surprise file edits, no commits you didn't see.

**Full docs:** [remote-claude.vercel.app](https://remote-claude.vercel.app)

## Packages

| Package | Path | Description |
|---|---|---|
| `remote-claude` | [`packages/cli`](packages/cli) | Laptop CLI + remote agent daemon (two npm bins, one package) |
| `remote-claude-vscode` | [`packages/extension`](packages/extension) | VS Code extension — chat panel + setup wizard + sync controller |
| `remote-claude-docs` | [`packages/website`](packages/website) | Astro/Starlight docs site, deployed to Vercel |
| `@remote-claude/protocol` | [`packages/protocol`](packages/protocol) | Private workspace package — wire types shared by `cli` and `extension` |

## Requirements

- Node.js ≥ 20
- pnpm ≥ 10 (`npm i -g pnpm`)

## Workspace commands

From the repository root:

```bash
pnpm install           # install all workspace dependencies
pnpm -r build          # build every package
pnpm -r test           # run all unit tests
pnpm -r typecheck      # typecheck every package

pnpm cli <args>        # shorthand for pnpm --filter remote-claude <args>
pnpm extension <args>  # shorthand for pnpm --filter remote-claude-vscode <args>
pnpm website <args>    # shorthand for pnpm --filter remote-claude-docs <args>
```

## Development

See [DEVELOPMENT.md](DEVELOPMENT.md) for local dev workflow, smoke tests, and release notes. Implementation specs and historical plans live under [`docs/specs`](docs/specs) and [`docs/plans`](docs/plans).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
````

- [ ] **Step 2: Sanity check links**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
for p in packages/cli packages/extension packages/website packages/protocol DEVELOPMENT.md CONTRIBUTING.md LICENSE docs/specs docs/plans; do
  test -e "$p" && echo "OK   $p" || echo "MISS $p"
done
```
Expected: every line prints `OK <path>`. `docs/plans` was created earlier; `docs/specs` exists since the design spec landed there.

- [ ] **Step 3: Commit**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git add README.md
git commit -m "docs: rewrite root README as monorepo overview

Root README now describes the workspace and links to each package's
README; the CLI-specific content was moved to packages/cli/README.md
in the previous commit."
```

---

## Task 8: Move `smoke-extension.sh` to the extension package

**Files:**
- Move: `packages/cli/scripts/smoke-extension.sh` → `packages/extension/scripts/smoke-extension.sh`
- Modify: `packages/cli/package.json` (remove `smoke:extension` script)
- Modify: `packages/extension/package.json` (add `smoke` script)

- [ ] **Step 1: Create the extension scripts dir and move the file**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
mkdir -p packages/extension/scripts
git mv packages/cli/scripts/smoke-extension.sh packages/extension/scripts/smoke-extension.sh
chmod +x packages/extension/scripts/smoke-extension.sh
```

- [ ] **Step 2: Update the moved script's paths**

The script uses `REPO="$(cd "$(dirname "$0")/.." && pwd)"` which originally resolved to `packages/cli`. From the new location it resolves to `packages/extension`. The script also references `$REPO/extension/.vscode-test` and `$REPO/extension` for the e2e step, which were already wrong relative to the old location. Replace the entire content of `/Users/apple/Documents/Workspace/dev_sync_cli/packages/extension/scripts/smoke-extension.sh` with:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Resolve the workspace root (this script lives in packages/extension/scripts/).
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO="$(cd "$EXT_DIR/../.." && pwd)"

# 1. build everything in the workspace
( cd "$REPO" && pnpm -r build )

# 2. typecheck everything
( cd "$REPO" && pnpm -r typecheck )

# 3. unit tests
( cd "$REPO" && pnpm -r test )

# 4. extension integration tests (vscode-test-electron) if configured or RC_E2E is set
if [ -d "$EXT_DIR/.vscode-test" ] || [ -n "${RC_E2E:-}" ]; then
  ( cd "$EXT_DIR" && pnpm exec vscode-test || true )
fi

echo "OK"
```

- [ ] **Step 3: Remove the obsolete CLI script entry**

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/cli/package.json`, delete this line from the `"scripts"` block:

```json
    "smoke:extension": "bash scripts/smoke-extension.sh"
```

Remove the trailing comma on the preceding line if needed so the JSON stays valid.

- [ ] **Step 4: Add the smoke script to the extension package**

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/extension/package.json`, locate the `"scripts"` block:

```json
  "scripts": {
    "build": "tsup && tsup --config tsup.webview.config.ts && tsup --config tsup.setup-webview.config.ts && cp src/chat/webview/index.html src/chat/webview/styles.css dist/webview/ && cp src/setup/webview/index.html src/setup/webview/styles.css dist/setup-webview/",
    "dev": "pnpm build --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "package": "vsce package --no-dependencies"
  },
```

Add a `"smoke"` entry (do not touch `"build"` yet — that happens in Task 9):

```json
  "scripts": {
    "build": "tsup && tsup --config tsup.webview.config.ts && tsup --config tsup.setup-webview.config.ts && cp src/chat/webview/index.html src/chat/webview/styles.css dist/webview/ && cp src/setup/webview/index.html src/setup/webview/styles.css dist/setup-webview/",
    "dev": "pnpm build --watch",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "smoke": "bash scripts/smoke-extension.sh",
    "package": "vsce package --no-dependencies"
  },
```

- [ ] **Step 5: Verify the script runs end-to-end (skipping vscode-test)**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm --filter remote-claude-vscode smoke
```
Expected: build + typecheck + test all pass; the script prints `OK` at the end. The `vscode-test` block is skipped because `$EXT_DIR/.vscode-test` doesn't exist and `RC_E2E` isn't set.

- [ ] **Step 6: Commit**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git add packages/cli/package.json packages/cli/scripts packages/extension/package.json packages/extension/scripts
git commit -m "chore: move smoke-extension.sh into the extension package

The smoke script tests the extension's build pipeline; it had no
business living under packages/cli/scripts/. Path resolution updated
for the new location and the script is now invoked via
\"pnpm --filter remote-claude-vscode smoke\"."
```

---

## Task 9: Consolidate the extension's tsup configs

**Files:**
- Modify: `packages/extension/tsup.config.ts`
- Delete: `packages/extension/tsup.webview.config.ts`
- Delete: `packages/extension/tsup.setup-webview.config.ts`
- Modify: `packages/extension/package.json` (simplify `build` script)

- [ ] **Step 1: Check tsup version to decide on `publicDir` support**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
node -e "console.log(require('./packages/extension/node_modules/tsup/package.json').version)"
```
Expected: `8.x.x`. tsup 8 supports `publicDir`. If the version is older than 7.3.0, use the `onSuccess` fallback in Step 2 instead.

- [ ] **Step 2: Overwrite `packages/extension/tsup.config.ts`**

Replace the entire content of `/Users/apple/Documents/Workspace/dev_sync_cli/packages/extension/tsup.config.ts` with:

```ts
import { defineConfig } from 'tsup';

// Three build outputs from one config:
// 1. The extension host (CJS, externalizes `vscode`)
// 2. The chat webview (IIFE, browser context, copies HTML/CSS verbatim)
// 3. The setup wizard webview (same pattern as chat)
//
// `publicDir` is preferred when supported by the installed tsup version
// (>= 7.3.0). If your tsup is older, replace each webview entry's
// `publicDir` line with:
//   onSuccess: 'cp src/<area>/webview/index.html src/<area>/webview/styles.css dist/<out>/'
export default defineConfig([
  {
    entry: ['src/extension.ts'],
    format: ['cjs'],
    external: ['vscode'],
    outDir: 'dist',
    outExtension: () => ({ js: '.cjs' }),
    banner: {},
    clean: true,
  },
  {
    entry: ['src/chat/webview/main.ts'],
    format: ['iife'],
    target: 'chrome100',
    outDir: 'dist/webview',
    outExtension: () => ({ js: '.js' }),
    publicDir: 'src/chat/webview',
    clean: false,
  },
  {
    entry: ['src/setup/webview/main.ts'],
    format: ['iife'],
    target: 'chrome100',
    outDir: 'dist/setup-webview',
    outExtension: () => ({ js: '.js' }),
    publicDir: 'src/setup/webview',
    clean: false,
  },
]);
```

**Note on `publicDir` semantics:** tsup copies **every** file in the named directory verbatim into `outDir`. Since `main.ts` lives in the same `src/<area>/webview/` directory, the `.ts` file would also be copied — which is harmless but ugly. If you observe the `.ts` file appearing in `dist/webview/` after build, fall back to the `onSuccess` form noted in the comment above (copies only `index.html` and `styles.css` explicitly).

- [ ] **Step 3: Delete the two redundant config files**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git rm packages/extension/tsup.webview.config.ts packages/extension/tsup.setup-webview.config.ts
```

- [ ] **Step 4: Simplify the extension's `build` script**

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/extension/package.json`, replace the `"build"` line:

```json
    "build": "tsup && tsup --config tsup.webview.config.ts && tsup --config tsup.setup-webview.config.ts && cp src/chat/webview/index.html src/chat/webview/styles.css dist/webview/ && cp src/setup/webview/index.html src/setup/webview/styles.css dist/setup-webview/",
```

with:

```json
    "build": "tsup",
```

- [ ] **Step 5: Build and verify outputs**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
rm -rf packages/extension/dist
pnpm --filter remote-claude-vscode build
ls packages/extension/dist/
ls packages/extension/dist/webview/
ls packages/extension/dist/setup-webview/
```
Expected:
- `packages/extension/dist/extension.cjs` exists.
- `packages/extension/dist/webview/` contains at minimum `main.js`, `index.html`, `styles.css`.
- `packages/extension/dist/setup-webview/` contains at minimum `main.js`, `index.html`, `styles.css`.

If a `main.ts` file appears in either webview dist directory (a `publicDir` side-effect), apply the `onSuccess` fallback from Step 2 and re-run this verification.

- [ ] **Step 6: Run the extension smoke script as a regression gate**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm --filter remote-claude-vscode smoke
```
Expected: builds, typechecks, and tests all pass; script prints `OK`.

- [ ] **Step 7: Commit**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git add packages/extension/tsup.config.ts packages/extension/package.json
git commit -m "build(extension): consolidate three tsup configs into one

defineConfig now exports an array covering the extension host plus
both webview bundles. publicDir replaces the hand-rolled cp step.
build script simplifies to 'tsup'."
```

---

## Task 10: Add `tsconfig.base.json` and have each package extend it

**Files:**
- Create: `tsconfig.base.json`
- Modify: `packages/cli/tsconfig.json`
- Modify: `packages/extension/tsconfig.json`
- Modify: `packages/protocol/tsconfig.json`

(The `packages/website/tsconfig.json` extends `astro/tsconfigs/strict` and stays untouched.)

- [ ] **Step 1: Identify the truly shared compiler options**

Compare the existing configs. The options present and identical across `packages/cli/tsconfig.json`, `packages/extension/tsconfig.json`, and `packages/protocol/tsconfig.json` are:

- `target: "ES2022"`
- `module: "ESNext"`
- `moduleResolution: "Bundler"`
- `strict: true`
- `esModuleInterop: true`
- `skipLibCheck: true`
- `resolveJsonModule: true`
- `allowImportingTsExtensions: true`
- `noEmit: true`

Package-specific options (`lib`, `types`, `outDir`, `rootDir`, `isolatedModules`, `verbatimModuleSyntax`, `forceConsistentCasingInFileNames`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `declaration`) stay in the per-package configs.

- [ ] **Step 2: Create `tsconfig.base.json`**

Create `/Users/apple/Documents/Workspace/dev_sync_cli/tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  }
}
```

- [ ] **Step 3: Update `packages/cli/tsconfig.json` to extend the base**

Replace the entire content of `/Users/apple/Documents/Workspace/dev_sync_cli/packages/cli/tsconfig.json` with:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["node"],
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": false,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "test"]
}
```

- [ ] **Step 4: Update `packages/extension/tsconfig.json` to extend the base**

Replace the entire content of `/Users/apple/Documents/Workspace/dev_sync_cli/packages/extension/tsconfig.json` with:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM"],
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "outDir": "dist"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 5: Update `packages/protocol/tsconfig.json` to extend the base**

Replace the entire content of `/Users/apple/Documents/Workspace/dev_sync_cli/packages/protocol/tsconfig.json` with:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "noUncheckedIndexedAccess": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 6: Verify typecheck across the workspace**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm -r typecheck
```
Expected: exits 0 with no errors. If a package starts failing because a setting it relied on (e.g., `isolatedModules`) was excluded from the base, copy that setting into the offending package's `tsconfig.json` and re-run.

- [ ] **Step 7: Commit**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git add tsconfig.base.json packages/cli/tsconfig.json packages/extension/tsconfig.json packages/protocol/tsconfig.json
git commit -m "chore(tsconfig): factor shared options into tsconfig.base.json

cli, extension, and protocol now extend the shared base. Per-package
configs keep only the options that genuinely differ (lib, types,
strictness toggles, outDir, rootDir, includes/excludes). The Astro
website config is unaffected — it extends astro/tsconfigs/strict."
```

---

## Task 11: Flatten `docs/superpowers/{specs,plans}/` into `docs/{specs,plans}/`

**Files:**
- Move: `docs/superpowers/specs/*` → `docs/specs/`
- Move: `docs/superpowers/plans/*` → `docs/plans/`
- Delete: `docs/superpowers/` (the now-empty directory)

(Note: `docs/specs/2026-05-31-monorepo-restructure-design.md` and `docs/plans/2026-05-31-monorepo-restructure.md` already live at the flattened paths — this task moves the older files alongside them.)

- [ ] **Step 1: List what's being moved so the commit is auditable**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
ls docs/superpowers/specs/ docs/superpowers/plans/
```
Expected output:
```
docs/superpowers/plans/:
2026-04-30-devbridge-plan.md
2026-05-03-vscode-extension.md
2026-05-20-vscode-extension-v2.md
2026-05-25-push-local-folder-bootstrap.md

docs/superpowers/specs/:
2026-04-30-devbridge-design.md
2026-05-03-vscode-extension-design.md
2026-05-20-vscode-extension-v2-design.md
2026-05-25-push-local-folder-bootstrap-design.md
```

- [ ] **Step 2: Move specs**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git mv docs/superpowers/specs/2026-04-30-devbridge-design.md docs/specs/
git mv docs/superpowers/specs/2026-05-03-vscode-extension-design.md docs/specs/
git mv docs/superpowers/specs/2026-05-20-vscode-extension-v2-design.md docs/specs/
git mv docs/superpowers/specs/2026-05-25-push-local-folder-bootstrap-design.md docs/specs/
```

- [ ] **Step 3: Move plans**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git mv docs/superpowers/plans/2026-04-30-devbridge-plan.md docs/plans/
git mv docs/superpowers/plans/2026-05-03-vscode-extension.md docs/plans/
git mv docs/superpowers/plans/2026-05-20-vscode-extension-v2.md docs/plans/
git mv docs/superpowers/plans/2026-05-25-push-local-folder-bootstrap.md docs/plans/
```

- [ ] **Step 4: Remove the now-empty `docs/superpowers/` shell**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
rmdir docs/superpowers/specs docs/superpowers/plans docs/superpowers
```
Expected: all three rmdir commands succeed silently. If any complains "Directory not empty", investigate before continuing.

- [ ] **Step 5: Verify the final docs layout**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
find docs -maxdepth 2 -type d
ls docs/specs/ docs/plans/
```
Expected:
- The `find` output shows only `docs`, `docs/specs`, `docs/plans` (no `docs/superpowers`).
- Both `specs/` and `plans/` contain five files each (four historical + the 2026-05-31 file from this restructure).

- [ ] **Step 6: Commit**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git add docs
git commit -m "docs: flatten docs/superpowers/{specs,plans} to docs/{specs,plans}

\"superpowers\" is the brainstorming tool's name, not part of this
project's vocabulary. The design and plan documents themselves are
the artifact worth keeping; the tool's name does not belong in their
path."
```

---

## Task 12: Final cross-package verification

**Files:** none modified — verification only.

- [ ] **Step 1: Workspace-wide typecheck**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm -r typecheck
```
Expected: exits 0; no errors from any package.

- [ ] **Step 2: Workspace-wide tests**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm -r test
```
Expected: every package's vitest run reports all tests passing.

- [ ] **Step 3: Workspace-wide build**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm -r build
```
Expected:
- `packages/cli/dist/cli.js` and `packages/cli/dist/agent.js` produced.
- `packages/extension/dist/extension.cjs`, `dist/webview/{main.js,index.html,styles.css}`, `dist/setup-webview/{main.js,index.html,styles.css}` all present.
- `packages/website/dist/index.html` and the rest of the Astro output produced.
- `packages/protocol` has no build step (source-only consumption) and is skipped.

- [ ] **Step 4: Confirm working tree state**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git status --short
ls -la
```
Expected:
- `git status` clean (no uncommitted changes).
- `ls -la` at root shows only: `.git`, `.github`, `.claude` (user-local), `.gitignore`, `.npmrc`, `.remote-claude` (gitignored, only `state.json` inside), `CHANGELOG.md`, `CONTRIBUTING.md`, `DEVELOPMENT.md`, `LICENSE`, `README.md`, `docs/`, `node_modules/`, `package.json`, `packages/`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `remote-claude.yml`, `tsconfig.base.json`, `vercel.json`. No `rc-init-*`, no root `dist/`, no `.qodo`, no `.superpowers`, no `.worktrees`, no `node-compile-cache`.

- [ ] **Step 5: Confirm protocol consumers reference the package, not the deleted file**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
grep -rn "@remote-claude/protocol" packages/cli/src packages/extension/src
grep -rn "cli/events" packages/ || echo "OK: no references to deleted file"
```
Expected:
- At least two `@remote-claude/protocol` import sites (one in `packages/cli/src/agent/server.ts`, one in `packages/extension/src/cli/CliClient.ts`).
- `OK: no references to deleted file`.

- [ ] **Step 6: Tag the verification state (optional but recommended)**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git log --oneline -15
```
Expected: shows the chain of commits from this plan — one per task — on top of the design-spec commit `f0d99ad`.

No final commit is needed for this task — it's verification only. If any of the steps above fail, that failure is the next bug to fix; do **not** mark the task complete.
