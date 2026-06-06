# Self-contained Extension (bundle the CLI) — Implementation Plan

> REQUIRED SUB-SKILL: superpowers:subagent-driven-development. TDD where there's logic.

**Goal:** The VS Code extension runs a **bundled** CLI via the Extension Host's Node, so it works on install with no system Node/PATH. Ship as **0.3.1**.

**Source spec:** `docs/superpowers/specs/2026-06-06-self-contained-extension-design.md`
**Verify:** `pnpm --filter patchwire-vscode test|typecheck|build`, `pnpm --filter @rebink/patchwire test`.

---

## Task 0: Branch + baseline
- [ ] `cd /Users/apple/Documents/Workspace/patchwire && git checkout main && git checkout -b feat/self-contained-extension`
- [ ] `pnpm --filter patchwire-vscode test && pnpm --filter @rebink/patchwire test` → green. If red, STOP.

## Task 1: CLI resolver `src/cli/resolveCli.ts` (TDD)
**Files:** Create `packages/extension/src/cli/resolveCli.ts`, `packages/extension/src/cli/resolveCli.test.ts`

- [ ] **Failing test** `packages/extension/src/cli/resolveCli.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock the `vscode` module's getConfiguration so we can drive the override setting.
let override = '';
vi.mock('vscode', () => ({
  workspace: { getConfiguration: () => ({ get: (_k: string) => override }) },
}));
import { resolveCli } from './resolveCli.ts';

describe('resolveCli', () => {
  beforeEach(() => { override = ''; });

  it('uses the patchwire.cliPath override when set', () => {
    override = '/custom/patchwire';
    const inv = resolveCli('/ext');
    expect(inv).toEqual({ command: '/custom/patchwire', baseArgs: [], env: process.env });
  });

  it('runs the bundled cli.js via the Extension Host Node when present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-ext-'));
    mkdirSync(join(dir, 'dist', 'cli'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'cli', 'cli.js'), '// bundled');
    const inv = resolveCli(dir);
    expect(inv.command).toBe(process.execPath);
    expect(inv.baseArgs).toEqual([join(dir, 'dist', 'cli', 'cli.js')]);
    expect(inv.env.ELECTRON_RUN_AS_NODE).toBe('1');
    rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to bare `patchwire` when nothing bundled and no override', () => {
    const inv = resolveCli('/nonexistent-ext-path');
    expect(inv).toEqual({ command: 'patchwire', baseArgs: [], env: process.env });
  });
});
```
- [ ] Run `pnpm --filter patchwire-vscode test resolveCli` → FAIL.
- [ ] **Implement** `packages/extension/src/cli/resolveCli.ts`:
```ts
import * as vscode from 'vscode';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface CliInvocation {
  command: string;
  baseArgs: string[];
  env: NodeJS.ProcessEnv;
}

/**
 * Decide how to invoke the patchwire CLI:
 *  1. `patchwire.cliPath` setting, if set (devs / custom installs).
 *  2. The CLI bundled in the extension, run with the Extension Host's own Node
 *     (`process.execPath` + ELECTRON_RUN_AS_NODE) — no system Node or PATH needed.
 *  3. Bare `patchwire` on PATH (source/dev fallback when nothing is bundled).
 */
export function resolveCli(extensionFsPath: string): CliInvocation {
  const override = vscode.workspace.getConfiguration('patchwire').get<string>('cliPath')?.trim();
  if (override) {
    return { command: override, baseArgs: [], env: process.env };
  }
  const bundled = join(extensionFsPath, 'dist', 'cli', 'cli.js');
  if (existsSync(bundled)) {
    return {
      command: process.execPath,
      baseArgs: [bundled],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    };
  }
  return { command: 'patchwire', baseArgs: [], env: process.env };
}
```
- [ ] Run `pnpm --filter patchwire-vscode test resolveCli` → PASS.
- [ ] Commit: `feat(ext): CLI resolver — bundled CLI via Extension Host Node`

## Task 2: Bundle the CLI at build time
**Files:** Create `packages/extension/scripts/bundle-cli.mjs`; Modify `packages/extension/package.json` (build script)

- [ ] **Create `packages/extension/scripts/bundle-cli.mjs`:**
```js
// Build the CLI and copy its self-contained dist/cli.js into the extension's
// dist/cli/ so the .vsix ships a runnable CLI (no system Node/PATH needed).
import { execSync } from 'node:child_process';
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const extRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliJs = join(extRoot, '..', 'cli', 'dist', 'cli.js');

execSync('pnpm --filter @rebink/patchwire build', { stdio: 'inherit' });
if (!existsSync(cliJs)) throw new Error(`CLI build did not produce ${cliJs}`);

const outDir = join(extRoot, 'dist', 'cli');
mkdirSync(outDir, { recursive: true });
copyFileSync(cliJs, join(outDir, 'cli.js'));
console.log('bundled cli.js → dist/cli/cli.js');
```
- [ ] In `packages/extension/package.json`, change the `build` script from `"tsup"` to `"tsup && node scripts/bundle-cli.mjs"`.
- [ ] Run `pnpm --filter patchwire-vscode build`, then verify the bundled CLI runs standalone:
  `node packages/extension/dist/cli/cli.js --version` → prints the CLI version.
- [ ] Confirm `.vscodeignore` does NOT exclude `dist/cli` (it ignores `scripts/**` and `dist/**` is included by default — no change expected; verify).
- [ ] Commit: `build(ext): bundle the self-contained CLI into dist/cli`

## Task 3: Spawn the CLI through the resolver
**Files:** Modify `packages/extension/src/setup/SetupWizard.ts`, `packages/extension/src/cli/CliClient.ts` (+ its construction site), and the two tests (`SetupWizard.test.ts`, `CliClient.test.ts`).

- [ ] **SetupWizard.ts:** add `import { resolveCli } from '../cli/resolveCli.ts';`. At EACH of the 4 spawn sites (the `cp.spawnSync('patchwire', …)` near line 73 and the three `cp.spawn('patchwire', …)` near lines 123, 268, 379), replace the bare-`'patchwire'` call. The transform for each:
  - before: `cp.spawn('patchwire', ARGS, OPTS)`  →  after:
    ```ts
    const inv = resolveCli(this.extensionUri.fsPath);
    cp.spawn(inv.command, [...inv.baseArgs, ...ARGS], { ...OPTS, env: inv.env });
    ```
  - For the `spawnSync` site, the same shape with `cp.spawnSync(inv.command, [...inv.baseArgs, ...ARGS], { ...OPTS, env: inv.env })`.
  Keep each site's existing `ARGS`/`OPTS` exactly; only the command + baseArgs + env change. (If an `OPTS` object already sets `env`, merge: `{ ...OPTS, env: { ...inv.env, ...OPTS.env } }`.)

- [ ] **CliClient.ts:** replace the `cliPath: string` constructor param with `inv: CliInvocation` (import the type from `./resolveCli.ts`), and change `spawn(this.cliPath, args, { cwd })` to `spawn(this.inv.command, [...this.inv.baseArgs, ...args], { cwd: this.cwd, env: this.inv.env })`. Then update the one site that constructs `new CliClient(...)` (grep `new CliClient` across `packages/extension/src`; likely in `chat/ChatPanel.ts` or `cli/agent-rest.ts`) to pass `resolveCli(<extensionFsPath>)` instead of a path string — thread `extensionUri.fsPath` to that constructor if it isn't already available.

- [ ] **Update tests** to the new command shape:
  - `SetupWizard.test.ts` line ~106 asserts `c.cmd === 'patchwire'`. With the resolver, in the test environment (no bundled file, no override) it falls back to `'patchwire'`, so the assertion likely still holds — BUT if the test stubs `vscode`/extensionUri such that a bundled path exists, update it to assert on the resolved command. Read the test and adjust so it passes against the new code (assert the CLI args are forwarded after `inv.baseArgs`).
  - `CliClient.test.ts`: update construction to pass a `CliInvocation` (e.g. `{ command: 'patchwire', baseArgs: [], env: process.env }`) and keep the behavioral assertions.

- [ ] Run `pnpm --filter patchwire-vscode test && pnpm --filter patchwire-vscode typecheck` → green.
- [ ] Commit: `feat(ext): spawn CLI via resolver in SetupWizard + CliClient`

## Task 4: Config + version bumps
**Files:** `packages/extension/package.json`, `packages/cli/package.json`, `packages/cli/src/version.ts`, `CHANGELOG.md`

- [ ] **Extension `package.json`:** bump `"version"` → `"0.3.1"`. Add to `contributes` (alongside `commands`):
```json
"configuration": {
  "title": "Patchwire",
  "properties": {
    "patchwire.cliPath": {
      "type": "string",
      "default": "",
      "description": "Absolute path to the patchwire CLI. Leave empty to use the CLI bundled with the extension."
    }
  }
}
```
- [ ] **CLI lockstep:** set `packages/cli/package.json` `"version"` → `"0.3.1"` and `packages/cli/src/version.ts` `VERSION` → `"0.3.1"`. Run `pnpm --filter @rebink/patchwire test version.test` → PASS.
- [ ] **CHANGELOG.md:** add a `## [0.3.1] — 2026-06-06` section: "Extension now bundles the CLI and runs it via VS Code's Node — installs and works with no separate CLI install or PATH setup (fixes `spawn patchwire ENOENT`). Adds `patchwire.cliPath` override."
- [ ] Commit: `chore(release): 0.3.1 — bundled-CLI extension + cliPath setting`

## Task 5: Verify end-to-end
- [ ] `pnpm --filter patchwire-vscode typecheck` → 0; `pnpm --filter patchwire-vscode test` → green; `pnpm --filter @rebink/patchwire test` → green (224 local).
- [ ] `pnpm --filter patchwire-vscode build && pnpm --filter patchwire-vscode package` → `.vsix` built.
- [ ] Confirm the vsix contains the CLI: `unzip -l packages/extension/*.vsix | grep 'dist/cli/cli.js'` → present.
- [ ] `node packages/extension/dist/cli/cli.js --version` → `0.3.1`.
- [ ] Clean up the local `.vsix` (gitignored): `rm -f packages/extension/*.vsix`.

## Self-review (author)
- Spec coverage: resolver (override/bundled/fallback) → T1; bundling → T2; spawn-through-resolver in SetupWizard + CliClient → T3; config + version lockstep + changelog → T4; vsix-contains-CLI + version → T5.
- No placeholders; resolver/bundle code complete. SetupWizard spawn-site edits are described as an exact transform over the existing 4 sites (read the file for the precise ARGS/OPTS).
- Names consistent: `resolveCli`, `CliInvocation`, `inv.command`/`baseArgs`/`env`; `ELECTRON_RUN_AS_NODE`; bundled path `dist/cli/cli.js`.
