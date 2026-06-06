# Changelog

All notable changes to **Patchwire** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
