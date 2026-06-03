# Milestone 3 — Release hardening (version coherence + pipeline fix + security fixes)

**Date:** 2026-06-03
**Status:** Approved design, ready for plan
**Part of:** production-readiness sequence (milestone 3 of 4). Prev: usage, policy enforcement (done). Next: device bridge.

Target release version: **0.3.0**.

---

## Threads & decisions
The release infra already exists (CI on Node 20/22, README/CHANGELOG/LICENSE, `release.yml`, packaging config). The work is fixing what the rebrand and drift left broken, plus the bounded security fixes from the audit. Scope (from brainstorm): **coherence + security audit**, version **0.3.0**.

### A. Version coherence
- The published packages report the wrong version: `packages/cli/package.json` = `0.1.0`, and `agent.ts`/`cli.ts` **hardcode** `VERSION='0.1.0'`, while docs say `v0.2.4`. Root is `0.0.0` (private monorepo — leave). 
- **Single source of truth:** a new `packages/cli/src/version.ts` exports `VERSION = '0.3.0'`; `agent.ts` and `cli.ts` import it (drop the hardcoded consts). A test asserts `VERSION === packages/cli/package.json.version` so they can never drift.
- Bump `packages/cli/package.json` and `packages/extension/package.json` to `0.3.0`. Protocol stays private (`0.0.0`).
- CHANGELOG: move the `[Unreleased]` rebrand notes under a new `## [0.3.0] — 2026-06-03` section that also lists the new features (multi-developer, streamed `/ask`, `patchwire-agent usage`, per-user policy enforcement) and the security fixes below.

### B. Release pipeline fix (`.github/workflows/release.yml`)
The rebrand left pre-rebrand package names that would fail the publish job:
- `pnpm --filter remote-claude-vscode package` → `patchwire-vscode`
- `pnpm --filter remote-claude publish …` → `patchwire`
- artifact glob `remote-claude-vscode-*.vsix` → `patchwire-vscode-*.vsix`

### C. Security fixes — "fix now" set (audit `docs/security-audit-2026-06-03.md`)
1. **Finding 1 (High):** `commands/daemon.ts:63` install default host `'0.0.0.0'` → `'127.0.0.1'` (match `serve`; reachability must be opt-in via `--host`/`PW_AGENT_HOST`).
2. **Finding 2 (High):** `/health` leaks the AI binary's absolute path unauthenticated → return only `{ ok, version, ai: { found } }` (no `path`).
3. **Finding 3 (Med):** `/ask` 404 (`server.ts`) and `/chat` 404 leak the absolute project dir → return `{ error: 'project not found' }` / `{ ok:false, code:'project_not_found' }` (drop the path).
4. **Finding 7 (Low):** `commands/daemon.ts` plist `writeFile` lacks a mode → write with `{ mode: 0o600 }`.

### D. Security findings doc + accepted decisions
Write `docs/security-audit-2026-06-03.md` capturing all 10 findings, the fixes above, and the **accepted** decisions (4: SHA-256 of a 256-bit random token is fine; 5: `accept-new` TOFU is acceptable under the Tailscale trust model; 6: vendored `sshpass` is unverified — note the risk). Add a one-line code comment at `token.ts` hashing explaining the SHA-256-is-sufficient rationale (Finding 4).

## Out of scope
- KDF for tokens, strict SSH host pinning, checksum-verified sshpass vendoring (documented as accepted/future, not fixed now).
- Deleting legacy `verifyToken` (Finding 8) — leave; not exercised.
- Device bridge (milestone 4).
- npm-publishing for real (this milestone makes the pipeline *correct*; actual `git tag v0.3.0` + publish is a manual release step the user triggers).

## Success criteria
- `patchwire --version` and `patchwire-agent --version` report `0.3.0`; a test pins `VERSION` to the package.json version.
- `release.yml` references only `patchwire`/`patchwire-vscode` names + correct vsix glob.
- `/health` exposes no filesystem path; `/ask` and `/chat` 404s expose no server path — covered by tests.
- `daemon` install default host is `127.0.0.1`; plist written `0o600`.
- `docs/security-audit-2026-06-03.md` exists with findings + accepted decisions.
- `pnpm --filter patchwire test/typecheck/build` green; existing tests unaffected (note: any test asserting the old 404 path string must be updated).

## Affected files
- Create: `packages/cli/src/version.ts`, `packages/cli/test/version.test.ts`, `packages/cli/test/agent/health-and-errors.test.ts`, `docs/security-audit-2026-06-03.md`
- Modify: `packages/cli/src/agent.ts`, `packages/cli/src/cli.ts`, `packages/cli/package.json`, `packages/extension/package.json`, `CHANGELOG.md`, `.github/workflows/release.yml`, `packages/cli/src/agent/server.ts` (/health, /ask 404, /chat 404), `packages/cli/src/commands/daemon.ts` (host default, plist mode), `packages/cli/src/agent/token.ts` (rationale comment)
