# Patchwire v0.3.0

Shared AI infrastructure for engineering teams — run any coding agent on hardware you control, review every change as a Git diff, with usage visibility, per-user policy, and an Android device bridge.

> **Note:** This is the first semver release under the **Patchwire** name (previous milestones were tagged `v0.2.x-phaseN`). The CLI/agent now report `0.3.0`.

## ✨ Added
- **`patchwire-agent usage`** — per-user activity summary from the audit log: requests, accepted, ask/chat counts, lines changed, and total duration. `--user`, `--project`, `--since`, and `--json` filters. (No dollar cost yet — see Known limitations.)
- **Per-user policy enforcement** — restrict which **projects** a user may run against and apply a **rate limit** (max requests per rolling window). Configure with `patchwire-agent user policy show|projects|rate …`; enforced on both `/ask` and `/chat` with a clean `403`.

## 🔒 Security
- **`patchwire-agent install` now defaults to `127.0.0.1`** (was `0.0.0.0`). Network reachability must be opted into via `--host`/`PW_AGENT_HOST`. *(Action: re-run `install` or set `PW_AGENT_HOST` if you relied on the old all-interfaces default.)*
- `/health` no longer discloses the AI binary's absolute filesystem path.
- `/ask` and `/chat` `404` responses no longer disclose server-side project paths.
- The launchd plist is now written with `0600` permissions.
- Full audit + accepted-risk decisions: `docs/security-audit-2026-06-03.md`.

## ⚠️ Breaking / migration
- **Rebranded "Remote Claude" → "Patchwire".** Same product, new identifiers. To upgrade:
  - Reinstall under the new package names (`patchwire`, `patchwire-vscode`).
  - Migrate config: `remote-claude.yml` → `patchwire.yml`.
  - Migrate state dir: `~/.remote-claude/` → `~/.patchwire/`.
  - launchd label changed: `com.remote-claude.agent` → `com.patchwire.agent` (re-run `patchwire-agent install`).

## 🧰 Maintenance
- Single source of truth for the CLI/agent version (`version.ts`, pinned to `package.json` by a test).
- Fixed the release workflow (stale pre-rebrand package names that would have failed publish).
- De-flaked the `/queue` concurrency e2e test (was non-deterministic in CI).

## 📋 Known limitations / roadmap
- **No dollar cost in `usage`** — the audit log records no model and no reliable tokens; cost reporting needs model + token capture first.
- **"Allowed models" policy** is not available — the model is server-fixed (`PW_AI_BIN`); needs per-request model selection.
- Token hashing (SHA-256, no KDF), SSH `accept-new` TOFU, and unverified `sshpass` vendoring are accepted under the trusted-network (Tailscale/LAN) threat model — see the audit doc.

## Install
```bash
npm i -g @rebink/patchwire            # or: pnpm add -g github:rebink/remote_claude
```
Requires Node ≥ 20.

**Full changelog:** https://github.com/rebink/patchwire/compare/v0.2.4-phase5...v0.3.0
