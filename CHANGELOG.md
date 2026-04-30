# Changelog

All notable changes to **Remote Claude** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-04-30

### Added
- CLI (`remote-claude`) with `init`, `sync`, `ask`, `apply`, `doctor` commands.
- Agent (`remote-claude-agent`) Fastify HTTP server with `/health` and `/ask`.
- Diff strategy: agent runs `claude --print` on a clean git checkout, captures
  `git diff --cached` (including new files via `git add -A`), then resets the
  working tree.
- Local apply flow: colorized unified-diff preview, `git apply --check` gate,
  full or per-file selective apply, save-to-patch fallback.
- Bearer-token authentication (constant-time compare) plus SSH-key-based rsync.
- Project-name allowlist (`[a-zA-Z0-9_.-]+`) to prevent path traversal.
- Vitest test suite (15 tests) — unit tests for diff parsing and config loading,
  end-to-end agent tests via Fastify `inject` and a fake `claude` shell script.
- Installable directly from GitHub via `pnpm add -g github:rebink/remote_claude`
  (build runs in the `prepare` lifecycle).

[Unreleased]: https://github.com/rebink/remote_claude/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/rebink/remote_claude/releases/tag/v0.1.0
