# Patchwire Rebrand Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename "Remote Claude" → "Patchwire" across every external and internal surface in the monorepo, in a sequence where each commit lands in a verifiable state (typecheck/build/test green).

**Architecture:** Bottom-up by surface depth. Start with workspace package names (deepest dependency), then binary names, then the source-code refactor that decouples `claude` identifiers from the brand, then user-facing artifacts (config file, state dir, env vars), then the VS Code extension manifest, then documentation prose, then website. Final verification confirms zero residual references outside historical specs.

**Tech Stack:** pnpm 10 workspaces, TypeScript 5, tsup, vitest, Astro/Starlight, Fastify (agent), Zod.

**Spec:** `docs/specs/2026-05-31-rebrand-to-patchwire-design.md`

---

## File Structure

This plan touches files across all four workspace packages and the docs site, but creates no new files except a new dogfood config and the renamed AI runner.

**Renamed files:**
- `packages/cli/src/agent/claude.ts` → `packages/cli/src/agent/ai-runner.ts`
- `remote-claude.yml` (repo root, dogfood config) → `patchwire.yml`
- `.remote-claude/` (repo root, dogfood state dir) → `.patchwire/`

**Modified package.json files (5 of them):**
- root `package.json`
- `packages/cli/package.json`
- `packages/extension/package.json`
- `packages/website/package.json`
- `packages/protocol/package.json`

**Modified source files (≈40):** every file in `packages/cli/src/`, `packages/extension/src/`, and the website that contains a brand reference or an `RC_*` env var. Inventoried in each task.

**Modified docs/website (≈25):** every Markdown file under `packages/website/src/content/docs/`, the website's `index.astro` + `astro.config.mjs`, plus root `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `DEVELOPMENT.md`, and the two package READMEs.

**Unchanged:** historical specs under `docs/specs/2026-04-*` through `docs/specs/2026-05-31-monorepo-restructure-design.md`, historical plans under `docs/plans/2026-*` (except this one).

---

## Task 1: Workspace package names + repo URLs

**Files:**
- Modify: `package.json` (root)
- Modify: `packages/cli/package.json`
- Modify: `packages/extension/package.json`
- Modify: `packages/website/package.json`
- Modify: `packages/protocol/package.json`
- Modify: `packages/cli/src/agent/server.ts` (import path)
- Modify: `packages/extension/src/cli/CliClient.ts` (import path)
- Modify: `pnpm-lock.yaml` (regenerated)

This task is atomic — package name, all workspace deps, and TS import paths all flip together. Any partial state breaks the build.

- [ ] **Step 1: Update `packages/protocol/package.json` name**

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/protocol/package.json`, change:

```json
"name": "@remote-claude/protocol",
```

to:

```json
"name": "@patchwire/protocol",
```

- [ ] **Step 2: Update `packages/cli/package.json`**

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/cli/package.json`:

```json
"name": "remote-claude",
```
→
```json
"name": "patchwire",
```

```json
"homepage": "https://github.com/rebink/remote_claude#readme",
"repository": {
    "type": "git",
    "url": "git+https://github.com/rebink/remote_claude.git"
},
"bugs": {
    "url": "https://github.com/rebink/remote_claude/issues"
},
```
→
```json
"homepage": "https://github.com/rebink/patchwire#readme",
"repository": {
    "type": "git",
    "url": "git+https://github.com/rebink/patchwire.git"
},
"bugs": {
    "url": "https://github.com/rebink/patchwire/issues"
},
```

```json
"@remote-claude/protocol": "workspace:*",
```
→
```json
"@patchwire/protocol": "workspace:*",
```

(Leave the `bin` block alone — Task 2 handles binary names.)

- [ ] **Step 3: Update `packages/extension/package.json`**

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/extension/package.json`:

```json
"name": "remote-claude-vscode",
```
→
```json
"name": "patchwire-vscode",
```

```json
"repository": {
    "type": "git",
    "url": "git+https://github.com/rebink/remote_claude.git",
    "directory": "extension"
},
```
→
```json
"repository": {
    "type": "git",
    "url": "git+https://github.com/rebink/patchwire.git",
    "directory": "packages/extension"
},
```

```json
"@remote-claude/protocol": "workspace:*",
```
→
```json
"@patchwire/protocol": "workspace:*",
```

(Leave `displayName`, `publisher`, `contributes.*`, and the `remoteClaude` key alone — Task 6 handles the VS Code extension manifest.)

- [ ] **Step 4: Update `packages/website/package.json`**

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/website/package.json`:

```json
"name": "remote-claude-docs",
```
→
```json
"name": "patchwire-docs",
```

- [ ] **Step 5: Update root `package.json`**

In `/Users/apple/Documents/Workspace/dev_sync_cli/package.json`:

```json
"name": "remote-claude-monorepo",
```
→
```json
"name": "patchwire-monorepo",
```

Update the workspace script aliases:

```json
"cli": "pnpm --filter remote-claude",
"extension": "pnpm --filter remote-claude-vscode",
"website": "pnpm --filter remote-claude-docs"
```
→
```json
"cli": "pnpm --filter patchwire",
"extension": "pnpm --filter patchwire-vscode",
"website": "pnpm --filter patchwire-docs"
```

- [ ] **Step 6: Update TypeScript import paths**

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/cli/src/agent/server.ts`, find the line:

```ts
import { ChatBody } from '@remote-claude/protocol';
```

Replace with:

```ts
import { ChatBody } from '@patchwire/protocol';
```

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/extension/src/cli/CliClient.ts`, find the line:

```ts
import type { CliEvent } from '@remote-claude/protocol';
```

Replace with:

```ts
import type { CliEvent } from '@patchwire/protocol';
```

- [ ] **Step 7: Verify no other `@remote-claude/` imports remain**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
grep -rn "@remote-claude" packages --include="*.ts" --include="*.tsx" --include="*.json"
```

Expected: zero matches. If any appear (besides the historical specs/plans, which `--include` excludes), update them to `@patchwire`.

- [ ] **Step 8: Refresh the lockfile**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm install 2>&1 | tail -10
```

Expected: pnpm completes without errors. The lockfile will rewrite workspace resolution entries. No new external packages are added.

- [ ] **Step 9: Verify typecheck + build**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm -r typecheck
pnpm -r build 2>&1 | tail -10
```

Expected: typecheck exits 0; all four packages build. `packages/cli/dist/cli.js`, `dist/agent.js`, `packages/extension/dist/extension.cjs`, `packages/website/dist/index.html` all produced.

- [ ] **Step 10: Commit**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git add package.json packages/cli/package.json packages/extension/package.json packages/website/package.json packages/protocol/package.json packages/cli/src/agent/server.ts packages/extension/src/cli/CliClient.ts pnpm-lock.yaml
git commit -m "rebrand: rename workspace packages to patchwire

@remote-claude/protocol → @patchwire/protocol
remote-claude → patchwire
remote-claude-vscode → patchwire-vscode
remote-claude-docs → patchwire-docs
remote-claude-monorepo → patchwire-monorepo

Workspace dep references and TS import sites updated atomically.
Repo URLs in package.json point at github.com/rebink/patchwire
(GitHub auto-redirects from the old URL)."
```

---

## Task 2: Binary names

**Files:**
- Modify: `packages/cli/package.json` (bin block only)

Trivial isolated change. The TypeScript source files keep their names; only the published binary names change.

- [ ] **Step 1: Update the `bin` block**

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/cli/package.json`, find:

```json
"bin": {
    "remote-claude": "./dist/cli.js",
    "remote-claude-agent": "./dist/agent.js"
},
```

Replace with:

```json
"bin": {
    "patchwire": "./dist/cli.js",
    "patchwire-agent": "./dist/agent.js"
},
```

- [ ] **Step 2: Rebuild and verify the bin entries**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm --filter patchwire build 2>&1 | tail -5
cd packages/cli
pnpm pack --pack-destination /tmp 2>&1 | tail -5
tar -tzf /tmp/patchwire-0.1.0.tgz | head
rm /tmp/patchwire-0.1.0.tgz
```

Expected: the tar listing shows `package/dist/cli.js` and `package/dist/agent.js`. (The `bin` mapping is honored at install time, not in the tarball — those entry points exist as expected.)

- [ ] **Step 3: Commit**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git add packages/cli/package.json
git commit -m "rebrand: rename CLI binaries to patchwire + patchwire-agent

The dist filenames (cli.js, agent.js) are unchanged; only the npm
'bin' map flips. After install, users invoke 'patchwire' and
'patchwire-agent' on the command line."
```

---

## Task 3: Source identifier refactor + file rename

**Files:**
- Move: `packages/cli/src/agent/claude.ts` → `packages/cli/src/agent/ai-runner.ts`
- Modify: `packages/cli/src/agent.ts` (import + usage)
- Modify: `packages/cli/src/agent/server.ts` (import + usage)
- Modify: `packages/cli/src/agent/ai-runner.ts` (renamed exports inside)
- Modify: any test files that import from the renamed file (check with grep)

This task decouples the AI-runner code from the literal `claude` name to reflect the architecture's AI-pluggability. The file itself moves; exported names change; consumers update.

- [ ] **Step 1: Move the file**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git mv packages/cli/src/agent/claude.ts packages/cli/src/agent/ai-runner.ts
```

- [ ] **Step 2: Rename exports inside the moved file**

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/cli/src/agent/ai-runner.ts`, perform the following exact renames:

- `export function findClaude(command: string)` → `export function findAiBin(command: string)`
- `export function probeClaudeVersion(commandPath: string)` → `export function probeAiVersion(commandPath: string)`
- `export function makeClaudeRunner(opts: ...)` → `export function makeAiRunner(opts: ...)`
- `export const claudeRunner` → `export const aiRunner`

Also update internal references inside the file:
- Any local call to `findClaude(...)` → `findAiBin(...)`
- Any local call to `makeClaudeRunner(...)` → `makeAiRunner(...)`
- The exported `claudeRunner` is constructed at module bottom — keep the construction logic, just rename the binding.

For the inline error messages, change:
- `\`claude execution timed out after ${opts.timeoutMs}ms\`` → `\`AI command timed out after ${opts.timeoutMs}ms\``
- `\`claude stdin error: ${err.message}\`` → `\`AI command stdin error: ${err.message}\``
- `\`claude exited ${code} (auth-locked).\\n${NOT_LOGGED_IN_REMEDIATION}\`` → `\`AI command exited ${code} (auth-locked).\\n${NOT_LOGGED_IN_REMEDIATION}\``
- `\`claude exited ${code}\`` → `\`AI command exited ${code}\``

The doc comment at the top of the file (the `/** ... */` block describing env vars) updates `RC_CLAUDE_BIN` → `PW_AI_BIN` and `RC_CLAUDE_ARGS` → `PW_AI_ARGS` (Task 5 owns the env-var rename across the codebase; do it here too to keep the file internally consistent).

The `process.env.RC_CLAUDE_BIN` and `process.env.RC_CLAUDE_ARGS` reads at the bottom of the file update to `process.env.PW_AI_BIN` and `process.env.PW_AI_ARGS`.

- [ ] **Step 3: Update `packages/cli/src/agent.ts`**

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/cli/src/agent.ts`, find the import from `./agent/claude.ts` (or similar relative path) and update to `./agent/ai-runner.ts`. Update the imported names: `claudeRunner` → `aiRunner`, `findClaude` → `findAiBin`, etc., as referenced.

Run:
```bash
grep -n "claude\|findClaude\|claudeRunner\|makeClaudeRunner\|probeClaudeVersion" /Users/apple/Documents/Workspace/dev_sync_cli/packages/cli/src/agent.ts
```

For each match: rewrite according to the mapping (`claudeRunner` → `aiRunner`, etc.). Do NOT rewrite occurrences of the word `claude` that refer to the AI tool *as a tool* (e.g., a log message saying "spawning claude") — only the *identifiers* change.

- [ ] **Step 4: Update `packages/cli/src/agent/server.ts`**

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/cli/src/agent/server.ts`:

```bash
grep -n "claudeCommand\|claudeArgs\|claudeRunner\|findClaude" /Users/apple/Documents/Workspace/dev_sync_cli/packages/cli/src/agent/server.ts
```

For each match, apply the mapping:
- `opts.claudeCommand` → `opts.aiCommand`
- `opts.claudeArgs` → `opts.aiArgs`
- `claudeRunner` → `aiRunner` (in import + usage)
- `findClaude(...)` → `findAiBin(...)`
- The `AgentOptions` interface (defined in this file): rename interface fields `claudeCommand` → `aiCommand`, `claudeArgs` → `aiArgs`.

Also update the local variable declarations: e.g., `const claudeRunner2 = makeClaudeRunner(...)` → `const aiRunner2 = makeAiRunner(...)`. The error message `"claude not found"` (or similar) rewrites to `"AI command not found"` if present.

- [ ] **Step 5: Find any other consumers**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
grep -rn "claudeRunner\|findClaude\|probeClaudeVersion\|makeClaudeRunner\|claudeCommand\|claudeArgs" packages/cli/src packages/cli/test packages/extension/src
```

For each match found, apply the same mapping. Expected: there may be a few in `packages/cli/test/agent.test.ts` (which constructs `AgentOptions`) — update those test fixtures to use `aiCommand` / `aiArgs`.

- [ ] **Step 6: Verify the file rename is reflected in imports**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
grep -rn "from ['\"].*agent/claude" packages/cli/src packages/cli/test
```

Expected: zero matches (the only file that previously imported from `agent/claude` should now import from `agent/ai-runner`).

- [ ] **Step 7: Typecheck + test**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm --filter patchwire typecheck
pnpm --filter patchwire test 2>&1 | tail -15
```

Expected: typecheck clean; tests pass (the same one pre-existing test failure `returns 412 when project is not a git repo` may surface depending on test order, but is environmental, not introduced by this task).

- [ ] **Step 8: Commit**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git add packages/cli/src/agent.ts packages/cli/src/agent/server.ts packages/cli/src/agent/ai-runner.ts packages/cli/test
git commit -m "refactor(cli): rename Claude-specific identifiers to AI-runner

The agent's AI-tool layer is architecturally pluggable (the user
configures ai.command/ai.args). Renames file and identifiers to
reflect that:

  packages/cli/src/agent/claude.ts → ai-runner.ts
  findClaude              → findAiBin
  probeClaudeVersion      → probeAiVersion
  makeClaudeRunner        → makeAiRunner
  claudeRunner            → aiRunner
  AgentOptions.claudeCommand/Args → aiCommand/Args
  RC_CLAUDE_BIN/ARGS env reads    → PW_AI_BIN/ARGS

Inline error messages now say 'AI command exited X' instead of
'claude exited X' so they remain accurate when the configured tool
is codex, aider, or any other CLI."
```

---

## Task 4: Config file rename `remote-claude.yml` → `patchwire.yml`

**Files:**
- Move: `remote-claude.yml` (repo root, dogfood config) → `patchwire.yml`
- Modify: `packages/cli/src/lib/config.ts` (the file path the loader checks for)
- Modify: `packages/cli/src/cli.ts` (help text mentioning the file)
- Modify: `packages/cli/test/config.test.ts` (test fixture filenames)
- Modify: `packages/extension/src/extension.ts:28`
- Modify: `packages/extension/src/chat/ChatPanel.ts:119,135,162`
- Modify: `packages/extension/src/setup/SetupWizard.ts:234,235,257`
- Modify: `packages/extension/src/chat/webview/main.ts:41`

- [ ] **Step 1: Rename the dogfood config**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git mv remote-claude.yml patchwire.yml
```

- [ ] **Step 2: Update all readers in the CLI package**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
grep -n "remote-claude\.yml" packages/cli/src/lib/config.ts packages/cli/src/cli.ts packages/cli/test/config.test.ts
```

For every match (there will be approximately 4-6), replace the literal string `remote-claude.yml` with `patchwire.yml`. Use a per-file Edit. Examples:

In `packages/cli/src/cli.ts`:
- `.option('-f, --force', 'overwrite existing remote-claude.yml')` (appears twice, in two subcommand option blocks) → `.option('-f, --force', 'overwrite existing patchwire.yml')`
- `.option('--host <host>', 'override host from remote-claude.yml')` → `.option('--host <host>', 'override host from patchwire.yml')`
- `.option('--user <user>', 'override user from remote-claude.yml')` → `.option('--user <user>', 'override user from patchwire.yml')`

In `packages/cli/src/lib/config.ts`:
- The loader's filename constant (likely `const FILE = 'remote-claude.yml'` or similar) → `'patchwire.yml'`.

In `packages/cli/test/config.test.ts`:
- The three test fixtures that write or read `remote-claude.yml` → `patchwire.yml`.

- [ ] **Step 3: Update all readers in the extension package**

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/extension/src/extension.ts`, line ~28:

```ts
const configPath = join(ws, 'remote-claude.yml');
```
→
```ts
const configPath = join(ws, 'patchwire.yml');
```

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/extension/src/chat/ChatPanel.ts`:

```ts
const yamlPath = join(this.workspaceFolder, 'remote-claude.yml');
```
→
```ts
const yamlPath = join(this.workspaceFolder, 'patchwire.yml');
```

```ts
this.deps.output.appendLine(`Failed to read remote-claude.yml: ${(err as Error).message}`);
```
→
```ts
this.deps.output.appendLine(`Failed to read patchwire.yml: ${(err as Error).message}`);
```

```ts
vscode.window.showErrorMessage('No remote-claude.yml found — run Remote Claude: Setup first.');
```
→
```ts
vscode.window.showErrorMessage('No patchwire.yml found — run Patchwire: Setup first.');
```

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/extension/src/setup/SetupWizard.ts`:

```ts
// 3. Write remote-claude.yml in the local folder
const yamlPath = path.join(expandedLocalPath, 'remote-claude.yml');
```
→
```ts
// 3. Write patchwire.yml in the local folder
const yamlPath = path.join(expandedLocalPath, 'patchwire.yml');
```

```ts
result: { ok: false, where: 'local', stderr: `Failed to write remote-claude.yml: ${(err as Error).message}` },
```
→
```ts
result: { ok: false, where: 'local', stderr: `Failed to write patchwire.yml: ${(err as Error).message}` },
```

(The comment `// Reload the window so the extension reactivates and picks up the new remote-claude.yml.` at line ~408 also updates to `patchwire.yml`.)

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/extension/src/chat/webview/main.ts`:

```ts
h('p', { className: 'empty' }, 'No remote-claude.yml in this workspace yet.'),
```
→
```ts
h('p', { className: 'empty' }, 'No patchwire.yml in this workspace yet.'),
```

- [ ] **Step 4: Verify no source file still references the old filename**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
grep -rn "remote-claude\.yml" packages/cli/src packages/cli/test packages/extension/src
```

Expected: zero matches.

- [ ] **Step 5: Typecheck + test + build**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm -r typecheck
pnpm -r test 2>&1 | tail -10
```

Expected: typecheck clean; `packages/cli/test/config.test.ts` passes (its fixtures now write `patchwire.yml`, the loader reads that file).

- [ ] **Step 6: Commit**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git add remote-claude.yml patchwire.yml packages/cli/src packages/cli/test packages/extension/src
git commit -m "rebrand: rename config file remote-claude.yml → patchwire.yml

Renames the per-project YAML the CLI and extension read for host,
user, and AI command settings. All readers updated. Help text in
'remote-claude setup --force' and similar flags updated."
```

---

## Task 5: State dir + env vars

**Files:**
- Move: `.remote-claude/` (repo root dogfood state, gitignored) → `.patchwire/`
- Modify: `.gitignore` (replace `.remote-claude/` with `.patchwire/`)
- Modify: `packages/cli/src/cli.ts` (help text + last-patch path)
- Modify: `packages/cli/src/agent.ts` (env var reads if any)
- Modify: `packages/cli/src/agent/server.ts` (sessionStorePath default)
- Modify: `packages/cli/src/agent/ai-runner.ts` (already done in Task 3 — Task 3 covered PW_AI_BIN/ARGS — verify)
- Modify: `packages/cli/src/commands/daemon.ts`, `init.ts`, `setup.ts` (env vars)
- Modify: `packages/cli/src/lib/config.ts`, `log.ts` (env vars)
- Modify: `packages/cli/test/integration/bootstrap.e2e.test.ts` (`RC_E2E` → `PW_E2E`, comment about `~/.remote-claude/`)
- Modify: `packages/extension/src/setup/SetupWizard.ts` (state-dir paths + env vars + YAML template)
- Modify: `packages/extension/src/sync/MutagenController.ts` (sync exclude + key path)
- Also move `~/.remote-claude/` on the engineer's machine to `~/.patchwire/` — see Step 7.

Coordinated because SetupWizard writes `patchwire.yml` containing `${PW_TOKEN}` AND writes the token into `~/.patchwire/env`. If env vars are renamed without the state dir, the written YAML interpolates against the wrong env var.

- [ ] **Step 1: Move the repo-root dogfood state**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
test -d .remote-claude && mv .remote-claude .patchwire || echo "no dogfood state to move"
```

- [ ] **Step 2: Update `.gitignore`**

In `/Users/apple/Documents/Workspace/dev_sync_cli/.gitignore`, find:

```
.remote-claude/
```

Replace with:

```
.patchwire/
```

- [ ] **Step 3: Inventory remaining `.remote-claude` and `RC_` references**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
grep -rn "\.remote-claude\b\|RC_[A-Z_]\+" packages --include="*.ts" --include="*.json" --include="*.yml" --include="*.mjs"
```

This produces the working list for Steps 4–6.

- [ ] **Step 4: Rewrite the state-dir references**

For every match of `.remote-claude` from Step 3 (excluding doc files which Task 7/8 handles), replace with `.patchwire`. Examples:

In `packages/extension/src/setup/SetupWizard.ts`:
- `~/.remote-claude/keys/<host>-<user>` (in a comment) → `~/.patchwire/keys/<host>-<user>`
- `path.join(os.homedir(), '.remote-claude', 'keys', ...)` → `path.join(os.homedir(), '.patchwire', 'keys', ...)`
- `path.join(os.homedir(), '.remote-claude', 'env')` → `path.join(os.homedir(), '.patchwire', 'env')`

In `packages/extension/src/sync/MutagenController.ts`:
- Line 41: the sync-exclude list entry `'.remote-claude'` → `'.patchwire'`
- Line 97: `join(homedir(), '.remote-claude', 'keys', ...)` → `join(homedir(), '.patchwire', 'keys', ...)`

In `packages/cli/src/cli.ts`:
- The help text `'per-project SSH key (default: ~/.remote-claude/keys/<host>-<user>)'` → `'per-project SSH key (default: ~/.patchwire/keys/<host>-<user>)'`
- The apply command description `'Apply a previously saved patch (default: .remote-claude/last.patch)'` → `'Apply a previously saved patch (default: .patchwire/last.patch)'`

In `packages/cli/src/agent/server.ts`:
- The sessionStorePath default `join(homedir(), '.remote-claude', 'agent-sessions.json')` → `join(homedir(), '.patchwire', 'agent-sessions.json')`

In any test files / integration test comments referencing `~/.remote-claude/`, update to `~/.patchwire/`.

- [ ] **Step 5: Rewrite the env vars**

For every `RC_*` env var reference, apply the mapping:

| Old | New |
|---|---|
| `RC_TOKEN` | `PW_TOKEN` |
| `RC_AGENT_TOKEN` | `PW_AGENT_TOKEN` |
| `RC_CLAUDE_BIN` | `PW_AI_BIN` |
| `RC_CLAUDE_ARGS` | `PW_AI_ARGS` |
| `RC_VERBOSE` | `PW_VERBOSE` |
| `RC_E2E` | `PW_E2E` |

Touch these files (from the Step 3 inventory):
- `packages/cli/src/agent.ts`
- `packages/cli/src/agent/ai-runner.ts` (Task 3 already updated `RC_CLAUDE_BIN`/`ARGS` → `PW_AI_BIN`/`ARGS`; verify nothing remains)
- `packages/cli/src/cli.ts`
- `packages/cli/src/commands/daemon.ts`
- `packages/cli/src/commands/init.ts`
- `packages/cli/src/commands/setup.ts`
- `packages/cli/src/lib/config.ts`
- `packages/cli/src/lib/log.ts`
- `packages/cli/test/integration/bootstrap.e2e.test.ts`
- `packages/extension/src/setup/SetupWizard.ts` (the env-file `RC_TOKEN=` regex + the YAML template `${RC_TOKEN}`)

The SetupWizard's regex and write-back deserves explicit attention:

```ts
const match = envText.match(/^RC_TOKEN=(.+)$/m);
```
→
```ts
const match = envText.match(/^PW_TOKEN=(.+)$/m);
```

```ts
fs.writeFileSync(envPath, `RC_TOKEN=${token}\n`, { mode: 0o600 });
```
→
```ts
fs.writeFileSync(envPath, `PW_TOKEN=${token}\n`, { mode: 0o600 });
```

The launchd hint string:
```ts
`Set RC_AGENT_TOKEN=${token} on the Mac Mini's launchd agent for it to take effect.`,
```
→
```ts
`Set PW_AGENT_TOKEN=${token} on the Mac Mini's launchd agent for it to take effect.`,
```

The written YAML template:
```ts
token: '${RC_TOKEN}',
```
→
```ts
token: '${PW_TOKEN}',
```

- [ ] **Step 6: Update the dogfood `patchwire.yml` (the file moved in Task 4)**

In `/Users/apple/Documents/Workspace/dev_sync_cli/patchwire.yml`, find:

```yaml
token: ${RC_TOKEN}
```
→
```yaml
token: ${PW_TOKEN}
```

- [ ] **Step 7: Move the engineer's home state dir (one-time)**

```bash
test -d ~/.remote-claude && mv ~/.remote-claude ~/.patchwire || echo "no home state to move"
```

(If the directory doesn't exist, this is a no-op. This step is for the local dev environment and is not committed.)

- [ ] **Step 8: Verify zero residual `RC_` env-var references and zero `.remote-claude` paths**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
grep -rn "\bRC_[A-Z_]\+" packages --include="*.ts" --include="*.json" --include="*.yml"
grep -rn "\.remote-claude" packages --include="*.ts" --include="*.json" --include="*.yml" --include="*.mjs"
```

Expected: zero matches in each command. (Docs/markdown will still have references — those are Tasks 7/8.)

- [ ] **Step 9: Typecheck + test**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm -r typecheck
pnpm -r test 2>&1 | tail -10
```

Expected: typecheck clean; all tests pass.

- [ ] **Step 10: Commit**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git add .gitignore patchwire.yml packages/cli/src packages/cli/test packages/extension/src
# .remote-claude was untracked; .patchwire is gitignored. Nothing to git add for the rename.
git commit -m "rebrand: rename state dir and env vars

  .remote-claude/   → .patchwire/   (project root + ~/)
  RC_TOKEN          → PW_TOKEN
  RC_AGENT_TOKEN    → PW_AGENT_TOKEN
  RC_CLAUDE_BIN     → PW_AI_BIN
  RC_CLAUDE_ARGS    → PW_AI_ARGS
  RC_VERBOSE        → PW_VERBOSE
  RC_E2E            → PW_E2E

PW_AI_BIN/ARGS drop the CLAUDE token from the env var name —
the architecture is AI-agnostic, and a user configuring
'command: codex' should not see a _CLAUDE_ env var. SetupWizard's
written YAML template and env-file regex updated together."
```

---

## Task 6: VS Code extension manifest + UI strings

**Files:**
- Modify: `packages/extension/package.json` (displayName, description, publisher, command IDs, viewsContainers IDs, view IDs, `remoteClaude` config key)
- Modify: `packages/extension/src/extension.ts` (`registerCommand` calls)
- Modify: `packages/extension/src/commands.ts` (any command-id references)
- Modify: `packages/extension/src/chat/ChatPanel.ts` (any user-facing strings)
- Modify: `packages/extension/src/setup/SetupWizard.ts` (user-facing strings)
- Modify: `packages/extension/src/chat/webview/index.html` and `main.ts` (UI text)
- Modify: `packages/extension/src/setup/webview/index.html` and `main.ts` (UI text)
- Modify: `packages/extension/src/diff/DiffContentProvider.ts`, `session/sessionTerminal.ts`, `cli/CliClient.ts` (any brand strings)
- Modify: `packages/extension/src/setup/SetupWizard.test.ts` (spawn-mock for `remote-claude` binary)

- [ ] **Step 1: Update `packages/extension/package.json`**

Make the following edits in `/Users/apple/Documents/Workspace/dev_sync_cli/packages/extension/package.json`:

```json
"displayName": "Remote Claude",
"description": "Chat with Claude on a remote Mac Mini from VS Code.",
```
→
```json
"displayName": "Patchwire",
"description": "Chat with an AI on a remote Mac from VS Code. Diffs come back for review.",
```

```json
"publisher": "remote-claude",
```
→
```json
"publisher": "patchwire",
```

In the `"contributes"` block, the commands and views:

```json
"contributes": {
    "commands": [
      { "command": "remoteClaude.openSetup", "title": "Remote Claude: Setup…" },
      { "command": "remoteClaude.newChat", "title": "Remote Claude: New Chat" },
      { "command": "remoteClaude.toggleLiveSync", "title": "Remote Claude: Toggle Live Sync" },
      { "command": "remoteClaude.viewOutput", "title": "Remote Claude: Show Output" }
    ],
    "viewsContainers": {
      "activitybar": [
        { "id": "remoteClaude", "title": "Remote Claude", "icon": "$(comment-discussion)" }
      ]
    },
    "views": {
      "remoteClaude": [
        { "type": "webview", "id": "remoteClaude.chatPanel", "name": "Chat" }
      ]
    }
}
```
→
```json
"contributes": {
    "commands": [
      { "command": "patchwire.openSetup", "title": "Patchwire: Setup…" },
      { "command": "patchwire.newChat", "title": "Patchwire: New Chat" },
      { "command": "patchwire.toggleLiveSync", "title": "Patchwire: Toggle Live Sync" },
      { "command": "patchwire.viewOutput", "title": "Patchwire: Show Output" }
    ],
    "viewsContainers": {
      "activitybar": [
        { "id": "patchwire", "title": "Patchwire", "icon": "$(comment-discussion)" }
      ]
    },
    "views": {
      "patchwire": [
        { "type": "webview", "id": "patchwire.chatPanel", "name": "Chat" }
      ]
    }
}
```

The trailing custom config key:

```json
"remoteClaude": {
    "minimumCliVersion": "0.2.0"
}
```
→
```json
"patchwire": {
    "minimumCliVersion": "0.2.0"
}
```

- [ ] **Step 2: Update command IDs in source**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
grep -rn "remoteClaude\." packages/extension/src
```

For each match, rewrite `remoteClaude.` → `patchwire.`. Common sites include:
- `vscode.commands.registerCommand('remoteClaude.openSetup', ...)` (and the other three commands) in `packages/extension/src/extension.ts` and/or `commands.ts`
- `vscode.commands.executeCommand('remoteClaude.X', ...)` if invoked internally
- The webview view ID string `'remoteClaude.chatPanel'` used in `registerWebviewViewProvider` or similar
- Any context-keys (`when: remoteClaude.activated` etc.)

If a match references `extensionContext.subscriptions` registration of a `remoteClaude.*` ID, the rewrite is the literal string only.

- [ ] **Step 3: Update CLI-binary references inside the extension**

The extension spawns the CLI binary by name in a few places:

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
grep -rn "'remote-claude'\|\"remote-claude\"" packages/extension/src
```

For each match where the literal string is the binary name being spawned (e.g., `cp.spawnSync('remote-claude', ['setup', ...])`), rewrite to `'patchwire'`. In `packages/extension/src/setup/SetupWizard.ts`:

```ts
const r = cp.spawnSync('remote-claude', ['setup', '--list-peers', '--json'], { encoding: 'utf8' });
```
→
```ts
const r = cp.spawnSync('patchwire', ['setup', '--list-peers', '--json'], { encoding: 'utf8' });
```

And in the same file, when `remote-claude init-remote` is spawned (around line 73 and the test referenced at line 75/106):

```ts
const r = cp.spawnSync('remote-claude', ['init-remote', ...], ...);
```
→
```ts
const r = cp.spawnSync('patchwire', ['init-remote', ...], ...);
```

Update `packages/extension/src/setup/SetupWizard.test.ts` mocks accordingly:

```ts
const call = spawnCalls.find((c) => c.cmd === 'remote-claude');
```
→
```ts
const call = spawnCalls.find((c) => c.cmd === 'patchwire');
```

The test description string `'spawns remote-claude init-remote --from-local --json with parsed inputs'` → `'spawns patchwire init-remote --from-local --json with parsed inputs'`.

- [ ] **Step 4: Update extension brand prose**

Replace `Remote Claude` → `Patchwire` and `remote-claude` → `patchwire` in:

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
grep -rln "Remote Claude\|remote-claude" packages/extension/src
```

For each file in the list (excluding ones already covered above), use Edit to change brand occurrences. Common spots:
- `packages/extension/src/chat/webview/index.html` — page title, headings
- `packages/extension/src/setup/webview/index.html` — wizard title, headings
- `packages/extension/src/chat/webview/main.ts` — empty-state text and similar
- `packages/extension/src/diff/DiffContentProvider.ts` — any error message
- `packages/extension/src/session/sessionTerminal.ts` — terminal banner

- [ ] **Step 5: Update extension README**

Replace every `Remote Claude` and `remote-claude` occurrence in `packages/extension/README.md` (the marketplace-published README). This includes screenshots/captions, install instructions, and links.

- [ ] **Step 6: Build the extension and verify**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm --filter patchwire-vscode build 2>&1 | tail -10
ls packages/extension/dist
```

Expected: build clean; `dist/extension.cjs`, `dist/webview/`, `dist/setup-webview/` all present. The bundled `dist/extension.cjs` will reference `patchwire.*` command IDs — verify with:

```bash
grep -c "patchwire\." packages/extension/dist/extension.cjs
grep -c "remoteClaude\." packages/extension/dist/extension.cjs
```

Expected: first count ≥ 4 (one per command + view); second count = 0.

- [ ] **Step 7: Run the extension smoke script**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm --filter patchwire-vscode smoke 2>&1 | tail -10
```

Expected: builds, typechecks, tests all pass; prints `OK`.

- [ ] **Step 8: Commit**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git add packages/extension
git commit -m "rebrand(extension): rename VS Code manifest IDs and UI strings

  displayName: Remote Claude → Patchwire
  publisher:   remote-claude → patchwire
  commands:    remoteClaude.* → patchwire.*
  view IDs:    remoteClaude / .chatPanel → patchwire / .chatPanel
  spawned CLI binary: 'remote-claude' → 'patchwire'
  brand prose in webviews and SetupWizard

The 'patchwire.minimumCliVersion' config key replaces the old
'remoteClaude.minimumCliVersion'."
```

---

## Task 7: Brand prose in root + READMEs + CHANGELOG

**Files:**
- Modify: `README.md` (root)
- Modify: `CHANGELOG.md`
- Modify: `CONTRIBUTING.md`
- Modify: `DEVELOPMENT.md`
- Modify: `packages/cli/README.md`

- [ ] **Step 1: Inventory root-level brand references**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
grep -n "Remote Claude\|remote-claude\|remote_claude" README.md CHANGELOG.md CONTRIBUTING.md DEVELOPMENT.md packages/cli/README.md
```

Lists every line to inspect.

- [ ] **Step 2: Update the root `README.md`**

The current `README.md` was rewritten for the monorepo earlier and lists packages. Apply these replacements:
- `Remote Claude — Monorepo` → `Patchwire — Monorepo`
- `Remote Claude` (anywhere else in prose) → `Patchwire`
- Table row package names: `remote-claude` → `patchwire`, `remote-claude-vscode` → `patchwire-vscode`, `remote-claude-docs` → `patchwire-docs`, `@remote-claude/protocol` → `@patchwire/protocol`
- Workspace command examples: `pnpm --filter remote-claude` → `pnpm --filter patchwire`, etc.
- Any URL references to `github.com/rebink/remote_claude` → `github.com/rebink/patchwire`

- [ ] **Step 3: Update `packages/cli/README.md`**

The CLI README (created during the monorepo restructure) is the published-to-npm README. Apply:
- Title `# remote-claude` → `# patchwire`
- `npm install -g remote-claude` → `npm install -g patchwire`
- Bin descriptions: `remote-claude` → `patchwire`, `remote-claude-agent` → `patchwire-agent`
- Quickstart commands: `remote-claude init-remote`, `remote-claude ask`, `remote-claude apply` → `patchwire init-remote`, `patchwire ask`, `patchwire apply`
- Domain `remote-claude.vercel.app` → `patchwire.vercel.app`

- [ ] **Step 4: Update `CHANGELOG.md`**

Update existing brand references (e.g., headings, prose). Then add a new entry at the top documenting the rename:

```markdown
## [Unreleased]

### Changed
- **BREAKING:** Rebranded from "Remote Claude" to "Patchwire". The
  product is the same; only identifiers changed. See the rebrand
  spec at `docs/specs/2026-05-31-rebrand-to-patchwire-design.md`
  for the full identifier mapping. Existing users must reinstall
  under the new package names and migrate `remote-claude.yml` →
  `patchwire.yml` and `~/.remote-claude/` → `~/.patchwire/`.
```

- [ ] **Step 5: Update `CONTRIBUTING.md` and `DEVELOPMENT.md`**

Apply brand replacements across both files. Common spots:
- Project-name mentions in intros
- Repo URL references
- Command examples (`remote-claude` binary, `remote-claude.yml` filename)
- `.remote-claude/` paths in descriptions

- [ ] **Step 6: Verify zero brand residue in these files**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
grep -n "Remote Claude\|remote-claude\|remote_claude\b" README.md CHANGELOG.md CONTRIBUTING.md DEVELOPMENT.md packages/cli/README.md
```

Expected: zero output. (Note `\b` word boundary on `remote_claude` so it doesn't catch unrelated text containing those characters.)

- [ ] **Step 7: Commit**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git add README.md CHANGELOG.md CONTRIBUTING.md DEVELOPMENT.md packages/cli/README.md
git commit -m "rebrand(docs): rename brand in root docs + CLI README

Rewrites brand mentions in the monorepo README, CHANGELOG (with a
new entry documenting the rebrand), CONTRIBUTING, DEVELOPMENT, and
the npm-published CLI README. Repo URLs point at the new path."
```

---

## Task 8: Website prose + config (landing page + Starlight docs)

**Files:**
- Modify: `packages/website/astro.config.mjs` (title, site URL, sidebar labels)
- Modify: `packages/website/src/pages/index.astro` (wordmark, title, footer, prose throughout the bicameral landing)
- Modify: every file under `packages/website/src/content/docs/*.md` and `*.mdx`

- [ ] **Step 1: Update `astro.config.mjs`**

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/website/astro.config.mjs`:

```js
const repo = 'https://github.com/rebink/remote_claude';
```
→
```js
const repo = 'https://github.com/rebink/patchwire';
```

```js
site: 'https://remote-claude.vercel.app',
```
→
```js
site: 'https://patchwire.vercel.app',
```

```js
title: 'Remote Claude',
description: 'Local-first dev tool: push your project to a remote Mac, run Claude Code there, and pull back a reviewable unified diff.',
```
→
```js
title: 'Patchwire',
description: 'Local-first dev tool: push your project to a remote Mac, run an AI CLI there, and pull back a reviewable unified diff.',
```

The Starlight `editLink.baseUrl` already references `${repo}` so updates automatically. The sidebar `label: 'Install the extension'` items and section headings don't mention the brand and don't need changes.

- [ ] **Step 2: Update the landing `index.astro` page**

In `/Users/apple/Documents/Workspace/dev_sync_cli/packages/website/src/pages/index.astro`:

- `<title>Remote Claude — local stays local, AI stays remote</title>` → `<title>Patchwire — local stays local, AI stays remote</title>`
- `<meta property="og:title" content="Remote Claude" />` → `<meta property="og:title" content="Patchwire" />`
- Wordmark text `<span>Remote Claude</span>` (appears twice — top bar and footer) → `<span>Patchwire</span>`
- `aria-label="Remote Claude home"` → `aria-label="Patchwire home"`
- `aria-label="Remote Claude logo"` (in the SVG) → `aria-label="Patchwire logo"`
- The footer blurb: any "Remote Claude" mentions → "Patchwire"
- The terminal-block snippet contents that show `remote-claude ask "..."` → `patchwire ask "..."`
- The §02 "Three commands per side" terminal cards: rewrite each `remote-claude` and `remote-claude-agent` reference to `patchwire` / `patchwire-agent`; the npm install `github:rebink/remote_claude` → `github:rebink/patchwire`
- The §03 "shape" diagram preformatted text: any `remote-claude` references → `patchwire`
- Footer copy `© {year} Remote Claude` → `© {year} Patchwire`

Run a final grep on the page to confirm:

```bash
grep -n "Remote Claude\|remote-claude\|remote_claude" /Users/apple/Documents/Workspace/dev_sync_cli/packages/website/src/pages/index.astro
```

Expected: zero matches.

- [ ] **Step 3: Update every doc page under `packages/website/src/content/docs/`**

List the doc files:

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
ls packages/website/src/content/docs/
```

Expected files: `agent.md`, `api.md`, `architecture.md`, `commands.md`, `configuration.md`, `faq.md`, `install-extension.md`, `introduction.md`, `networking.md`, `quickstart.md`, `roadmap.md`, `security.md`, `troubleshooting.md`, `why.md`.

For each file, apply the following replacements:
- `Remote Claude` → `Patchwire`
- `remote-claude` (the CLI binary or package name) → `patchwire`
- `remote-claude-agent` → `patchwire-agent`
- `remote-claude.yml` → `patchwire.yml`
- `~/.remote-claude/` and `.remote-claude/` → `~/.patchwire/` and `.patchwire/`
- `RC_TOKEN`, `RC_AGENT_TOKEN`, `RC_VERBOSE`, `RC_E2E` → `PW_TOKEN`, `PW_AGENT_TOKEN`, `PW_VERBOSE`, `PW_E2E`
- `RC_CLAUDE_BIN` → `PW_AI_BIN`
- `RC_CLAUDE_ARGS` → `PW_AI_ARGS`
- `github.com/rebink/remote_claude` → `github.com/rebink/patchwire`

**Important:** the docs *may* legitimately use the word "Claude" when describing the *AI tool being run* (e.g., "the agent spawns Claude with --print"). Do NOT bulk-replace `claude` with anything else — that would clobber legitimate Claude references. The replacements above are case- and word-boundary-precise.

If you use sed, the safe form is per-file per-pattern. Example for one file:

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
sed -i.bak \
  -e 's/Remote Claude/Patchwire/g' \
  -e 's/remote-claude-agent/patchwire-agent/g' \
  -e 's/remote-claude\.yml/patchwire.yml/g' \
  -e 's/\.remote-claude/.patchwire/g' \
  -e 's/\bremote-claude\b/patchwire/g' \
  -e 's/RC_CLAUDE_BIN/PW_AI_BIN/g' \
  -e 's/RC_CLAUDE_ARGS/PW_AI_ARGS/g' \
  -e 's/\bRC_TOKEN\b/PW_TOKEN/g' \
  -e 's/\bRC_AGENT_TOKEN\b/PW_AGENT_TOKEN/g' \
  -e 's/\bRC_VERBOSE\b/PW_VERBOSE/g' \
  -e 's/\bRC_E2E\b/PW_E2E/g' \
  -e 's|rebink/remote_claude|rebink/patchwire|g' \
  packages/website/src/content/docs/agent.md
rm packages/website/src/content/docs/agent.md.bak
```

Repeat for each of the 14 doc files, OR use a loop:

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
for f in packages/website/src/content/docs/*.md packages/website/src/content/docs/*.mdx; do
  [ -f "$f" ] || continue
  sed -i.bak \
    -e 's/Remote Claude/Patchwire/g' \
    -e 's/remote-claude-agent/patchwire-agent/g' \
    -e 's/remote-claude\.yml/patchwire.yml/g' \
    -e 's/\.remote-claude/.patchwire/g' \
    -e 's/\bremote-claude\b/patchwire/g' \
    -e 's/RC_CLAUDE_BIN/PW_AI_BIN/g' \
    -e 's/RC_CLAUDE_ARGS/PW_AI_ARGS/g' \
    -e 's/\bRC_TOKEN\b/PW_TOKEN/g' \
    -e 's/\bRC_AGENT_TOKEN\b/PW_AGENT_TOKEN/g' \
    -e 's/\bRC_VERBOSE\b/PW_VERBOSE/g' \
    -e 's/\bRC_E2E\b/PW_E2E/g' \
    -e 's|rebink/remote_claude|rebink/patchwire|g' \
    "$f"
  rm "$f.bak"
done
```

- [ ] **Step 4: Spot-check a few docs**

Open `quickstart.md`, `architecture.md`, and `configuration.md` and skim them to confirm:
- No "Remote Claude" / "remote-claude" / "RC_" / "remote_claude" remain
- The prose still reads naturally (the sed didn't break any sentence)
- Code blocks still show valid commands

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
grep -n "Remote Claude\|remote-claude\|remote_claude\|RC_[A-Z]" packages/website/src/content/docs/*.md packages/website/src/content/docs/*.mdx
```

Expected: zero output.

- [ ] **Step 5: Build the website**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm --filter patchwire-docs build 2>&1 | tail -10
```

Expected: Astro reports a clean build; 16 page(s) built. `packages/website/dist/index.html` produced.

- [ ] **Step 6: Commit**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git add packages/website
git commit -m "rebrand(website): rename brand on landing page + every docs page

  astro.config.mjs title/description/site URL
  src/pages/index.astro: wordmark, page title, OG meta, footer,
    terminal-snippet contents (patchwire ask …, patchwire setup, etc.)
  every src/content/docs/*.md{,x}: brand prose, CLI commands, config
    filename, state-dir paths, env-var names, repo URL

The example AI tool stays Claude in the docs (most users will run
Claude); only the BRAND decouples."
```

---

## Task 9: Final cross-package verification

**Files:** none modified — verification only.

- [ ] **Step 1: Workspace-wide grep for residual brand references**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
grep -rni "remote.\?claude" packages docs README.md DEVELOPMENT.md CONTRIBUTING.md CHANGELOG.md \
  | grep -v "docs/specs/2026-.*-design.md" \
  | grep -v "docs/plans/2026-.*\.md"
```

Expected: zero output. The historical specs/plans (2026-04-* through 2026-05-31-monorepo-restructure-*) are intentionally excluded because they are historical records.

- [ ] **Step 2: Workspace-wide grep for residual `RC_*` env vars**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
grep -rn "\bRC_[A-Z_]\+" packages --include="*.ts" --include="*.json" --include="*.yml" --include="*.md" --include="*.mjs" --include="*.astro"
```

Expected: zero output.

- [ ] **Step 3: Workspace-wide grep for residual `claudeRunner` / `findClaude` / `makeClaudeRunner`**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
grep -rn "claudeRunner\|findClaude\|makeClaudeRunner\|probeClaudeVersion\|claudeCommand\|claudeArgs" packages --include="*.ts" --include="*.tsx"
```

Expected: zero output.

- [ ] **Step 4: Workspace-wide typecheck + test + build**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm -r typecheck
pnpm -r test 2>&1 | tail -15
pnpm -r build 2>&1 | tail -10
```

Expected: typecheck clean across all four packages; every package's tests pass (with at most the one known pre-existing CLI test `returns 412 when project is not a git repo` if test ordering surfaces it); build produces `packages/cli/dist/{cli.js,agent.js}`, `packages/extension/dist/{extension.cjs,webview/,setup-webview/}`, `packages/website/dist/index.html`.

- [ ] **Step 5: Extension smoke**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm --filter patchwire-vscode smoke 2>&1 | tail -10
```

Expected: builds, typechecks, tests pass; script prints `OK`.

- [ ] **Step 6: Verify the website renders the new brand**

If the dev server is not already running, start it:

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
pnpm --filter patchwire-docs dev &
sleep 4
```

Browse `http://localhost:4321/` and confirm:
- `<title>` reads "Patchwire — local stays local, AI stays remote"
- Top-bar wordmark reads "Patchwire"
- Hero terminal-snippet contents say `patchwire ask "…"` and `patchwire-agent` (no `remote-claude`)
- §02 cards say `patchwire setup`, `patchwire-agent install`, etc.
- Footer says "© 2026 Patchwire"

Browse `http://localhost:4321/quickstart/` and confirm the docs page uses the new brand consistently.

Stop the dev server (kill the backgrounded process).

- [ ] **Step 7: Confirm working tree is clean**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git status --short
```

Expected: empty.

- [ ] **Step 8: Confirm the commit chain**

```bash
cd /Users/apple/Documents/Workspace/dev_sync_cli
git log --oneline bf11baa..HEAD
```

Expected: exactly 8 commits — one per Tasks 1–8. Task 9 (this one) makes no commit.

No final commit is needed for this task — it's verification only.

---

## Post-Plan Out-of-Band Steps

These actions are not part of the codebase changes; they happen on external platforms and are the user's responsibility:

1. **Rename the GitHub repo:** `gh repo rename patchwire` (run from `/Users/apple/Documents/Workspace/dev_sync_cli`). GitHub auto-redirects from the old URL.
2. **Rename the Vercel project:** Vercel dashboard → Project → Settings → General → Project Name → "patchwire". The deployment URL becomes `patchwire.vercel.app`.
3. **Reserve the npm names:** `npm view patchwire` (verify availability) → `npm publish` when ready for the new versioned release. Similarly for `patchwire-vscode`, `patchwire-docs`, and the `@patchwire` scope.

If any of the above are unavailable, the spec needs revisiting — flag back to the brainstorming phase. (As of 2026-05-31, the names were judged unlikely to conflict, but the verification is the user's to perform.)
