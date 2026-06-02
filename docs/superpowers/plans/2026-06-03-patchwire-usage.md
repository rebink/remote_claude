# `patchwire-agent usage` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Follow TDD: test → red → implement → green → commit.

**Goal:** Add `patchwire-agent usage` — a per-user activity summary read from the existing audit log (requests, accepted, ask/chat counts, lines changed, duration), with `--user/--project/--since/--json`. No dollar cost (not in the data).

**Architecture:** A pure aggregation module (`agent/usage.ts`: `aggregateUsage`, `humanizeMs`) with unit tests, and a thin command (`commands/usage.ts`) that reuses the existing `readEntries` reader and `parseSince` helper, modeled on `commands/agent-log.ts`. Registered in `agent.ts` next to `registerAgentLogCommand`.

**Tech Stack:** TypeScript (ESM, `.ts` import specifiers), commander, vitest. Package: `patchwire` (`packages/cli`). Verify with `pnpm --filter patchwire test` / `typecheck` / `build`.

**Source spec:** `docs/superpowers/specs/2026-06-03-patchwire-usage-design.md`

---

## Task 0: Branch + baseline green

**Files:** none

- [ ] **Step 1: Branch from main**
```bash
cd /Users/apple/Documents/Workspace/patchwire
git checkout main
git checkout -b feat/patchwire-usage
```
- [ ] **Step 2: Confirm the CLI package is green before changes**

Run: `pnpm --filter patchwire test`
Expected: all tests pass (suite is large; exit 0).
If red on a clean `main`, STOP and report.

---

## Task 1: Aggregation module (`agent/usage.ts`) — TDD

**Files:**
- Create: `packages/cli/src/agent/usage.ts`
- Test: `packages/cli/test/agent/usage.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/agent/usage.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { aggregateUsage, humanizeMs } from '../../src/agent/usage.ts';
import type { AskAuditEntry, ChatAuditEntry } from '../../src/agent/audit-log.ts';

function ask(over: Partial<AskAuditEntry>): AskAuditEntry {
  return {
    route: '/ask', ts: '2026-06-02T10:00:00.000Z',
    user: 'alice', project: 'app', prompt_sha256: 'a'.repeat(64),
    files: 1, lines_added: 0, lines_removed: 0,
    duration_ms: 1000, queue_wait_ms: 0, exit_code: 0, ...over,
  };
}
function chat(over: Partial<ChatAuditEntry>): ChatAuditEntry {
  return {
    route: '/chat', ts: '2026-06-02T10:00:00.000Z',
    user: 'alice', project: 'app', prompt_sha256: 'a'.repeat(64),
    duration_ms: 1000, queue_wait_ms: 0,
    uuid: 'u'.repeat(36), tokens_in: 10, tokens_out: 20, ...over,
  };
}

describe('aggregateUsage', () => {
  it('returns empty users and zeroed totals for no entries', () => {
    const r = aggregateUsage([]);
    expect(r.users).toEqual([]);
    expect(r.totals.requests).toBe(0);
    expect(r.totals.accepted).toBe(0);
  });

  it('counts requests, accepted (exit 0), and sums lines/duration per user', () => {
    const r = aggregateUsage([
      ask({ user: 'alice', lines_added: 5, lines_removed: 2, duration_ms: 1000, exit_code: 0 }),
      ask({ user: 'alice', lines_added: 3, lines_removed: 0, duration_ms: 2000, exit_code: 1 }),
    ]);
    expect(r.users).toHaveLength(1);
    const a = r.users[0];
    expect(a.user).toBe('alice');
    expect(a.requests).toBe(2);
    expect(a.accepted).toBe(1);
    expect(a.ask).toBe(2);
    expect(a.lines_added).toBe(8);
    expect(a.lines_removed).toBe(2);
    expect(a.duration_ms).toBe(3000);
  });

  it('treats every /chat as accepted and sums tokens', () => {
    const r = aggregateUsage([chat({ user: 'bob', tokens_in: 10, tokens_out: 20 })]);
    const b = r.users[0];
    expect(b.chat).toBe(1);
    expect(b.accepted).toBe(1);
    expect(b.tokens_in).toBe(10);
    expect(b.tokens_out).toBe(20);
  });

  it('sorts users by requests desc then name asc, and computes totals', () => {
    const r = aggregateUsage([
      ask({ user: 'ana' }), ask({ user: 'ana' }), ask({ user: 'ana' }),
      ask({ user: 'ben' }),
      ask({ user: 'cleo' }), ask({ user: 'cleo' }),
    ]);
    expect(r.users.map((u) => u.user)).toEqual(['ana', 'cleo', 'ben']);
    expect(r.totals.user).toBe('total');
    expect(r.totals.requests).toBe(6);
  });
});

describe('humanizeMs', () => {
  it('formats sub-minute as seconds', () => { expect(humanizeMs(45_000)).toBe('45s'); });
  it('formats minutes and seconds', () => { expect(humanizeMs(123_000)).toBe('2m 3s'); });
  it('formats hours and minutes', () => { expect(humanizeMs(3_720_000)).toBe('1h 2m'); });
  it('handles zero and negatives', () => {
    expect(humanizeMs(0)).toBe('0s');
    expect(humanizeMs(-5)).toBe('0s');
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm --filter patchwire test usage.test`
Expected: FAIL — cannot resolve `../../src/agent/usage.ts` (module doesn't exist yet).

- [ ] **Step 3: Implement the module**

Create `packages/cli/src/agent/usage.ts`:
```ts
import type { AuditEntry } from './audit-log.ts';

export interface UserUsage {
  user: string;
  requests: number;
  accepted: number;
  ask: number;
  chat: number;
  files: number;
  lines_added: number;
  lines_removed: number;
  duration_ms: number;
  queue_wait_ms: number;
  tokens_in: number;
  tokens_out: number;
}

export interface UsageReport {
  users: UserUsage[];
  totals: UserUsage;
}

function emptyUsage(user: string): UserUsage {
  return {
    user, requests: 0, accepted: 0, ask: 0, chat: 0,
    files: 0, lines_added: 0, lines_removed: 0,
    duration_ms: 0, queue_wait_ms: 0, tokens_in: 0, tokens_out: 0,
  };
}

/** Aggregate audit entries into per-user totals plus a grand total.
 *  `accepted` = /ask turns that exited 0, plus every /chat turn (no exit code). */
export function aggregateUsage(entries: AuditEntry[]): UsageReport {
  const byUser = new Map<string, UserUsage>();
  const totals = emptyUsage('total');

  for (const e of entries) {
    let u = byUser.get(e.user);
    if (!u) { u = emptyUsage(e.user); byUser.set(e.user, u); }
    for (const acc of [u, totals]) {
      acc.requests += 1;
      acc.duration_ms += e.duration_ms;
      acc.queue_wait_ms += e.queue_wait_ms;
      if (e.route === '/ask') {
        acc.ask += 1;
        if (e.exit_code === 0) acc.accepted += 1;
        acc.files += e.files;
        acc.lines_added += e.lines_added;
        acc.lines_removed += e.lines_removed;
      } else {
        acc.chat += 1;
        acc.accepted += 1;
        acc.tokens_in += e.tokens_in;
        acc.tokens_out += e.tokens_out;
      }
    }
  }

  const users = [...byUser.values()].sort(
    (a, b) => b.requests - a.requests || (a.user < b.user ? -1 : a.user > b.user ? 1 : 0),
  );
  return { users, totals };
}

/** Humanize a millisecond duration: "45s", "2m 3s", or "1h 2m". */
export function humanizeMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  if (totalMin < 60) return `${totalMin}m ${totalSec % 60}s`;
  const hr = Math.floor(totalMin / 60);
  return `${hr}h ${totalMin % 60}m`;
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `pnpm --filter patchwire test usage.test`
Expected: PASS (all aggregateUsage + humanizeMs tests green).

- [ ] **Step 5: Commit**
```bash
git add packages/cli/src/agent/usage.ts packages/cli/test/agent/usage.test.ts
git commit -m "feat(cli): usage aggregation module (aggregateUsage, humanizeMs)"
```

---

## Task 2: `usage` command + wiring — TDD

**Files:**
- Create: `packages/cli/src/commands/usage.ts`
- Test: `packages/cli/test/commands/usage.test.ts`
- Modify: `packages/cli/src/commands/agent-log.ts` (export `parseSince`)
- Modify: `packages/cli/src/agent.ts` (register the command)

- [ ] **Step 1: Write the failing command tests**

Create `packages/cli/test/commands/usage.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { registerUsageCommand } from '../../src/commands/usage.ts';
import { JsonlAuditLog, type AskAuditEntry } from '../../src/agent/audit-log.ts';

describe('patchwire-agent usage', () => {
  let dir: string; let basePath: string; let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-usage-cmd-'));
    basePath = join(dir, 'agent.log');
    process.env.PW_AUDIT_LOG = basePath;
    logs = [];
    logSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => { logs.push(String(chunk)); return true; });
  });
  afterEach(() => {
    logSpy.mockRestore();
    delete process.env.PW_AUDIT_LOG;
    rmSync(dir, { recursive: true, force: true });
  });

  function ask(over: Partial<AskAuditEntry>): AskAuditEntry {
    return {
      route: '/ask', ts: '2026-06-02T10:00:00.000Z',
      user: 'alice', project: 'app', prompt_sha256: 'a'.repeat(64),
      files: 1, lines_added: 0, lines_removed: 0,
      duration_ms: 1000, queue_wait_ms: 0, exit_code: 0, ...over,
    };
  }
  function run(argv: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerUsageCommand(program);
    return program.parseAsync(['node', 'patchwire-agent', ...argv]);
  }

  it('prints "(no usage yet)" when the log is empty', async () => {
    await run(['usage']);
    expect(logs.join('')).toContain('(no usage yet)');
  });

  it('prints a per-user table with a totals row', async () => {
    const log = new JsonlAuditLog({ path: basePath });
    log.append(ask({ user: 'alice' }));
    log.append(ask({ user: 'bob' }));
    await run(['usage']);
    const out = logs.join('');
    expect(out).toMatch(/USER/);
    expect(out).toMatch(/alice/);
    expect(out).toMatch(/bob/);
    expect(out).toMatch(/total/);
  });

  it('--user filters to one user', async () => {
    const log = new JsonlAuditLog({ path: basePath });
    log.append(ask({ user: 'alice' }));
    log.append(ask({ user: 'bob' }));
    await run(['usage', '--user', 'alice']);
    const out = logs.join('');
    expect(out).toMatch(/alice/);
    expect(out).not.toMatch(/\bbob\b/);
  });

  it('--json emits a structured report', async () => {
    const log = new JsonlAuditLog({ path: basePath });
    log.append(ask({ user: 'alice', exit_code: 0 }));
    log.append(ask({ user: 'alice', exit_code: 1 }));
    await run(['usage', '--json']);
    const report = JSON.parse(logs.join('').trim());
    expect(report.users[0].user).toBe('alice');
    expect(report.users[0].requests).toBe(2);
    expect(report.users[0].accepted).toBe(1);
    expect(report.totals.requests).toBe(2);
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `pnpm --filter patchwire test usage` 
Expected: the command test FAILS — `../../src/commands/usage.ts` does not exist. (The Task 1 `usage.test.ts` still passes.)

- [ ] **Step 3: Export `parseSince` from agent-log.ts**

In `packages/cli/src/commands/agent-log.ts`, change the declaration:
```ts
function parseSince(value: string): number {
```
to:
```ts
export function parseSince(value: string): number {
```
(No other change; behaviour identical.)

- [ ] **Step 4: Implement the command**

Create `packages/cli/src/commands/usage.ts`:
```ts
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { readEntries, type LogFilter } from '../agent/log-reader.ts';
import { parseSince } from './agent-log.ts';
import { aggregateUsage, humanizeMs, type UserUsage } from '../agent/usage.ts';

function basePath(): string {
  return process.env.PW_AUDIT_LOG ?? join(homedir(), '.patchwire', 'agent.log');
}

function row(u: UserUsage): string {
  return (
    u.user.padEnd(12) +
    String(u.requests).padStart(6) +
    String(u.accepted).padStart(5) +
    String(u.ask).padStart(6) +
    String(u.chat).padStart(6) +
    String(u.lines_added).padStart(8) +
    String(u.lines_removed).padStart(8) +
    '  ' + humanizeMs(u.duration_ms)
  );
}

export function registerUsageCommand(program: Command): void {
  program
    .command('usage')
    .description('Per-user usage summary from the audit log')
    .option('--user <name>', 'show only this user')
    .option('--project <name>', 'show only this project')
    .option('--since <duration>', "only entries newer than this (e.g. '30m', '6h', '7d')")
    .option('--json', 'emit the structured report as JSON')
    .action((opts: { user?: string; project?: string; since?: string; json?: boolean }) => {
      const filter: LogFilter = {};
      if (opts.user) filter.user = opts.user;
      if (opts.project) filter.project = opts.project;
      if (opts.since) filter.sinceMs = parseSince(opts.since);
      const entries = readEntries({ basePath: basePath(), filter });
      const report = aggregateUsage(entries);

      if (opts.json) {
        process.stdout.write(JSON.stringify(report) + '\n');
        return;
      }
      if (report.users.length === 0) {
        process.stdout.write('(no usage yet)\n');
        return;
      }
      const header =
        'USER'.padEnd(12) + 'REQ'.padStart(6) + 'OK'.padStart(5) +
        'ASK'.padStart(6) + 'CHAT'.padStart(6) + '+LN'.padStart(8) + '-LN'.padStart(8) + '  DUR';
      process.stdout.write(header + '\n');
      for (const u of report.users) process.stdout.write(row(u) + '\n');
      process.stdout.write('─'.repeat(57) + '\n');
      process.stdout.write(row(report.totals) + '\n');
    });
}
```

- [ ] **Step 5: Wire the command into the agent binary**

In `packages/cli/src/agent.ts`:
- Add an import next to the other command imports (after the `registerAgentLogCommand` import line):
```ts
import { registerUsageCommand } from './commands/usage.ts';
```
- Register it right after `registerAgentLogCommand(program);`:
```ts
registerUsageCommand(program);
```

- [ ] **Step 6: Run, verify all pass**

Run: `pnpm --filter patchwire test usage`
Expected: PASS — both `usage.test.ts` (agent) and `usage.test.ts` (command) green.

- [ ] **Step 7: Commit**
```bash
git add packages/cli/src/commands/usage.ts packages/cli/test/commands/usage.test.ts packages/cli/src/commands/agent-log.ts packages/cli/src/agent.ts
git commit -m "feat(cli): patchwire-agent usage command (per-user audit summary)"
```

---

## Task 3: Full verification

**Files:** none

- [ ] **Step 1: Typecheck**

Run: `pnpm --filter patchwire typecheck`
Expected: exit 0, no type errors. (Confirms the `AuditEntry` union narrowing and exports are sound.)

- [ ] **Step 2: Full test suite (nothing regressed)**

Run: `pnpm --filter patchwire test`
Expected: all tests pass — including the pre-existing `agent-log.test.ts` (whose `parseSince` is now exported but unchanged).

- [ ] **Step 3: Build**

Run: `pnpm --filter patchwire build`
Expected: exit 0 (tsup builds both bins).

- [ ] **Step 4: Smoke-check the command shape (optional but recommended)**

Run:
```bash
cd /Users/apple/Documents/Workspace/patchwire/packages/cli
PW_AUDIT_LOG=/tmp/pw-usage-smoke.log node -e "const fs=require('fs');fs.writeFileSync('/tmp/pw-usage-smoke.log',[JSON.stringify({route:'/ask',ts:'2026-06-02T10:00:00.000Z',user:'ana',project:'app',prompt_sha256:'a'.repeat(64),files:2,lines_added:12,lines_removed:3,duration_ms:4700,queue_wait_ms:3400,exit_code:0}),JSON.stringify({route:'/ask',ts:'2026-06-02T10:01:00.000Z',user:'ben',project:'app',prompt_sha256:'b'.repeat(64),files:1,lines_added:4,lines_removed:0,duration_ms:2000,queue_wait_ms:0,exit_code:0})].join('\n')+'\n')"
PW_AUDIT_LOG=/tmp/pw-usage-smoke.log npx tsx src/agent.ts usage
PW_AUDIT_LOG=/tmp/pw-usage-smoke.log npx tsx src/agent.ts usage --json
rm -f /tmp/pw-usage-smoke.log
```
Expected: a table with `ana` and `ben` rows + a `total` row; the `--json` run prints a parseable `{"users":[...],"totals":{...}}`.

---

## Self-review (plan author)
- **Spec coverage:** aggregation + `accepted` rule + sort + totals → Task 1; command + flags + empty message + `--json` + table → Task 2; `parseSince` reuse → Task 2 Step 3; wiring → Task 2 Step 5; regression safety + build → Task 3. No dollar cost anywhere (spec §"Out of scope").
- **Placeholder scan:** none — full code in every implement step; exact commands + expected results in every verify step.
- **Type/name consistency:** `aggregateUsage`/`humanizeMs`/`UserUsage`/`UsageReport`/`registerUsageCommand` used identically across module, tests, command, and wiring. Test fixtures match the real `AskAuditEntry`/`ChatAuditEntry` shapes from `audit-log.ts` (incl. `prompt_sha256`, `uuid`). `readEntries({basePath, filter})` and `LogFilter` match `log-reader.ts`.
