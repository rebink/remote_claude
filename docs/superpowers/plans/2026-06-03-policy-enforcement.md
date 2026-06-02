# Per-user Policy Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`). TDD: test → red → implement → green → commit.

**Goal:** Enforce per-user **project allowlist** + **rate limit** on `/ask` and `/chat`, configured via `patchwire-agent user policy …`, stored in `users.json`.

**Architecture:** Pure `agent/policy.ts` (`evaluatePolicy`) + `lib/duration.ts` (`parseDurationMs`); `UsersStore` gains a `policy` field with get/set; new `user policy` CLI subcommands; `server.ts` evaluates policy before hijack and returns a clean 403.

**Tech Stack:** TypeScript ESM (`.ts` specifiers), commander, fastify (`app.inject` for handler tests), vitest. Package `patchwire` (`packages/cli`).

**Source spec:** `docs/superpowers/specs/2026-06-03-policy-enforcement-design.md`

---

## Task 0: Branch + baseline

- [ ] **Step 1:**
```bash
cd /Users/apple/Documents/Workspace/patchwire
git checkout main && git checkout -b feat/policy-enforcement
```
- [ ] **Step 2:** `pnpm --filter patchwire test` → all green (baseline). If red, STOP.

---

## Task 1: Pure modules — `policy.ts` + `duration.ts` (TDD)

**Files:**
- Create: `packages/cli/src/agent/policy.ts`, `packages/cli/src/lib/duration.ts`
- Test: `packages/cli/test/agent/policy.test.ts`, `packages/cli/test/lib/duration.test.ts`
- Modify: `packages/cli/src/commands/agent-log.ts` (refactor `parseSince`)

- [ ] **Step 1: Failing tests**

`packages/cli/test/lib/duration.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseDurationMs } from '../../src/lib/duration.ts';

describe('parseDurationMs', () => {
  it('parses s/m/h/d', () => {
    expect(parseDurationMs('30s')).toBe(30_000);
    expect(parseDurationMs('15m')).toBe(900_000);
    expect(parseDurationMs('6h')).toBe(21_600_000);
    expect(parseDurationMs('7d')).toBe(604_800_000);
  });
  it('throws on bad input', () => {
    expect(() => parseDurationMs('soon')).toThrow();
    expect(() => parseDurationMs('5x')).toThrow();
  });
});
```

`packages/cli/test/agent/policy.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '../../src/agent/policy.ts';

describe('evaluatePolicy', () => {
  it('allows when policy is empty', () => {
    expect(evaluatePolicy({}, { project: 'app', recentCount: 0 })).toEqual({ allowed: true });
  });
  it('allows a project in the allowlist', () => {
    const d = evaluatePolicy({ projects: ['app', 'api'] }, { project: 'api', recentCount: 0 });
    expect(d.allowed).toBe(true);
  });
  it('denies a project not in the allowlist', () => {
    const d = evaluatePolicy({ projects: ['app'] }, { project: 'secret', recentCount: 0 });
    expect(d).toMatchObject({ allowed: false, code: 'project_not_allowed' });
  });
  it('treats an empty allowlist as "all allowed"', () => {
    expect(evaluatePolicy({ projects: [] }, { project: 'anything', recentCount: 0 }).allowed).toBe(true);
  });
  it('allows under the rate limit', () => {
    expect(evaluatePolicy({ rateLimit: { max: 5, windowMs: 3600_000 } }, { project: 'app', recentCount: 4 }).allowed).toBe(true);
  });
  it('denies at/over the rate limit', () => {
    const d = evaluatePolicy({ rateLimit: { max: 5, windowMs: 3600_000 } }, { project: 'app', recentCount: 5 });
    expect(d).toMatchObject({ allowed: false, code: 'rate_limited' });
  });
  it('checks the allowlist before the rate limit', () => {
    const d = evaluatePolicy(
      { projects: ['app'], rateLimit: { max: 1, windowMs: 1000 } },
      { project: 'other', recentCount: 99 },
    );
    expect(d).toMatchObject({ allowed: false, code: 'project_not_allowed' });
  });
});
```

- [ ] **Step 2:** `pnpm --filter patchwire test "policy.test|duration.test"` → FAIL (modules missing).

- [ ] **Step 3: Implement `packages/cli/src/lib/duration.ts`:**
```ts
const DURATION_RE = /^(\d+)\s*(s|m|h|d)$/;

/** Parse '30s' | '15m' | '6h' | '7d' into milliseconds. Throws on bad input. */
export function parseDurationMs(value: string): number {
  const m = value.match(DURATION_RE);
  if (!m) {
    throw new Error(`duration must look like '15m', '6h', '7d', '30s' (got '${value}')`);
  }
  const n = Number(m[1]);
  const unit = m[2];
  const ms = unit === 's' ? 1000
    : unit === 'm' ? 60 * 1000
    : unit === 'h' ? 60 * 60 * 1000
    : 24 * 60 * 60 * 1000;
  return n * ms;
}
```

- [ ] **Step 4: Implement `packages/cli/src/agent/policy.ts`:**
```ts
export interface RateLimit {
  max: number;
  windowMs: number;
}

export interface UserPolicy {
  /** Allowlist of project names. Absent or empty = all projects allowed. */
  projects?: string[];
  /** Max requests per rolling window. Absent = unlimited. */
  rateLimit?: RateLimit;
}

export interface PolicyContext {
  project: string;
  /** Count of the user's requests already recorded within `rateLimit.windowMs`. */
  recentCount: number;
}

export type PolicyDecision =
  | { allowed: true }
  | { allowed: false; code: string; message: string };

/** Evaluate a user's policy against one request. Allowlist is checked before rate limit. */
export function evaluatePolicy(policy: UserPolicy, ctx: PolicyContext): PolicyDecision {
  if (policy.projects && policy.projects.length > 0 && !policy.projects.includes(ctx.project)) {
    return {
      allowed: false,
      code: 'project_not_allowed',
      message: `project '${ctx.project}' is not in your allowed list`,
    };
  }
  if (policy.rateLimit && ctx.recentCount >= policy.rateLimit.max) {
    return {
      allowed: false,
      code: 'rate_limited',
      message: `rate limit reached (${policy.rateLimit.max} requests per window)`,
    };
  }
  return { allowed: true };
}
```

- [ ] **Step 5: Refactor `parseSince` in `packages/cli/src/commands/agent-log.ts` to reuse the helper.**

Add import at the top (with the other imports):
```ts
import { parseDurationMs } from '../lib/duration.ts';
```
Replace the entire existing `parseSince` function (the `const DURATION_RE = …` line and the whole `export function parseSince(value) { … }` block) with:
```ts
export function parseSince(value: string): number {
  return Date.now() - parseDurationMs(value);
}
```
(Remove the now-unused `DURATION_RE` const in agent-log.ts.)

- [ ] **Step 6:** `pnpm --filter patchwire test "policy.test|duration.test|agent-log|usage"` → all PASS (new modules + agent-log/usage still green after the refactor).

- [ ] **Step 7: Commit**
```bash
git add packages/cli/src/agent/policy.ts packages/cli/src/lib/duration.ts packages/cli/test/agent/policy.test.ts packages/cli/test/lib/duration.test.ts packages/cli/src/commands/agent-log.ts
git commit -m "feat(cli): policy evaluation + duration helpers; DRY parseSince"
```

---

## Task 2: `UsersStore` policy support (TDD)

**Files:**
- Modify: `packages/cli/src/agent/users-store.ts`
- Test: `packages/cli/test/agent/users-policy.test.ts`

- [ ] **Step 1: Failing test `packages/cli/test/agent/users-policy.test.ts`:**
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { UsersStore } from '../../src/agent/users-store.ts';

describe('UsersStore policy', () => {
  let dir: string; let path: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'pw-userpol-')); path = join(dir, 'users.json'); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns {} when a user has no policy', () => {
    const s = new UsersStore(path);
    s.addUser('ana', 'tok');
    expect(s.getPolicy('ana')).toEqual({});
  });

  it('sets and round-trips a project allowlist', () => {
    const s = new UsersStore(path);
    s.addUser('ana', 'tok');
    s.setProjects('ana', ['app', 'api']);
    expect(s.getPolicy('ana').projects).toEqual(['app', 'api']);
    // persisted: a fresh store reads it back
    expect(new UsersStore(path).getPolicy('ana').projects).toEqual(['app', 'api']);
  });

  it('sets and round-trips a rate limit', () => {
    const s = new UsersStore(path);
    s.addUser('ana', 'tok');
    s.setRateLimit('ana', { max: 50, windowMs: 3600_000 });
    expect(new UsersStore(path).getPolicy('ana').rateLimit).toEqual({ max: 50, windowMs: 3600_000 });
  });

  it('clearing both leaves no policy key in the persisted file', () => {
    const s = new UsersStore(path);
    s.addUser('ana', 'tok');
    s.setProjects('ana', ['app']);
    s.setRateLimit('ana', { max: 1, windowMs: 1000 });
    s.setProjects('ana', null);
    s.setRateLimit('ana', null);
    expect(s.getPolicy('ana')).toEqual({});
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    expect('policy' in raw.ana).toBe(false);
  });

  it('throws for an unknown user', () => {
    const s = new UsersStore(path);
    expect(() => s.setProjects('ghost', ['x'])).toThrow();
  });
});
```

- [ ] **Step 2:** `pnpm --filter patchwire test users-policy` → FAIL.

- [ ] **Step 3: Implement in `packages/cli/src/agent/users-store.ts`:**

Add the import near the top (after the existing imports):
```ts
import type { UserPolicy, RateLimit } from './policy.ts';
```
Add `policy?: UserPolicy;` to the `UserRecord` interface (after `lastSeen?: string;`).

Add a module-level normalizer (above the class):
```ts
/** Drop an all-empty policy so we never persist `{}`. */
function normalizePolicy(p: UserPolicy): UserPolicy | undefined {
  const hasProjects = !!(p.projects && p.projects.length > 0);
  const hasRate = !!p.rateLimit;
  if (!hasProjects && !hasRate) return undefined;
  return p;
}
```
Add these methods to the `UsersStore` class (e.g. after `touchLastSeen`):
```ts
  getPolicy(name: string): UserPolicy {
    return this.users[name]?.policy ?? {};
  }

  setProjects(name: string, projects: string[] | null): void {
    this.mutate(name, (r) => {
      const p: UserPolicy = { ...(r.policy ?? {}) };
      if (projects && projects.length > 0) p.projects = projects;
      else delete p.projects;
      r.policy = normalizePolicy(p);
    });
  }

  setRateLimit(name: string, rate: RateLimit | null): void {
    this.mutate(name, (r) => {
      const p: UserPolicy = { ...(r.policy ?? {}) };
      if (rate) p.rateLimit = rate;
      else delete p.rateLimit;
      r.policy = normalizePolicy(p);
    });
  }
```
(Note: `mutate` already persists. Assigning `r.policy = undefined` makes `JSON.stringify` omit the key — that's what the "no policy key" test asserts.)

- [ ] **Step 4:** `pnpm --filter patchwire test users-policy` → PASS. Also run `pnpm --filter patchwire test users-store` to confirm the existing store tests still pass.

- [ ] **Step 5: Commit**
```bash
git add packages/cli/src/agent/users-store.ts packages/cli/test/agent/users-policy.test.ts
git commit -m "feat(cli): per-user policy storage in UsersStore (getPolicy/setProjects/setRateLimit)"
```

---

## Task 3: `user policy` CLI subcommands (TDD)

**Files:**
- Modify: `packages/cli/src/commands/user.ts`
- Test: `packages/cli/test/commands/user-policy.test.ts`

- [ ] **Step 1: Failing test `packages/cli/test/commands/user-policy.test.ts`:**
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { registerUserCommands } from '../../src/commands/user.ts';
import { UsersStore } from '../../src/agent/users-store.ts';

describe('patchwire-agent user policy', () => {
  let dir: string; let usersPath: string; let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-userpol-cmd-'));
    usersPath = join(dir, 'users.json');
    process.env.PW_USERS_FILE = usersPath;
    new UsersStore(usersPath).addUser('ana', 'tok');
    logs = [];
    logSpy = vi.spyOn(process.stdout, 'write').mockImplementation((c) => { logs.push(String(c)); return true; });
  });
  afterEach(() => {
    logSpy.mockRestore();
    delete process.env.PW_USERS_FILE;
    rmSync(dir, { recursive: true, force: true });
  });

  function run(argv: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerUserCommands(program);
    return program.parseAsync(['node', 'patchwire-agent', ...argv]);
  }

  it('projects sets an allowlist', async () => {
    await run(['user', 'policy', 'projects', 'ana', 'app', 'api']);
    expect(new UsersStore(usersPath).getPolicy('ana').projects).toEqual(['app', 'api']);
  });

  it('projects --clear removes the allowlist', async () => {
    await run(['user', 'policy', 'projects', 'ana', 'app']);
    await run(['user', 'policy', 'projects', 'ana', '--clear']);
    expect(new UsersStore(usersPath).getPolicy('ana').projects).toBeUndefined();
  });

  it('rate sets a rate limit parsed from a duration', async () => {
    await run(['user', 'policy', 'rate', 'ana', '50', '1h']);
    expect(new UsersStore(usersPath).getPolicy('ana').rateLimit).toEqual({ max: 50, windowMs: 3600_000 });
  });

  it('rate --clear removes the rate limit', async () => {
    await run(['user', 'policy', 'rate', 'ana', '5', '1h']);
    await run(['user', 'policy', 'rate', 'ana', '--clear']);
    expect(new UsersStore(usersPath).getPolicy('ana').rateLimit).toBeUndefined();
  });

  it('rate rejects a non-positive max', async () => {
    await expect(run(['user', 'policy', 'rate', 'ana', '0', '1h'])).rejects.toThrow();
  });

  it('show prints the current policy', async () => {
    await run(['user', 'policy', 'projects', 'ana', 'app']);
    logs.length = 0;
    await run(['user', 'policy', 'show', 'ana']);
    const out = logs.join('');
    expect(out).toMatch(/app/);
    expect(out).toMatch(/ana/);
  });
});
```

- [ ] **Step 2:** `pnpm --filter patchwire test user-policy` → FAIL.

- [ ] **Step 3: Implement — extend `registerUserCommands` in `packages/cli/src/commands/user.ts`.**

Add these imports at the top (with the existing imports):
```ts
import { parseDurationMs } from '../lib/duration.ts';
import { humanizeMs } from '../agent/usage.ts';
```
At the END of `registerUserCommands(program)` (after the `rotate` command block, still inside the function), append:
```ts
  const policy = user
    .command('policy')
    .description('View or set per-user policy (project allowlist, rate limit)');

  policy
    .command('show <name>')
    .description("Show a user's policy.")
    .action((name: string) => {
      const p = openStore().getPolicy(name);
      const projects = p.projects && p.projects.length ? p.projects.join(', ') : '(all allowed)';
      const rate = p.rateLimit ? `${p.rateLimit.max} per ${humanizeMs(p.rateLimit.windowMs)}` : '(unlimited)';
      process.stdout.write(`Policy for ${name}:\n  projects: ${projects}\n  rate limit: ${rate}\n`);
    });

  policy
    .command('projects <name> [projects...]')
    .description('Set the project allowlist (pass --clear, or no projects, to allow all).')
    .option('--clear', 'remove the allowlist (allow all projects)')
    .action((name: string, projects: string[], opts: { clear?: boolean }) => {
      const store = openStore();
      if (opts.clear || projects.length === 0) {
        store.setProjects(name, null);
        process.stdout.write(`Cleared project allowlist for ${name} (all projects allowed)\n`);
      } else {
        store.setProjects(name, projects);
        process.stdout.write(`Set project allowlist for ${name}: ${projects.join(', ')}\n`);
      }
    });

  policy
    .command('rate <name> [max] [window]')
    .description("Set a rate limit, e.g. 'rate ana 50 1h'. Pass --clear to remove.")
    .option('--clear', 'remove the rate limit')
    .action((name: string, max: string | undefined, window: string | undefined, opts: { clear?: boolean }) => {
      const store = openStore();
      if (opts.clear) {
        store.setRateLimit(name, null);
        process.stdout.write(`Cleared rate limit for ${name}\n`);
        return;
      }
      if (!max || !window) {
        throw new Error("usage: user policy rate <name> <max> <window>  (e.g. 'rate ana 50 1h')");
      }
      const maxN = Number(max);
      if (!Number.isInteger(maxN) || maxN < 1) {
        throw new Error(`max must be a positive integer (got '${max}')`);
      }
      const windowMs = parseDurationMs(window);
      store.setRateLimit(name, { max: maxN, windowMs });
      process.stdout.write(`Set rate limit for ${name}: ${maxN} requests per ${window}\n`);
    });
```

- [ ] **Step 4:** `pnpm --filter patchwire test user-policy` → PASS. Run `pnpm --filter patchwire test commands/user.test` to confirm the existing user-command tests still pass.

- [ ] **Step 5: Commit**
```bash
git add packages/cli/src/commands/user.ts packages/cli/test/commands/user-policy.test.ts
git commit -m "feat(cli): user policy show/projects/rate subcommands"
```

---

## Task 4: Server enforcement on /ask and /chat (TDD)

**Files:**
- Modify: `packages/cli/src/agent/server.ts`
- Test: `packages/cli/test/agent/policy-enforcement.test.ts`

- [ ] **Step 1: Failing integration test `packages/cli/test/agent/policy-enforcement.test.ts`.**

First READ `packages/cli/test/agent.test.ts` to copy its exact `buildServer(...)` option object (usersStore, projectsRoot, aiCommand, aiArgs, timeoutSec, version, auditLog) and READ `packages/protocol/src/chat.ts` to learn the `ChatBody` field names for the `/chat` payload. Then write:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../../src/agent/server.ts';
import { UsersStore } from '../../src/agent/users-store.ts';
import { JsonlAuditLog, NoopAuditLog, type AskAuditEntry } from '../../src/agent/audit-log.ts';

const TOKEN = 'tok-ana';

describe('policy enforcement on /ask', () => {
  let dir: string; let usersPath: string; let projectsRoot: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-policy-enf-'));
    usersPath = join(dir, 'users.json');
    projectsRoot = join(dir, 'projects');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function store(): UsersStore {
    const s = new UsersStore(usersPath);
    s.addUser('ana', TOKEN);
    return s;
  }
  function server(usersStore: UsersStore, auditLog = new NoopAuditLog()) {
    return buildServer({
      usersStore, projectsRoot,
      aiCommand: 'true', aiArgs: [],
      timeoutSec: 5, version: 'test', auditLog,
    });
  }
  function ask(app: ReturnType<typeof buildServer>, project: string) {
    return app.inject({
      method: 'POST', url: '/ask',
      headers: { authorization: `Bearer ${TOKEN}` },
      payload: { prompt: 'hi', project },
    });
  }

  it('403 project_not_allowed for a project off the allowlist', async () => {
    const s = store();
    s.setProjects('ana', ['allowed']);
    const res = await ask(server(s), 'secret');
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'project_not_allowed' });
  });

  it('403 rate_limited when audited count is at the cap', async () => {
    const s = store();
    s.setRateLimit('ana', { max: 2, windowMs: 3600_000 });
    const auditPath = join(dir, 'agent.log');
    const audit = new JsonlAuditLog({ path: auditPath });
    const entry = (over: Partial<AskAuditEntry>): AskAuditEntry => ({
      route: '/ask', ts: new Date().toISOString(), user: 'ana', project: 'app',
      prompt_sha256: 'a'.repeat(64), files: 0, lines_added: 0, lines_removed: 0,
      duration_ms: 1, queue_wait_ms: 0, exit_code: 0, ...over,
    });
    audit.append(entry({}));
    audit.append(entry({}));
    const res = await ask(server(s, audit), 'app');
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body)).toMatchObject({ error: 'rate_limited' });
  });

  it('an allowed request passes policy (no 403; fails later on missing project)', async () => {
    const s = store();
    s.setProjects('ana', ['app']);
    const res = await ask(server(s), 'app');
    // Policy allowed it through; the project dir does not exist → 404 (NOT 403).
    expect(res.statusCode).not.toBe(403);
    expect(res.statusCode).toBe(404);
  });
});
```
Add a `/chat` deny test in the same file mirroring the project_not_allowed case, using the real `ChatBody` field names you read from `packages/protocol/src/chat.ts` (e.g. `{ uuid, projectName, prompt }`), asserting `res.statusCode === 403` and the JSON contains `code: 'project_not_allowed'`.

- [ ] **Step 2:** `pnpm --filter patchwire test policy-enforcement` → FAIL (enforcement not wired).

- [ ] **Step 3: Implement enforcement in `packages/cli/src/agent/server.ts`.**

Add the import (with the other `./` imports near the top):
```ts
import { evaluatePolicy } from './policy.ts';
```
Add a module-level helper (after the imports, before `buildServer`):
```ts
/** Count this user's audited turns within the trailing window. */
function countRecentRequests(auditLog: AuditLog, user: string, windowMs: number): number {
  const cutoff = Date.now() - windowMs;
  return auditLog
    .readAll()
    .filter((e) => e.user === user && Date.parse(e.ts) >= cutoff).length;
}
```
In the `/ask` handler, immediately AFTER the line `const username = req.username!;` (and before `const userRoot = …`), insert:
```ts
    {
      const policy = opts.usersStore.getPolicy(username);
      const recentCount = policy.rateLimit
        ? countRecentRequests(opts.auditLog, username, policy.rateLimit.windowMs)
        : 0;
      const decision = evaluatePolicy(policy, { project, recentCount });
      if (!decision.allowed) {
        reply.code(403);
        return { error: decision.code, message: decision.message };
      }
    }
```
In the `/chat` handler, immediately AFTER its `const username = req.username!;` line (and before `const userRoot = …`), insert:
```ts
    {
      const policy = opts.usersStore.getPolicy(username);
      const recentCount = policy.rateLimit
        ? countRecentRequests(opts.auditLog, username, policy.rateLimit.windowMs)
        : 0;
      const decision = evaluatePolicy(policy, { project: body.projectName, recentCount });
      if (!decision.allowed) {
        return reply.status(403).send({ ok: false, code: decision.code, message: decision.message });
      }
    }
```

- [ ] **Step 4:** `pnpm --filter patchwire test policy-enforcement` → PASS. Then `pnpm --filter patchwire test agent.test` to confirm the existing server tests (which use no policy → unrestricted) still pass.

- [ ] **Step 5: Commit**
```bash
git add packages/cli/src/agent/server.ts packages/cli/test/agent/policy-enforcement.test.ts
git commit -m "feat(cli): enforce per-user policy (allowlist + rate limit) on /ask and /chat"
```

---

## Task 5: Full verification

- [ ] **Step 1:** `pnpm --filter patchwire typecheck` → exit 0.
- [ ] **Step 2:** `pnpm --filter patchwire test` → all pass, nothing regressed.
- [ ] **Step 3:** `pnpm --filter patchwire build` → exit 0.
- [ ] **Step 4 (smoke):**
```bash
cd /Users/apple/Documents/Workspace/patchwire/packages/cli
TMP=$(mktemp -d); export PW_USERS_FILE=$TMP/users.json
npx tsx src/agent.ts user add ana >/dev/null
npx tsx src/agent.ts user policy projects ana app api
npx tsx src/agent.ts user policy rate ana 50 1h
npx tsx src/agent.ts user policy show ana
rm -rf "$TMP"; unset PW_USERS_FILE
```
Expected: `show` prints `projects: app, api` and `rate limit: 50 per 1h 0m` (or similar humanized window).

---

## Self-review (plan author)
- **Spec coverage:** evaluatePolicy + ordering → T1; duration helper + parseSince DRY → T1; UsersStore get/set + empty-normalize → T2; CLI show/projects/rate + validation → T3; /ask + /chat enforcement + recentCount from audit → T4; regression + build → T5. Models deferral is documented (spec out-of-scope), not implemented.
- **Placeholder scan:** none — full code in every implement step; the only "read first" is T4 Step 1 (read agent.test.ts for the exact buildServer opts and chat.ts for ChatBody field names) which is necessary to match real shapes rather than guess.
- **Type/name consistency:** `UserPolicy`/`RateLimit` defined once in `policy.ts`, imported by `users-store.ts`; `evaluatePolicy`, `getPolicy`, `setProjects`, `setRateLimit`, `parseDurationMs`, `countRecentRequests` used identically across modules, tests, CLI, and server. `AskAuditEntry` fixture matches `audit-log.ts`. Deny codes `project_not_allowed` / `rate_limited` consistent between module, tests, and handlers.
