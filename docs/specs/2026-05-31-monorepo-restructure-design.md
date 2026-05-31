# Monorepo Restructure — Design Spec

**Date:** 2026-05-31
**Status:** Approved (design phase)
**Scope:** Tidy the repository root, fix latent bugs introduced by the pnpm-monorepo migration, and extract a small shared protocol package. **Architecture of the three existing packages is preserved.**

---

## 1. Motivation

Working-directory inspection shows the project root accumulated nine empty `rc-init-http-*` directories, a stale pre-monorepo `dist/`, an old `.worktrees/vscode-extension/`, an empty `.qodo/`, a `node-compile-cache/`, and brainstorm scratchpads under `.superpowers/` — most of it untracked or gitignored, but visually noisy.

Beyond cosmetics, two real bugs and several minor messes were found:

- **`vercel.json` is broken** — references the pre-monorepo path `cd website` instead of `packages/website`.
- **`packages/cli` has no `README.md`** — but `package.json` lists it under `"files"`, so `npm publish` will be missing a README.
- Extension build uses three separate `tsup.*.config.ts` files plus a hand-rolled `cp` of HTML/CSS into `dist/`.
- `smoke-extension.sh` lives in `packages/cli/scripts/` despite exclusively testing the extension.
- Extension and CLI both speak the same HTTP/NDJSON wire format (event shapes, version constant, `ChatBody` zod schema) but maintain the types separately. Today this is hand-coordinated; a thin shared package eliminates the drift risk.

## 2. Non-Goals

- No change to package boundaries beyond adding `packages/protocol`. The `cli` package keeps both `remote-claude` (laptop) and `remote-claude-agent` (remote) bins.
- No changes to runtime behavior of CLI, agent, or extension.
- No dependency upgrades. Lockfile churn limited to adding the new workspace package.
- No CI workflow rewrites (only path-string fixes if any reference `website/` directly).
- No `docs/` content rewrites beyond moving files. The actual docs site source (`packages/website/src/content/docs/`) is untouched.

## 3. Target Layout

```
dev_sync_cli/
├── packages/
│   ├── protocol/                  NEW — @remote-claude/protocol (private)
│   │   ├── src/
│   │   │   ├── events.ts          moved from packages/extension/src/cli/events.ts
│   │   │   ├── chat.ts            ChatBody zod schema moved from cli/src/agent/server.ts
│   │   │   └── index.ts           re-exports
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── cli/
│   │   ├── src/                   (unchanged)
│   │   ├── test/                  (unchanged)
│   │   ├── scripts/fetch-sshpass.sh
│   │   ├── vendor/sshpass/
│   │   ├── README.md              NEW
│   │   ├── package.json           adds "@remote-claude/protocol": "workspace:*"
│   │   ├── tsconfig.json          extends ../../tsconfig.base.json
│   │   └── tsup.config.ts
│   │
│   ├── extension/
│   │   ├── src/                   events.ts deleted (now imported from protocol)
│   │   ├── scripts/smoke-extension.sh   moved from packages/cli/scripts/
│   │   ├── README.md
│   │   ├── package.json           adds "@remote-claude/protocol": "workspace:*"
│   │   ├── tsconfig.json          extends ../../tsconfig.base.json
│   │   └── tsup.config.ts         MERGED — exports an array of build configs
│   │
│   └── website/                   (unchanged)
│
├── docs/
│   ├── specs/                     flattened from docs/superpowers/specs/
│   │   └── 2026-05-31-monorepo-restructure-design.md   ← this file
│   └── plans/                     flattened from docs/superpowers/plans/
│
├── .github/                       (unchanged)
├── .gitignore                     tightened
├── .npmrc
├── package.json                   workspace root (unchanged scripts)
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json             NEW
├── vercel.json                    FIXED paths
├── remote-claude.yml              (unchanged)
├── README.md                      rewritten as monorepo overview
├── CHANGELOG.md
├── CONTRIBUTING.md
├── DEVELOPMENT.md
└── LICENSE
```

## 4. Deletions

Removed from the working tree:

| Path | Status before | Reason |
|---|---|---|
| `rc-init-http-{4NNVTJ,9ksI6r,A4TUxM,b3yaXh,D0GYuc,Fe4DGC,G0IJEt,J6J7mS,PlW9PS}/` | untracked, empty | Leak from CLI's HTTP init path |
| `dist/` (root) | untracked | Stale pre-monorepo build (`agent.js`, `cli.js`) |
| `node-compile-cache/` | gitignored | Node V8 cache, regenerated on demand |
| `.qodo/` | untracked | Empty Qodo agent dirs, unused |
| `.superpowers/brainstorm/` | gitignored | Old brainstorm cache |
| `.worktrees/vscode-extension/` | gitignored | Stale worktree from 2026-05-14 |
| `.remote-claude/` artifacts (sessions, patches) | gitignored | CLI runtime state; directory stays in `.gitignore` |
| `docs/superpowers/` (directory shell) | tracked | Contents move to `docs/specs/` and `docs/plans/` |

`packages/cli/scripts/smoke-extension.sh` is **moved**, not deleted.

## 5. `packages/protocol` — Detail

A tiny TypeScript source package (no build step required for internal consumption; pure ESM). Approximate size: ~60 LOC.

**`packages/protocol/src/events.ts`** — verbatim content of today's `packages/extension/src/cli/events.ts`:

- `ChangedFile` interface
- `CliEvent` discriminated union (`protocol | sync_start | sync_progress | sync_done | chat_turn_start | chat_text | chat_diff | chat_done | error | cancelled`)
- `SUPPORTED_PROTOCOL = '1'`

**`packages/protocol/src/chat.ts`** — `ChatBody` zod schema moved from `packages/cli/src/agent/server.ts:77`. `zod` becomes a direct dep of `@remote-claude/protocol`.

**`packages/protocol/src/index.ts`** — re-exports.

**`packages/protocol/package.json`** —

```json
{
  "name": "@remote-claude/protocol",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "dependencies": { "zod": "^3.23.8" }
}
```

Consumers reference it via `workspace:*`. `tsup` in `cli` and `extension` already bundles dependencies, so the source-only export is fine — both bundlers transpile/inline TS sources from workspace packages without a separate build step.

## 6. Build/Config Fixes

### 6.1 `vercel.json`

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

### 6.2 `packages/cli/README.md`

A short CLI-specific README (not the monorepo root README) describing install, the two bins, and a link to the docs site. The root `README.md` is rewritten to describe the monorepo and link to each package.

### 6.3 Extension `tsup` consolidation

Replace three configs with one:

```ts
// packages/extension/tsup.config.ts
import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['src/extension.ts'],
    format: ['cjs'],
    outDir: 'dist',
    external: ['vscode'],
    outExtension: () => ({ js: '.cjs' }),
  },
  {
    entry: ['src/chat/webview/main.ts'],
    format: ['iife'],
    outDir: 'dist/webview',
    target: 'chrome100',
    outExtension: () => ({ js: '.js' }),
    loader: { '.html': 'copy', '.css': 'copy' },
    publicDir: 'src/chat/webview',
  },
  {
    entry: ['src/setup/webview/main.ts'],
    format: ['iife'],
    outDir: 'dist/setup-webview',
    target: 'chrome100',
    outExtension: () => ({ js: '.js' }),
    publicDir: 'src/setup/webview',
  },
]);
```

The HTML/CSS files are copied via `tsup`'s `publicDir` option if available in our `tsup` version; otherwise via an `onSuccess` hook running `cp src/.../index.html src/.../styles.css dist/.../`. Either way the **end state** is the same: a single `tsup.config.ts`, a build script of `"build": "tsup"`, and `dist/webview/{main.js,index.html,styles.css}` + `dist/setup-webview/{main.js,index.html,styles.css}` produced from one invocation. The implementation plan picks the mechanism after verifying which is supported.

### 6.4 `tsconfig.base.json`

Centralizes compiler options duplicated across the three existing `tsconfig.json` files. Each package's `tsconfig.json` becomes `{ "extends": "../../tsconfig.base.json", "compilerOptions": { ... package-specific overrides ... }, "include": [...] }`. **`tsconfig.base.json` holds only the options that are identical across all three current configs** (e.g., `target`, `module`, `strict`, `esModuleInterop`). Package-specific options (`jsx`, `lib`, `types`, `outDir`) stay in the per-package config. No new compiler flags are introduced.

## 7. `.gitignore` Tightening

Add to root `.gitignore`:

```
# Runtime/leak directories
rc-init-*/

# Build/incremental
*.tsbuildinfo
.tsbuildinfo

# Editor/AI tool caches
.qodo/
```

(`rc-del-*/`, `node-compile-cache/`, `.remote-claude/`, `.superpowers/`, `.worktrees/`, `*.vsix` are already covered.)

## 8. Migration Order (executable steps)

Each step is verifiable in isolation. The plan that follows this spec breaks them into concrete tasks.

1. **Junk removal + `.gitignore` tighten.** No code touched. Verify with `git status` (clean) and `ls` at root.
2. **Add `packages/protocol`.** Create directory + package.json + tsconfig + the three source files. Run `pnpm install`. Verify with `pnpm --filter @remote-claude/protocol typecheck`.
3. **Migrate consumers to `@remote-claude/protocol`.** Grep for all imports of `events.ts` and the local `ChatBody` definition. Rewrite every consumer (`packages/extension/src/**`, `packages/cli/src/agent/server.ts`, any tests) to import from `@remote-claude/protocol`. Delete `packages/extension/src/cli/events.ts`. Run `pnpm -r typecheck && pnpm -r test`.
4. **Fix `vercel.json`.** Update paths.
5. **Add `packages/cli/README.md`.** Rewrite root `README.md` as monorepo overview.
6. **Move `smoke-extension.sh`.** From `packages/cli/scripts/` to `packages/extension/scripts/`. Remove the `"smoke:extension"` entry from `packages/cli/package.json` and add a `"smoke"` script to `packages/extension/package.json` that invokes the moved file.
7. **Consolidate extension `tsup` configs.** Replace three files with one; update `packages/extension/package.json` build script.
8. **Add `tsconfig.base.json`.** Make each package's `tsconfig.json` extend it.
9. **Flatten `docs/`.** `git mv docs/superpowers/specs/* docs/specs/` and `git mv docs/superpowers/plans/* docs/plans/`. Remove the empty `docs/superpowers/` shell.
10. **Final verification.** `pnpm -r build && pnpm -r test && pnpm -r typecheck` — all green.

## 9. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| `tsup` source-only consumption of `@remote-claude/protocol` fails to resolve `.ts` imports across workspaces | If hit, add a one-line `"build": "tsup src/index.ts --dts --format esm,cjs"` to the protocol package and switch its `main`/`types` to `./dist/*`. Tested by `pnpm -r build`. |
| `vercel.json` change breaks production deploy | Verifiable in a Vercel preview deploy before merging. Rollback is reverting one file. |
| Hidden import of the to-be-deleted `events.ts` from a third location | Step 3 explicitly grep-verifies all consumers before deletion in step 4. |
| `publicDir` in `tsup` does not behave identically to the current `cp` step | Step 8 manually inspects `dist/webview/` and `dist/setup-webview/` after build to confirm `index.html` + `styles.css` are present alongside `main.js`. |

## 10. Verification

After all steps:

- `git status` shows no untracked junk at root.
- `pnpm -r typecheck` clean.
- `pnpm -r test` clean.
- `pnpm -r build` clean; `packages/cli/dist/`, `packages/extension/dist/`, `packages/website/dist/` populated correctly.
- `packages/extension/dist/webview/index.html` and `styles.css` present.
- `packages/cli/README.md` exists.
- `vercel.json` paths reference `packages/website`.
- `docs/specs/` and `docs/plans/` exist; `docs/superpowers/` does not.
- No references to `packages/extension/src/cli/events.ts` remain (`grep -r` clean).

## 11. Out of Scope (Explicit)

The following are noted but **not** part of this spec:

- Splitting `packages/cli` into separate `cli` and `agent` packages — deferred (option C from brainstorming).
- Independent versioning / release tooling (changesets, etc.).
- ESLint / Prettier consolidation across packages.
- Migrating tests to a co-located `*.test.ts` convention.
- Dependency upgrades.

These can be future specs once this baseline cleanup lands.
