# Changelog

All notable changes to **Patchwire** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.14] — 2026-06-10

### Fixed
- **Setup "Install key" failed silently on a fresh machine.** When `sshpass` was not
  available (it is neither bundled in the extension nor installed by default on macOS),
  the CLI `setup --password-stdin` threw an uncaught error and produced no output, so
  the wizard showed "check the output channel for details" while nothing was logged
  there. The CLI now catches that case and emits a structured `sshpass_missing` result
  with install instructions, and the wizard logs the CLI's stdout / stderr / exit code
  and surfaces the real message instead of a detail-less "unknown".

## [0.3.13] — 2026-06-10

### Fixed
- **Extension failed to activate on a clean install ("Cannot find module 'yaml'").**
  The host bundle externalized the `yaml` dependency, but the `.vsix` ships no
  `node_modules`, so `require('yaml')` threw at load time and every command became
  "not found". This was the real cause behind the activation failures (it happened
  to work only where `yaml` was resolvable up the `node_modules` chain). tsup now
  inlines `yaml`, and a new build guard (`scripts/check-bundle.mjs`) fails the build
  if any dependency is left externalized, so this class of bug can't ship again.

## [0.3.12] — 2026-06-10

### Fixed
- **"command 'patchwire.openSetup' not found" on a fresh install.** When VS Code
  started with no folder open, `activate()` returned before registering any
  commands, and never recovered when a folder was opened later, so every Patchwire
  command was missing. Commands and the panel are now registered unconditionally,
  the panel tolerates having no workspace yet, and opening a folder (re)initializes
  the session. Running Setup with no folder now shows a clear "open a folder first"
  message instead of an error.

## [0.3.11] — 2026-06-09

### Added
- **Re-insert a staged attachment into the session.** Each row in the panel's
  Attachments list now has an add button (➕) that types that file's remote path
  into the active Claude session terminal, so you can reference an already-synced
  file again without re-attaching it. Falls back to copying the path if no session
  is open.

## [0.3.10] — 2026-06-09

### Fixed
- **Activity-bar icon reads at small sizes.** The 0.3.8 icon used thin strokes and a
  dashed wire that disappeared at the ~16px activity-bar size (VS Code renders it as a
  flat monochrome silhouette). Redrawn with bold solid shapes: outline square, solid
  connector and signal dot, filled square.

## [0.3.9] — 2026-06-09

### Changed
- **Accurate extension listing.** The Marketplace description and README described the
  old chat-and-diff model and claimed the CLI was not bundled. They now describe the
  real product: a Claude Code session on a machine you own, kept in two-way sync with
  your editor, with the CLI bundled in the extension. Keywords updated to match.

## [0.3.8] — 2026-06-09

### Fixed
- **Extension activity-bar icon is now the Patchwire mark.** The sidebar entry used
  a generic built-in icon; it now uses the Patchwire logo as a themed monochrome SVG.

## [0.3.7] — 2026-06-09

### Added
- **Manage staged attachments from the panel.** The Patchwire side panel now lists
  every file staged in `.patchwire-inbox/`, with a per-file view (opens the local
  copy; images preview in VS Code) and delete (removes it locally and, through
  two-way sync, from the remote). The list refreshes automatically as you attach,
  delete, or sync. Extension only; the CLI and the inbox format are unchanged.

## [0.3.6] — 2026-06-09

### Fixed
- **The published CLI is now installable.** `@rebink/patchwire` declared a runtime
  dependency on the private, unpublished `@patchwire/protocol@0.0.0`, so
  `npm i -g @rebink/patchwire` failed with `E404` (every prior release was
  uninstallable from npm; only the extension worked, because it re-bundles the
  CLI). The protocol package is now bundled into the CLI build (`tsup`
  `noExternal`) and dropped from runtime `dependencies`. Verified with a clean
  tarball install. (No API changes — same 0.3.5 features.)

## [0.3.5] — 2026-06-09

Default-deny egress on the remote (M3) and local file attachments for the remote
Claude.

### Added — Local file attachments
- **`patchwire push <file>`** — copy a local file to the remote so an interactive
  SSH `claude` session can read it. Stages into a gitignored `.patchwire-inbox/`
  and rsyncs it to the remote; prints the remote path to paste. Flags:
  `--clip` (push the clipboard image / screenshot), `--clean` (clear the inbox),
  `--stage-only` (skip rsync; for callers whose sync carries it), `--json`.
- **VS Code "📎 Attach file" / "Attach clipboard image"** — stages the file into
  the synced project, flushes Mutagen, and types the remote path into the active
  `claude` session terminal (clipboard fallback if no session is open). Works for
  any file Claude reads by path, including images for vision. The inbox is
  gitignored, so attachments never appear in a returned diff.

### Added — Default-deny egress (macOS, opt-in)
- **`PW_EGRESS=deny`** runs `claude` under a macOS seatbelt (`sandbox-exec`)
  profile that blocks all outbound network except localhost, DNS, and the
  resolved allowlist (Anthropic API by default; add hosts with
  `PW_EGRESS_ALLOW`). Default `off` leaves the spawn unchanged.
  - IP-literal allowlist only (no hostname-suffix matching — that's the footgun
    behind Claude Code's SOCKS5 null-byte bypass). `PW_EGRESS_ALLOW_DNS=0` for
    the tightest posture.
  - **Fail-closed:** with `deny` set and `sandbox-exec` missing, the agent
    refuses to start rather than run unconfined.
- **`patchwire-agent egress-check`** — verifies on the box that the allowlist is
  reachable and non-allowlisted hosts are blocked.

### Notes
- Egress is macOS only and **opt-in** (off by default). In-repo tests cover
  profile generation, allowlist merge, the sandbox-exec wrapper, and fail-closed
  logic; **kernel enforcement must be verified per-box with `egress-check`**
  before enabling it.

## [0.3.4] — 2026-06-08

Cost & token visibility in `patchwire-agent usage` (M6 steps 2–5).

### Added
- **`TOK` and `$EQV` columns in `usage`.** Per-user token totals and dollar cost.
  Cost is **opt-in**: set a JSON output format (e.g. `PW_AI_ARGS="--print
  --output-format json"`) so the provider reports usage; the default `--print`
  is unchanged (columns read `—`).
- **Tariff strategy.** Prefer the provider's own reported cost (Claude
  `total_cost_usd`, Aider `Cost:`) — no price list to maintain. Optional operator
  `~/.patchwire/pricing.yml` (`PW_PRICING_FILE`) estimates cost for token-only
  providers; estimated rows show as `~$…`. `$EQV` is API-equivalent cost — with a
  flat-rate subscription it's attribution across the team, not a second bill
  (stated in a footnote under the table).
- The `/ask` audit entry now records `model`, `tokens_in`, `tokens_out`,
  `cost_usd`, and `cost_source` (all optional; old log lines still parse).

### Changed
- When a JSON output format is configured, the agent unwraps the assistant text
  for display so you never see raw JSON.

## [0.3.3] — 2026-06-07

Research-driven reliability + security improvements (M1, M2, M4) and the
foundation for cost tracking (M6 step 1).

### Added
- **Reliable 3-way apply (M1).** `patchwire apply` now detects when the local
  tree drifted since sync and offers a 3-way merge that absorbs non-overlapping
  edits automatically, inserting conflict markers only where local and AI edits
  overlap — instead of failing outright. (`detectDrift`, `gitApply3way`.)
- **Test-before-return (M2).** The agent can run an operator-configured verify
  command (`PW_VERIFY_CMD`, e.g. `flutter analyze`) on the checkout after the
  diff is captured, returning a `verify` result so you review a diff that already
  passed validation. New `verifying` NDJSON event; verify informs, never blocks.
- **Pre-sync secret scan (M4).** `sync.secretScan: off|warn|block` runs gitleaks
  over the about-to-sync files before they cross the wire, closing the hole where
  a secret in a *tracked* file would otherwise sync. New `--force` flag on
  `sync`/`ask`.

### Fixed
- **Real token counts (M6 step 1).** The chat path reported `tokensOut =
  output.length` (a character count) and `tokensIn = 0`. `parseAiUsage` now
  extracts real provider-reported usage (Claude JSON/stream-json, Aider text).
  No user-visible change yet — the `usage` table has no token/cost column — but
  the underlying audit data is now correct.

## [0.3.2] — 2026-06-06

Backward-compatible config migration: the CLI now maps pre-rebrand `RC_*` env
vars to their `PW_*` equivalents when the `PW_*` form is unset (notably
`RC_TOKEN` → `PW_TOKEN`). Upgrades from "Remote Claude" no longer fail
`patchwire.yml` validation ("Environment variable PW_TOKEN is not set") just
because `~/.patchwire/env` still uses the old variable name.

## [0.3.1] — 2026-06-06

Extension now bundles the CLI and runs it via VS Code's Node — installs and works with no separate CLI install or PATH setup (fixes `spawn patchwire ENOENT`). Adds `patchwire.cliPath` override setting for custom installs.

## [0.3.0] — 2026-06-03

### Added
- `patchwire-agent usage` — per-user activity summary (requests, accepted, lines changed, duration) from the audit log.
- Per-user policy enforcement — project allowlist and rate limit, configured via `patchwire-agent user policy …`, enforced on `/ask` and `/chat`.

### Changed
- **BREAKING:** Rebranded from "Remote Claude" to "Patchwire". The product is the
  same; only identifiers changed. Existing users must reinstall under the new
  package names and migrate `remote-claude.yml` → `patchwire.yml` and
  `~/.remote-claude/` → `~/.patchwire/`. The launchd service label changed from
  `com.remote-claude.agent` to `com.patchwire.agent`.

### Security
- The `patchwire-agent install` (launchd) default host is now `127.0.0.1` instead
  of `0.0.0.0` — network reachability must be opted into via `--host`/`PW_AGENT_HOST`.
- `/health` no longer discloses the AI binary's absolute path.
- `/ask` and `/chat` 404 responses no longer disclose server-side project paths.
- The launchd plist is now written with `0600` permissions.

## [0.1.0] — 2026-04-30

### Added
- CLI (`patchwire`) with `init`, `sync`, `ask`, `apply`, `doctor` commands.
- Agent (`patchwire-agent`) Fastify HTTP server with `/health` and `/ask`.
- Diff strategy: agent runs `claude --print` on a clean git checkout, captures
  `git diff --cached` (including new files via `git add -A`), then resets the
  working tree.
- Local apply flow: colorized unified-diff preview, `git apply --check` gate,
  full or per-file selective apply, save-to-patch fallback.
- Bearer-token authentication (constant-time compare) plus SSH-key-based rsync.
- Project-name allowlist (`[a-zA-Z0-9_.-]+`) to prevent path traversal.
- Vitest test suite (15 tests) — unit tests for diff parsing and config loading,
  end-to-end agent tests via Fastify `inject` and a fake `claude` shell script.
- Installable directly from GitHub via `pnpm add -g github:rebink/patchwire`
  (build runs in the `prepare` lifecycle).

[Unreleased]: https://github.com/rebink/patchwire/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/rebink/patchwire/releases/tag/v0.1.0
