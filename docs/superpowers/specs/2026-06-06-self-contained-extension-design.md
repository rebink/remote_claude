# Milestone — Self-contained VS Code extension (bundle the CLI)

**Date:** 2026-06-06
**Status:** Approved design, ready for plan. Target release: **0.3.1**.

## Problem
The extension spawns the bare command `patchwire` (4 sites in `SetupWizard.ts`, plus `CliClient`). A Marketplace-installed extension launched from the macOS Dock only sees `/etc/paths`, so it can't find a `patchwire` installed via npm-global/nvm/Homebrew — `spawn patchwire ENOENT`. It also can't find `node` for the CLI's `#!/usr/bin/env node` shebang. Users shouldn't have to install anything or launch from a terminal.

## Decision (from brainstorm)
**Bundle the CLI inside the extension and run it with the Extension Host's Node** (`process.execPath` + `ELECTRON_RUN_AS_NODE=1`). Zero system Node, zero PATH dependency, works from the Dock. Optional `patchwire.cliPath` setting overrides (for devs). The CLI's `dist/cli.js` is already fully self-contained (0 runtime deps), so we just ship that file in the `.vsix`.

## Design

### Bundle at build time
- New `packages/extension/scripts/bundle-cli.mjs`: builds the CLI (`pnpm --filter @rebink/patchwire build`) then copies `packages/cli/dist/cli.js` → `packages/extension/dist/cli/cli.js`.
- Extension `build` script → `tsup && node scripts/bundle-cli.mjs`.
- `.vscodeignore` already ignores `scripts/**` (generator excluded) and includes `dist/**` (so `dist/cli/cli.js` ships). No change needed beyond confirming.

### CLI resolver — `src/cli/resolveCli.ts`
```ts
export interface CliInvocation { command: string; baseArgs: string[]; env: NodeJS.ProcessEnv }
export function resolveCli(extensionFsPath: string): CliInvocation
```
Resolution order:
1. `patchwire.cliPath` setting (trimmed, non-empty) → `{ command: <path>, baseArgs: [], env: process.env }`.
2. Bundled `path.join(extensionFsPath, 'dist', 'cli', 'cli.js')` if it exists → `{ command: process.execPath, baseArgs: [<that>], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }`.
3. Fallback `{ command: 'patchwire', baseArgs: [], env: process.env }` (dev/source runs).

### Use the invocation everywhere the CLI is spawned
- `SetupWizard.ts` (has `extensionUri`): at each of the 4 spawn sites (lines ~73 `spawnSync` list-peers, ~123 password-stdin, ~268 init-remote, ~379 doctor), compute `const inv = resolveCli(this.extensionUri.fsPath)` and call `cp.spawn(inv.command, [...inv.baseArgs, ...args], { ...opts, env: inv.env })` / `cp.spawnSync(inv.command, [...inv.baseArgs, ...args], { ...opts, env: inv.env })`.
- `CliClient.ts`: change constructor to take a `CliInvocation` (replacing `cliPath`); `spawn(args)` → `spawn(inv.command, [...inv.baseArgs, ...args], { cwd, env: inv.env })`. Update its construction site(s) to pass `resolveCli(extensionFsPath)`.

### Config + versions
- `package.json` (extension): add `contributes.configuration` with `patchwire.cliPath` (string, default `""`, description: "Absolute path to the patchwire CLI. Leave empty to use the version bundled with the extension."). Bump `version` → `0.3.1`. Update `build` script.
- CLI lockstep: bump `packages/cli/package.json` + `packages/cli/src/version.ts` → `0.3.1` (the bundled cli.js corresponds to published `@rebink/patchwire@0.3.1`). Update `CHANGELOG.md` with `[0.3.1]`.

## Out of scope
- Auto-installing system deps the CLI shells out to (`git`/`ssh`/`rsync`/`mutagen`/`claude`) — the wizard's doctor already reports those.
- Bundling `patchwire-agent` (runs on the remote, installed there separately).

## Success criteria
- `resolveCli` unit-tested: override wins; bundled path → `process.execPath` + `ELECTRON_RUN_AS_NODE`; fallback to `patchwire`.
- `vsce package` produces a `.vsix` containing `dist/cli/cli.js`; `node dist/cli/cli.js --version` prints `0.3.1`.
- SetupWizard + CliClient spawn through the resolver (existing tests updated to the new command shape).
- `pnpm --filter patchwire-vscode test/typecheck` green; CLI `version.test` green at 0.3.1; both packages build.
- Released as `v0.3.1` (npm + Marketplace + Open VSX via the idempotent pipeline).

## Affected files
- Create: `packages/extension/scripts/bundle-cli.mjs`, `packages/extension/src/cli/resolveCli.ts`, `packages/extension/src/cli/resolveCli.test.ts`
- Modify: `packages/extension/src/cli/CliClient.ts` (+ test + construction site), `packages/extension/src/setup/SetupWizard.ts` (+ test), `packages/extension/package.json`, `packages/extension/tsup.config.ts` (only if needed), `packages/cli/package.json`, `packages/cli/src/version.ts`, `CHANGELOG.md`
