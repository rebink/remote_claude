# Rebrand to Patchwire — Design Spec

**Date:** 2026-05-31
**Status:** Approved (design phase)
**Scope:** Rename the project from "Remote Claude" to "Patchwire" across every external and internal surface — packages, binaries, config file, state dir, env vars, source identifiers, website prose, and documentation. Clean break, no backward-compatibility shims (we are at v0.1.0 with no published userbase).

---

## 1. Motivation

"Remote Claude" couples the brand to one AI provider. Reading the agent code, the AI tool is **already pluggable** — `remote-claude.yml` exposes `ai.command` and `ai.args`, and `RC_CLAUDE_BIN` / `RC_CLAUDE_ARGS` env vars override the defaults. The product runs any CLI that takes a prompt on stdin and edits files in a git checkout: Claude CLI, Codex CLI, aider, Gemini CLI, a custom script. The brand should reflect that architectural truth.

The new name, **Patchwire**, expresses the actual product insight: a *patch* (the unified diff that comes back) crosses a *wire* (Tailscale + HTTP) between local and remote. It is on-brand with the bicameral website that just shipped (the wire is already the dominant visual motif). It is a coined word — googleable, npm-likely-free, and not constrained to one AI vendor.

## 2. Non-Goals

- **No backward-compatibility shims.** No reading both `remote-claude.yml` and `patchwire.yml`. No aliasing `remote-claude` binary to `patchwire`. No deprecation warnings on old env vars. Clean break.
- **No runtime behavior changes.** Every command, every API endpoint, every wire-format event keeps its semantics. Only identifiers move.
- **No dependency upgrades.** Lockfile churn limited to package name changes inside the workspace.
- **No changes to the AI tool example.** The default `ai.command` stays `claude` (with `--print`). The brand is AI-agnostic; the *example AI* in docs stays Claude because that is what most users will run.
- **No git repository rename.** Whether to rename `github.com/rebink/remote_claude` → `github.com/rebink/patchwire` is left to the user as a separate one-command operation (`gh repo rename`). The spec links update assuming the new URL but the change itself is out of scope.

## 3. Naming Conventions

The rebrand uses three forms consistently:

| Form | Use |
|---|---|
| `Patchwire` | Brand name in prose, page titles, README headers, log banners |
| `patchwire` | npm package name, binary name, config file basename, state directory, slug in URLs |
| `PW_` | Environment variable prefix (replacing `RC_`) |
| `@patchwire` | npm scope for internal workspace packages |

## 4. Complete Identifier Mapping

### 4.1 npm package names

| Old | New | File |
|---|---|---|
| `remote-claude` | `patchwire` | `packages/cli/package.json` |
| `remote-claude-vscode` | `patchwire-vscode` | `packages/extension/package.json` |
| `remote-claude-docs` | `patchwire-docs` | `packages/website/package.json` |
| `@remote-claude/protocol` | `@patchwire/protocol` | `packages/protocol/package.json` |
| `remote-claude-monorepo` | `patchwire-monorepo` | root `package.json` |

Workspace dep references inside `packages/cli/package.json` and `packages/extension/package.json` update from `"@remote-claude/protocol": "workspace:*"` to `"@patchwire/protocol": "workspace:*"`.

`pnpm` workspace scripts in root `package.json` update:
- `pnpm cli` filter target: `remote-claude` → `patchwire`
- `pnpm extension` filter target: `remote-claude-vscode` → `patchwire-vscode`
- `pnpm website` filter target: `remote-claude-docs` → `patchwire-docs`

### 4.2 Binary names

In `packages/cli/package.json` `"bin"` block:

| Old | New |
|---|---|
| `remote-claude` → `./dist/cli.js` | `patchwire` → `./dist/cli.js` |
| `remote-claude-agent` → `./dist/agent.js` | `patchwire-agent` → `./dist/agent.js` |

The source files `packages/cli/src/cli.ts` and `packages/cli/src/agent.ts` keep their names — the *binary* is what the user types.

### 4.3 Config file

| Old | New |
|---|---|
| `remote-claude.yml` (in user project root) | `patchwire.yml` |

All readers/writers update: `packages/cli/src/lib/config.ts`, `packages/extension/src/extension.ts`, `packages/extension/src/chat/ChatPanel.ts`, `packages/extension/src/setup/SetupWizard.ts`, `packages/extension/src/chat/webview/main.ts`, and any test fixtures.

The file at the repo root `remote-claude.yml` (used for dogfooding this very project) renames to `patchwire.yml`.

### 4.4 State directory

| Old | New |
|---|---|
| `~/.remote-claude/` | `~/.patchwire/` |
| `~/.remote-claude/keys/<host>-<user>` | `~/.patchwire/keys/<host>-<user>` |
| `~/.remote-claude/env` | `~/.patchwire/env` |
| `~/.remote-claude/agent-sessions.json` | `~/.patchwire/agent-sessions.json` |
| `~/.remote-claude/logs/` | `~/.patchwire/logs/` (referenced in old README) |
| `.remote-claude/last.patch` (in project root) | `.patchwire/last.patch` |
| `.remote-claude/sessions/` | `.patchwire/sessions/` |
| `.remote-claude/pull-*.patch` | `.patchwire/pull-*.patch` |

`.gitignore` entries update: `.remote-claude/` → `.patchwire/`. `MutagenController` sync-exclude list updates.

### 4.5 Environment variables

| Old | New |
|---|---|
| `RC_TOKEN` | `PW_TOKEN` |
| `RC_AGENT_TOKEN` | `PW_AGENT_TOKEN` |
| `RC_CLAUDE_BIN` | `PW_AI_BIN` |
| `RC_CLAUDE_ARGS` | `PW_AI_ARGS` |
| `RC_VERBOSE` | `PW_VERBOSE` |
| `RC_E2E` | `PW_E2E` |

Note `RC_CLAUDE_*` → `PW_AI_*` — drops the `CLAUDE` token from the env-var name, since the architecture is AI-agnostic and a user configuring `command: codex` should not see a `_CLAUDE_` env var.

### 4.6 Source identifiers (CLI/agent)

In `packages/cli/src/agent/claude.ts` (the file holding the AI runner):

| Old | New |
|---|---|
| `findClaude(command)` | `findAiBin(command)` |
| `probeClaudeVersion(commandPath)` | `probeAiVersion(commandPath)` |
| `makeClaudeRunner(opts)` | `makeAiRunner(opts)` |
| `claudeRunner` (exported instance) | `aiRunner` |
| `claudeCommand` field on `AgentOptions` | `aiCommand` |
| `claudeArgs` field on `AgentOptions` | `aiArgs` |

File rename: `packages/cli/src/agent/claude.ts` → `packages/cli/src/agent/ai-runner.ts`. All imports update.

Inline error messages such as `"claude exited X"` rewrite to `"AI command exited X (bin=${binPath})"` — the dynamic binary path conveys what actually ran, useful when the user configured a non-Claude tool.

Variable / log strings containing the literal `"remote-claude"` or `"Remote Claude"` in non-prose contexts (e.g., log banners, JSON keys) update to `"patchwire"` / `"Patchwire"`.

### 4.7 Documentation prose

Every occurrence of the brand `Remote Claude` becomes `Patchwire`. Every occurrence of the slug `remote-claude` (in user-facing prose, not as part of an unrelated word) becomes `patchwire`.

Surfaces affected:
- Root `README.md`
- `CHANGELOG.md`, `CONTRIBUTING.md`, `DEVELOPMENT.md`
- `packages/cli/README.md`
- `packages/extension/README.md`
- `packages/website/src/pages/index.astro` (the new bicameral landing — wordmark + footer)
- `packages/website/src/content/docs/*.md` and `*.mdx` (every doc page)
- `packages/website/astro.config.mjs` — `title: 'Remote Claude'` → `title: 'Patchwire'`, `site: 'https://remote-claude.vercel.app'` → `site: 'https://patchwire.vercel.app'`
- Page title in `index.astro`: `<title>Remote Claude — …</title>` → `<title>Patchwire — …</title>`
- VS Code extension `displayName`: `Remote Claude` → `Patchwire`
- VS Code extension command titles: `Remote Claude: Setup…` → `Patchwire: Setup…`, etc.
- VS Code extension `viewsContainers` title: `Remote Claude` → `Patchwire`
- The `remoteClaude.*` command IDs (`remoteClaude.openSetup`, `remoteClaude.newChat`, `remoteClaude.toggleLiveSync`, `remoteClaude.viewOutput`) rename to `patchwire.*`. Every internal `registerCommand` call updates to match.
- The `remoteClaude` viewsContainer `id` and `remoteClaude.chatPanel` view `id` rename to `patchwire` and `patchwire.chatPanel`.

### 4.8 Website domain, VS Code publisher, repo URL

| Old | New |
|---|---|
| `site: https://remote-claude.vercel.app` in `astro.config.mjs` | `site: https://patchwire.vercel.app` |
| `publisher: remote-claude` in `packages/extension/package.json` | `publisher: patchwire` |
| Repo URL in `repository.url`, `homepage`, `bugs.url` across all `package.json` files: `github.com/rebink/remote_claude` | `github.com/rebink/patchwire` |
| Edit-link `baseUrl` in `astro.config.mjs`: `${repo}/edit/main/packages/website/` | unchanged in structure, but resolves to the new repo URL automatically once `gh repo rename` runs |

The codebase changes the repo URL strings to the new path **regardless of when `gh repo rename` runs**, because GitHub auto-redirects from the old URL to the new one for the lifetime of the redirect (effectively permanent unless explicitly broken). So updating the URLs immediately is safe.

The Vercel project itself must be renamed in the Vercel dashboard — that yields the new `patchwire.vercel.app` domain. **This is a one-click operation outside the codebase.** The `site:` URL in `astro.config.mjs` updates atomically with the rename PR; if the Vercel rename hasn't happened yet at deploy time, the build still succeeds (the `site` field only affects absolute URL generation in the sitemap), but the deployed site will still answer on the old domain until the dashboard rename. Coordinate the two changes within an hour of each other to avoid sitemap drift.

### 4.9 Sync-exclude list

`packages/extension/src/sync/MutagenController.ts:41` excludes `.remote-claude` from sync — update to `.patchwire`.

## 5. Mechanical vs. Judgment Edits

Most of this rename is mechanical search-and-replace:

- `Remote Claude` → `Patchwire` (case-sensitive, brand-form only)
- `remote-claude` → `patchwire` (case-sensitive, slug)
- `remote_claude` → `patchwire` (in repo URL paths)
- `RC_` → `PW_` (env-var prefix, with the `_CLAUDE_` → `_AI_` substitution for the two AI-bin vars)
- `\.remote-claude\b` → `.patchwire` (regex, word-boundary-aware to avoid clobbering substrings)
- `remoteClaude\.` → `patchwire.` (VS Code command IDs and view IDs)

**Judgment edits** that require human review:

1. **Error messages** referencing `"claude"`: these must read as describing the *configured AI tool*, not the brand. The rewrite is: "claude exited X" → "AI command exited X (bin=…)".
2. **Doc prose** discussing the AI tool by name vs. discussing the product: keep Claude where the doc is *demonstrating Claude usage* (e.g., "install Claude CLI on the remote Mac"), and use Patchwire only as the product name. Do NOT bulk-replace `claude` with `your AI` — that would clobber legitimate Claude references.
3. **The `claude.ts` file rename:** the file is being renamed to `ai-runner.ts` to match its new identifiers. Imports across the agent layer update accordingly.
4. **CHANGELOG entry:** add a new line documenting the rebrand.

## 6. Sync-Exclude + Lockfile Considerations

- After all package.json renames, run `pnpm install` once to refresh the lockfile.
- The `pnpm-lock.yaml` will contain large diffs because workspace package names change everywhere they appear as resolution entries.
- The CLAUDE.md and similar files in `~/.claude/` and `.claude/` directories on the user's machine are **out of scope** — those are user-private and unrelated.

## 7. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Missed brand reference in some doc page | After the rename, a single `grep -rni "remote.\?claude" packages docs README.md DEVELOPMENT.md CONTRIBUTING.md CHANGELOG.md` should return zero matches outside of historical specs/plans. The verification task explicitly runs this. |
| Existing dogfood install (this repo, running against itself) breaks | Acceptable — re-run `pnpm install -g` on the new package name on both laptop and remote. The current state.json at `~/.remote-claude/state.json` is a 22-byte file, can be moved manually. Doc note added. |
| VS Code extension command-ID change orphans any in-flight keybindings | Acceptable — no published extension yet. The keybindings.json the user maintains is regenerated on extension reinstall. |
| Vercel project rename + DNS propagation gap | Vercel project rename is instant on the platform side. The codebase change to `site:` URL is the only software dependency; old URL keeps resolving for ~24h via Vercel's redirect. |
| Historical specs/plans in `docs/specs/` and `docs/plans/` reference `Remote Claude` | Leave those alone — they are historical records of the previous brand. Optionally add a single header note "Originally written as 'Remote Claude'." to the older docs, but the spec does not require it. |

## 8. Verification

After the rename is implemented:

```bash
# No old slug remains in tracked source / docs:
grep -rni "remote.\?claude" packages docs README.md DEVELOPMENT.md CONTRIBUTING.md CHANGELOG.md \
  | grep -v "docs/specs/2026-.*-design.md" \
  | grep -v "docs/plans/2026-.*\.md"
# Expected: zero output (historical specs/plans excluded).

# No old env-var prefix remains:
grep -rn "RC_[A-Z_]\+" packages --include="*.ts" --include="*.json" --include="*.yml" --include="*.md"
# Expected: zero output.

# Workspace builds and tests still pass:
pnpm install
pnpm -r typecheck
pnpm -r test
pnpm -r build
pnpm --filter patchwire-vscode smoke

# CLI binaries are installed under the new names:
ls packages/cli/dist
# Expected: cli.js, agent.js still as filenames; package.json "bin" entries map them to `patchwire` and `patchwire-agent`.
```

The website is verified by running `pnpm --filter patchwire-docs dev`, browsing the landing + docs, and confirming the wordmark, `<title>`, and footer all read "Patchwire" (and nothing reads "Remote Claude" outside the historical specs).

## 9. Out of Scope (Explicit)

- The actual rename of the GitHub repository (`gh repo rename`).
- The actual rename of the Vercel project in the dashboard.
- Reserving the `patchwire` npm package name and the `@patchwire` scope (npm `publish` is not part of this spec's verification).
- Any social-media or external-marketing surfaces.
- Rewriting historical specs/plans under `docs/specs/2026-04-*` through `docs/specs/2026-05-31-monorepo-restructure-design.md` — those are historical records and stay as-is.

The implementation plan that follows will sequence the rename so each commit lands in a verifiable state (typecheck/test/build green between commits where possible).
