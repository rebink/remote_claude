# Release Hardening Implementation Plan (v0.3.0)

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkboxes (`- [ ]`). TDD where there's logic; for config/docs, edit + verify (build/grep).

**Goal:** Make the project releasable as **0.3.0**: single-source version, fixed `release.yml`, the bounded security fixes from the audit, and a security findings doc.

**Tech Stack:** TypeScript ESM, commander, fastify (`app.inject`), vitest, GitHub Actions, tsup. Package `patchwire` (`packages/cli`) + `patchwire-vscode` (`packages/extension`).

**Source spec:** `docs/superpowers/specs/2026-06-03-release-hardening-design.md`

---

## Task 0: Branch + baseline
- [ ] `cd /Users/apple/Documents/Workspace/patchwire && git checkout main && git checkout -b feat/release-hardening`
- [ ] `pnpm --filter patchwire test` → green baseline. If red, STOP.

---

## Task 1: Version single source of truth → 0.3.0 (TDD)

**Files:**
- Create: `packages/cli/src/version.ts`, `packages/cli/test/version.test.ts`
- Modify: `packages/cli/src/agent.ts`, `packages/cli/src/cli.ts`, `packages/cli/package.json`, `packages/extension/package.json`, `CHANGELOG.md`

- [ ] **Step 1: Failing test `packages/cli/test/version.test.ts`:**
```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { VERSION } from '../src/version.ts';

const pkg = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
) as { version: string };

describe('VERSION', () => {
  it('is the single source of truth, matching package.json', () => {
    expect(VERSION).toBe(pkg.version);
  });
  it('is 0.3.0', () => {
    expect(VERSION).toBe('0.3.0');
  });
});
```

- [ ] **Step 2:** `pnpm --filter patchwire test version.test` → FAIL (no `version.ts`; and package.json still 0.1.0).

- [ ] **Step 3: Create `packages/cli/src/version.ts`:**
```ts
/**
 * Single source of truth for the CLI + agent version.
 * `test/version.test.ts` pins this to packages/cli/package.json so they can't drift.
 */
export const VERSION = '0.3.0';
```

- [ ] **Step 4: Wire it into the binaries.**

In `packages/cli/src/agent.ts`: remove the line `const VERSION = '0.1.0';` and add, with the other imports near the top:
```ts
import { VERSION } from './version.ts';
```
In `packages/cli/src/cli.ts`: remove `const VERSION = '0.1.0';` and add with the imports:
```ts
import { VERSION } from './version.ts';
```

- [ ] **Step 5: Bump the published packages.** In `packages/cli/package.json` set `"version": "0.3.0"`. In `packages/extension/package.json` set `"version": "0.3.0"`. (Leave root `package.json` and `packages/protocol` as-is.)

- [ ] **Step 6: CHANGELOG.** In `CHANGELOG.md`, replace the `## [Unreleased]` heading and its body with:
```markdown
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
```

- [ ] **Step 7:** `pnpm --filter patchwire test version.test` → PASS. Then `pnpm --filter patchwire build` and verify:
```bash
node packages/cli/dist/cli.js --version   # → 0.3.0
node packages/cli/dist/agent.js --version # → 0.3.0
```

- [ ] **Step 8: Commit**
```bash
git add packages/cli/src/version.ts packages/cli/test/version.test.ts packages/cli/src/agent.ts packages/cli/src/cli.ts packages/cli/package.json packages/extension/package.json CHANGELOG.md
git commit -m "chore(release): single-source VERSION, bump to 0.3.0, changelog"
```

---

## Task 2: Fix the rebrand-broken `release.yml`

**Files:** Modify `.github/workflows/release.yml`

- [ ] **Step 1:** Replace the three pre-rebrand package references:
  - `pnpm --filter remote-claude-vscode package` → `pnpm --filter patchwire-vscode package`
  - `pnpm --filter remote-claude publish --access public --provenance --no-git-checks` → `pnpm --filter patchwire publish --access public --provenance --no-git-checks`
  - the artifact glob `packages/extension/remote-claude-vscode-*.vsix` → `packages/extension/patchwire-vscode-*.vsix`

- [ ] **Step 2: Verify no stale names remain:**
```bash
grep -nE "remote-clause|remote-claude" .github/workflows/release.yml   # expect: no matches
grep -nE "patchwire-vscode|filter patchwire" .github/workflows/release.yml  # expect: the 3 fixed lines
```

- [ ] **Step 3: Commit**
```bash
git add .github/workflows/release.yml
git commit -m "ci(release): fix pre-rebrand package names in release workflow"
```

---

## Task 3: Security fixes — code + tests (TDD for the HTTP-testable ones)

**Files:**
- Modify: `packages/cli/src/agent/server.ts` (/health, /ask 404, /chat 404), `packages/cli/src/commands/daemon.ts` (host default, plist mode), `packages/cli/src/commands/doctor.ts` (drop path display)
- Test: `packages/cli/test/agent/health-and-errors.test.ts`

- [ ] **Step 1: Failing test `packages/cli/test/agent/health-and-errors.test.ts`:**
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../../src/agent/server.ts';
import { UsersStore } from '../../src/agent/users-store.ts';
import { NoopAuditLog } from '../../src/agent/audit-log.ts';

const TOKEN = 'tok-h';
const PATHISH = /\/(bin|usr|opt|home|Users|var|tmp|private|projects)\//;

describe('health + error responses leak no server paths', () => {
  let dir: string; let projectsRoot: string; let usersPath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-health-'));
    projectsRoot = join(dir, 'projects');
    usersPath = join(dir, 'users.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function server(aiCommand: string) {
    const s = new UsersStore(usersPath); s.addUser('ana', TOKEN);
    return buildServer({
      usersStore: s, projectsRoot, aiCommand, aiArgs: [],
      timeoutSec: 5, version: '9.9.9', auditLog: new NoopAuditLog(),
    });
  }

  it('/health reports found but never the binary path', async () => {
    // 'sh' resolves to a real path; the OLD /health leaked it.
    const res = await server('sh').inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { ok: boolean; version: string; claude: { found: boolean; path?: string } };
    expect(body.ok).toBe(true);
    expect(body.version).toBe('9.9.9');
    expect(body.claude.found).toBe(true);
    expect('path' in body.claude).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(PATHISH);
  });

  it('/ask 404 does not leak the project directory path', async () => {
    const res = await server('sh').inject({
      method: 'POST', url: '/ask',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { prompt: 'hi', project: 'missing' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toMatch(PATHISH);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'project not found' });
  });
});
```

- [ ] **Step 2:** `pnpm --filter patchwire test health-and-errors` → FAIL (current `/health` leaks path; `/ask` 404 contains the dir).

- [ ] **Step 3: Fix `/health` in `packages/cli/src/agent/server.ts`.** Replace:
```ts
  app.get('/health', async () => {
    const claude = findAiBin(opts.aiCommand);
    return { ok: true, version: opts.version, claude };
  });
```
with:
```ts
  app.get('/health', async () => {
    const claude = findAiBin(opts.aiCommand);
    // Do not disclose the binary's absolute path on an unauthenticated route.
    return { ok: true, version: opts.version, claude: { found: claude.found } };
  });
```

- [ ] **Step 4: Fix the `/ask` 404 in `server.ts`.** Replace:
```ts
      return { error: `project not found: ${projectDir}` };
```
with:
```ts
      return { error: 'project not found' };
```

- [ ] **Step 5: Fix the `/chat` 404 in `server.ts`.** Replace:
```ts
      return reply.status(404).send({ ok: false, code: 'project_not_found', path: cwd });
```
with:
```ts
      return reply.status(404).send({ ok: false, code: 'project_not_found' });
```

- [ ] **Step 6: Fix the daemon install default host in `packages/cli/src/commands/daemon.ts`.** Replace:
```ts
  const host = opts.host ?? process.env.PW_AGENT_HOST ?? '0.0.0.0';
```
with:
```ts
  // Default to loopback; network reachability (Tailscale/LAN) must be opted into.
  const host = opts.host ?? process.env.PW_AGENT_HOST ?? '127.0.0.1';
```

- [ ] **Step 7: Write the plist with 0600 in `daemon.ts`.** Replace:
```ts
  await writeFile(plistPath(), plist, 'utf8');
```
with:
```ts
  await writeFile(plistPath(), plist, { encoding: 'utf8', mode: 0o600 });
```

- [ ] **Step 8: Update `doctor.ts` to not display the (now absent) path.** In `packages/cli/src/commands/doctor.ts` replace the line:
```ts
          detail: `version=${h.version} claude=${h.claude.found ? h.claude.path : 'NOT FOUND'}`,
```
with:
```ts
          detail: `version=${h.version} claude=${h.claude.found ? 'found' : 'NOT FOUND'}`,
```
(If `doctor.ts` declares a local type for `h.claude` that requires `path`, make `path` optional or remove it so typecheck passes.)

- [ ] **Step 9:** `pnpm --filter patchwire test health-and-errors` → PASS. Then `pnpm --filter patchwire test agent.test` (the existing `/health` test asserts `claude.found` only — still passes) → PASS.

- [ ] **Step 10: Commit**
```bash
git add packages/cli/src/agent/server.ts packages/cli/src/commands/daemon.ts packages/cli/src/commands/doctor.ts packages/cli/test/agent/health-and-errors.test.ts
git commit -m "fix(security): loopback install default, drop path disclosure on /health and 404s, 0600 plist"
```

---

## Task 4: Security findings doc + token rationale comment

**Files:**
- Create: `docs/security-audit-2026-06-03.md`
- Modify: `packages/cli/src/agent/token.ts`

- [ ] **Step 1: Add the rationale comment in `packages/cli/src/agent/token.ts`.** Replace:
```ts
/** SHA-256 of the plaintext token, as lowercase hex. */
export function hashToken(plaintext: string): string {
```
with:
```ts
/**
 * SHA-256 of the plaintext token, as lowercase hex.
 * A KDF (bcrypt/Argon2) is intentionally NOT used: tokens are 256-bit random
 * values (see generateToken), so a plain SHA-256 is preimage-infeasible and
 * adds no per-request latency. Do not introduce low-entropy tokens against this.
 */
export function hashToken(plaintext: string): string {
```

- [ ] **Step 2: Create `docs/security-audit-2026-06-03.md`** with this content:
```markdown
# Patchwire security audit — 2026-06-03

Threat model: single team, self-hosted on a trusted private network (Tailscale/LAN).
Primary risks: accidental exposure of the HTTP port to a wider network, and
information disclosure to authenticated-but-curious users.

## Fixed in v0.3.0
- **F1 (High) — install bound to 0.0.0.0.** `patchwire-agent install` defaulted the
  launchd host to `0.0.0.0`, more permissive than `serve` (`127.0.0.1`). Now defaults
  to `127.0.0.1`; reachability is opt-in via `--host`/`PW_AGENT_HOST`.
- **F2 (High) — `/health` disclosed the AI binary's absolute path** unauthenticated.
  Now returns only `{ found }`.
- **F3 (Medium) — `/ask` and `/chat` 404s disclosed the absolute project path.**
  Now path-free.
- **F7 (Low) — launchd plist written without an explicit mode.** Now `0600`.

## Accepted decisions (not changed)
- **F4 — token hashing is plain SHA-256 (no KDF/salt).** Acceptable: tokens are
  256-bit random (`generateToken`), so SHA-256 is preimage-infeasible and avoids
  per-request KDF latency. Documented inline in `token.ts`.
- **F5 — SSH uses `StrictHostKeyChecking=accept-new` (TOFU).** Acceptable under the
  Tailscale trust model (stable, control-plane-authenticated hosts). Harden to
  `StrictHostKeyChecking=yes` with a pinned `known_hosts` if running off-Tailscale.
- **F6 — `postinstall` vendors `sshpass` without checksum verification.** Acceptable
  for a self-installed dev tool; a pinned-checksum download is future work. The
  `|| true` also hides install failures — revisit.

## Confirmed correct (no action)
- **F8** — legacy `verifyToken` is dead code (server uses hashed `lookupByToken`).
- **F9** — prompts are stored only as `prompt_sha256`; no tokens/prompts are logged.
- **F10** — `/ask` + `/chat` path-traversal defense (`resolve` + `startsWith(root+sep)`
  plus the project-name regex) is correct.
```

- [ ] **Step 3:** `pnpm --filter patchwire typecheck` → exit 0 (comment + doc don't affect types).

- [ ] **Step 4: Commit**
```bash
git add docs/security-audit-2026-06-03.md packages/cli/src/agent/token.ts
git commit -m "docs(security): audit findings + accepted decisions; token KDF rationale"
```

---

## Task 5: Full verification

- [ ] **Step 1:** `pnpm --filter patchwire typecheck` → exit 0.
- [ ] **Step 2:** `pnpm --filter patchwire test` → all pass (note new: version, health-and-errors; existing agent.test `/health` still green).
- [ ] **Step 3:** `pnpm --filter patchwire build` → exit 0.
- [ ] **Step 4:** Version smoke:
```bash
node packages/cli/dist/cli.js --version    # 0.3.0
node packages/cli/dist/agent.js --version  # 0.3.0
```
- [ ] **Step 5:** Stale-name check across the release path:
```bash
grep -rnE "remote-claude" .github/workflows/release.yml && echo "STALE NAMES REMAIN" || echo "clean ✓"
```

---

## Self-review (plan author)
- **Spec coverage:** version single-source + bump + changelog → T1; release.yml fix → T2; F1/F2/F3/F7 security fixes + tests → T3; findings doc + F4 comment → T4; verify → T5. Accepted/Info findings (F4–F6, F8–F10) documented, not changed (spec out-of-scope).
- **Placeholder scan:** none — full code/text in every step; exact grep/version checks.
- **Type/name consistency:** `VERSION` imported from `version.ts` in both binaries; `/health` keeps `claude.found` (so `agent.test.ts` + `doctor.ts` stay valid after dropping `.path`); 404 bodies keep their existing `error`/`code` keys minus the path. Package names in `release.yml` match the real `patchwire` / `patchwire-vscode`.
