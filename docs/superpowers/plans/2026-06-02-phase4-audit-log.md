# Phase 4: JSONL audit log + log viewer CLI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record one structured JSONL line per successful `/ask` or `/chat` turn — metadata only, no plaintext prompts. Size-rotated on disk. Read back via `patchwire-agent log` with filters for user/project/since/limit.

**Architecture:** A new `AuditLog` interface has two implementations: `JsonlAuditLog` (synchronous appends to `~/.patchwire/agent.log`, size-rotated to `.1`, `.2`, … on a configurable threshold) and `NoopAuditLog` (test-friendly null). The server is handed an `AuditLog` via `AgentOptions`. The `/ask` handler counts diff line +/- and computes `sha256(prompt)`, then appends a `route:"/ask"` entry on success. The `/chat` handler appends a `route:"/chat"` entry on `chat_done` with `tokens_in` / `tokens_out`. A new `patchwire-agent log` subcommand reads the live file plus its rotated tail and prints filtered, pretty-formatted entries (or raw JSONL with `--json`).

**Tech Stack:** TypeScript, Node 20+, Fastify 4, Commander 12, Vitest 2, node:fs (sync), node:crypto.

**Spec reference:** `docs/superpowers/specs/2026-06-01-multi-developer-agent-design.md` (sections 4.4, 5.1 `patchwire-agent log` line, 11 phase 4).

**Out of scope** (later plans):
- SSE protocol on `/ask` — phase 5
- Admin panel — phase 6
- Auditing of failed requests (401/403/404/409/412/500) — phase 1 lands the happy path only
- Auditing per-event chat stream chunks — only the terminal `chat_done` produces a log line

---

## File Structure

**New files:**
- `packages/cli/src/agent/audit-log.ts` — `AuditEntry` types + `AuditLog` interface + `JsonlAuditLog` + `NoopAuditLog`
- `packages/cli/src/agent/diff-stats.ts` — `countDiffLines(diff)` returning `{linesAdded, linesRemoved}`
- `packages/cli/src/agent/log-reader.ts` — `readEntries({basePath, filter})` reads live + rotated files, applies filter, returns sorted entries
- `packages/cli/src/commands/agent-log.ts` — `registerAgentLogCommand(program)` mounting `patchwire-agent log [--user] [--project] [--since] [--limit] [--json]`
- Tests for each.

**Modified files:**
- `packages/cli/src/agent/server.ts` — `AgentOptions` gains `auditLog: AuditLog`; `/ask` appends after successful diff capture; `/chat` appends on `chat_done`
- `packages/cli/src/agent.ts` — `runServe` constructs `JsonlAuditLog`; registers the new `log` subcommand
- `packages/cli/test/agent.test.ts` — pass a `NoopAuditLog` into existing `buildServer({...})` calls (no behavior change)
- `packages/website/src/content/docs/configuration.md` — document `PW_AUDIT_LOG` env var
- `packages/website/src/content/docs/agent.md` — note audit log + CLI viewer

---

## Task 1: `AuditLog` interface + `JsonlAuditLog` + `NoopAuditLog`

**Files:**
- Create: `packages/cli/src/agent/audit-log.ts`
- Test: `packages/cli/test/agent/audit-log.test.ts`

### Behavior

`JsonlAuditLog`:
- Constructor: `{ path: string; maxBytes?: number = 50 * 1024 * 1024; maxFiles?: number = 3 }`. `mkdirSync` the parent if missing.
- `append(entry)`: serializes entry to a single line, calls `rotateIfNeeded()`, then `appendFileSync` with `{ mode: 0o600 }`.
- `rotateIfNeeded()`: if the current file exceeds `maxBytes`, shift `.N` → `.N+1` (capping at `maxFiles`, dropping the oldest), then rename current to `.1` and start a new empty file.
- `readAll()`: convenience for tests — parses every line of the current file (NOT rotated) into entries; tolerant of partial / malformed lines (skips them).

`NoopAuditLog`:
- `append()` and `readAll()` do nothing / return `[]`.

`AuditEntry` (union):

```typescript
export type AuditEntry = AskAuditEntry | ChatAuditEntry;

interface BaseEntry {
  ts: string;          // ISO 8601
  user: string;
  project: string;
  prompt_sha256: string;
  duration_ms: number;
  queue_wait_ms: number;
}

export interface AskAuditEntry extends BaseEntry {
  route: '/ask';
  files: number;
  lines_added: number;
  lines_removed: number;
  exit_code: number;
}

export interface ChatAuditEntry extends BaseEntry {
  route: '/chat';
  uuid: string;
  tokens_in: number;
  tokens_out: number;
}
```

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/agent/audit-log.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonlAuditLog, NoopAuditLog, type AskAuditEntry, type ChatAuditEntry } from '../../src/agent/audit-log.ts';

describe('JsonlAuditLog', () => {
  let dir: string;
  let path: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-audit-'));
    path = join(dir, 'agent.log');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function askEntry(over: Partial<AskAuditEntry> = {}): AskAuditEntry {
    return {
      route: '/ask',
      ts: '2026-06-02T10:00:00.000Z',
      user: 'alice',
      project: 'app',
      prompt_sha256: 'a'.repeat(64),
      files: 1,
      lines_added: 10,
      lines_removed: 2,
      duration_ms: 1000,
      queue_wait_ms: 0,
      exit_code: 0,
      ...over,
    };
  }

  it('append writes a single JSON line and chmods 0600', () => {
    const log = new JsonlAuditLog({ path });
    log.append(askEntry());
    const mode = statSync(path).mode & 0o777;
    expect(mode).toBe(0o600);
    const raw = readFileSync(path, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw.trim().split('\n')).toHaveLength(1);
    const parsed = JSON.parse(raw.trim());
    expect(parsed.user).toBe('alice');
    expect(parsed.route).toBe('/ask');
  });

  it('appends multiple entries on separate lines', () => {
    const log = new JsonlAuditLog({ path });
    log.append(askEntry({ user: 'alice' }));
    log.append(askEntry({ user: 'bob' }));
    const lines = readFileSync(path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).user).toBe('alice');
    expect(JSON.parse(lines[1]).user).toBe('bob');
  });

  it('creates the parent directory if missing', () => {
    const deep = join(dir, 'nested', 'sub', 'agent.log');
    const log = new JsonlAuditLog({ path: deep });
    log.append(askEntry());
    expect(existsSync(deep)).toBe(true);
  });

  it('does NOT persist plaintext prompts', () => {
    const log = new JsonlAuditLog({ path });
    log.append(askEntry({ prompt_sha256: 'b'.repeat(64) }));
    const raw = readFileSync(path, 'utf8');
    // Sanity: only the sha is present.
    expect(raw).toContain('b'.repeat(64));
    // (negative check: there should be no field like "prompt" with text)
    expect(raw).not.toMatch(/"prompt"\s*:/);
  });

  it('rotates when file exceeds maxBytes — shifts .N → .N+1 and starts fresh', () => {
    const log = new JsonlAuditLog({ path, maxBytes: 200, maxFiles: 3 });
    // Write a few entries so we exceed 200 bytes.
    for (let i = 0; i < 5; i++) log.append(askEntry({ user: `u${i}`.repeat(10) }));
    // After rotation, current file exists and has the latest entries; .1 exists with the older block.
    expect(existsSync(path)).toBe(true);
    expect(existsSync(`${path}.1`)).toBe(true);
    // .2 may or may not exist depending on how many rotations occurred.
    // Combined, both files together hold all 5 user prefixes.
    const combined =
      readFileSync(`${path}.1`, 'utf8') +
      (existsSync(`${path}.2`) ? readFileSync(`${path}.2`, 'utf8') : '') +
      readFileSync(path, 'utf8');
    for (let i = 0; i < 5; i++) expect(combined).toContain(`u${i}`.repeat(10));
  });

  it('drops the oldest rotated file when maxFiles is exceeded', () => {
    const log = new JsonlAuditLog({ path, maxBytes: 80, maxFiles: 2 });
    for (let i = 0; i < 20; i++) log.append(askEntry({ user: `u${i}` }));
    // At most maxFiles rotated files exist (.1 and .2). No .3.
    expect(existsSync(`${path}.3`)).toBe(false);
  });

  it('readAll parses the current file, tolerating a malformed trailing line', () => {
    const log = new JsonlAuditLog({ path });
    log.append(askEntry({ user: 'alice' }));
    log.append(askEntry({ user: 'bob' }));
    // Inject garbage on the end.
    writeFileSync(path, readFileSync(path, 'utf8') + 'not-json\n', { mode: 0o600 });
    const entries = log.readAll();
    expect(entries.map((e) => e.user)).toEqual(['alice', 'bob']);
  });

  it('accepts a /chat entry shape', () => {
    const log = new JsonlAuditLog({ path });
    const chat: ChatAuditEntry = {
      route: '/chat',
      ts: '2026-06-02T10:00:00.000Z',
      user: 'alice',
      project: 'app',
      prompt_sha256: 'c'.repeat(64),
      duration_ms: 4200,
      queue_wait_ms: 0,
      uuid: '00000000-0000-0000-0000-000000000000',
      tokens_in: 1024,
      tokens_out: 512,
    };
    log.append(chat);
    const [entry] = log.readAll();
    expect(entry.route).toBe('/chat');
    expect((entry as ChatAuditEntry).uuid).toBe('00000000-0000-0000-0000-000000000000');
  });
});

describe('NoopAuditLog', () => {
  it('append is a no-op', () => {
    const log = new NoopAuditLog();
    expect(() => log.append({} as AskAuditEntry)).not.toThrow();
    expect(log.readAll()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/cli && pnpm vitest run test/agent/audit-log.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/cli/src/agent/audit-log.ts`:

```typescript
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { dirname } from 'node:path';

interface BaseEntry {
  ts: string;
  user: string;
  project: string;
  prompt_sha256: string;
  duration_ms: number;
  queue_wait_ms: number;
}

export interface AskAuditEntry extends BaseEntry {
  route: '/ask';
  files: number;
  lines_added: number;
  lines_removed: number;
  exit_code: number;
}

export interface ChatAuditEntry extends BaseEntry {
  route: '/chat';
  uuid: string;
  tokens_in: number;
  tokens_out: number;
}

export type AuditEntry = AskAuditEntry | ChatAuditEntry;

export interface AuditLog {
  append(entry: AuditEntry): void;
  readAll(): AuditEntry[];
}

export interface JsonlAuditLogOptions {
  path: string;
  maxBytes?: number;
  maxFiles?: number;
}

export class JsonlAuditLog implements AuditLog {
  private readonly path: string;
  private readonly maxBytes: number;
  private readonly maxFiles: number;

  constructor(opts: JsonlAuditLogOptions) {
    this.path = opts.path;
    this.maxBytes = opts.maxBytes ?? 50 * 1024 * 1024;
    this.maxFiles = opts.maxFiles ?? 3;
    mkdirSync(dirname(this.path), { recursive: true });
  }

  append(entry: AuditEntry): void {
    this.rotateIfNeeded();
    appendFileSync(this.path, JSON.stringify(entry) + '\n', { mode: 0o600 });
  }

  readAll(): AuditEntry[] {
    if (!existsSync(this.path)) return [];
    const raw = readFileSync(this.path, 'utf8');
    const out: AuditEntry[] = [];
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line) as AuditEntry);
      } catch {
        // tolerate partial / malformed trailing lines
      }
    }
    return out;
  }

  private rotateIfNeeded(): void {
    if (!existsSync(this.path)) return;
    const size = statSync(this.path).size;
    if (size < this.maxBytes) return;
    // Shift .N → .N+1, dropping anything beyond maxFiles.
    for (let i = this.maxFiles; i >= 1; i--) {
      const src = i === 1 ? this.path : `${this.path}.${i - 1}`;
      const dst = `${this.path}.${i}`;
      if (i === this.maxFiles && existsSync(dst)) {
        // Drop the oldest.
        unlinkSync(dst);
      }
      if (existsSync(src)) {
        renameSync(src, dst);
      }
    }
  }
}

export class NoopAuditLog implements AuditLog {
  append(): void { /* intentional no-op */ }
  readAll(): AuditEntry[] { return []; }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/cli && pnpm vitest run test/agent/audit-log.test.ts
```

Expected: PASS, 9 tests (8 JsonlAuditLog + 1 NoopAuditLog).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/audit-log.ts packages/cli/test/agent/audit-log.test.ts
git commit -m "feat(agent): JsonlAuditLog with size rotation + NoopAuditLog for tests"
```

---

## Task 2: `diff-stats.ts` helper

A tiny pure function: given a unified diff string, return `{ linesAdded, linesRemoved }` by counting `+` / `-` body lines (excluding the `+++` / `---` file headers).

**Files:**
- Create: `packages/cli/src/agent/diff-stats.ts`
- Test: `packages/cli/test/agent/diff-stats.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/cli/test/agent/diff-stats.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { countDiffLines } from '../../src/agent/diff-stats.ts';

describe('countDiffLines', () => {
  it('returns zeros for empty input', () => {
    expect(countDiffLines('')).toEqual({ linesAdded: 0, linesRemoved: 0 });
  });

  it('counts + and - body lines, excluding +++/--- file headers', () => {
    const diff = [
      'diff --git a/a.txt b/a.txt',
      'index 1111..2222 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,3 +1,3 @@',
      '-old line',
      '+new line',
      ' unchanged',
      '+extra',
    ].join('\n');
    expect(countDiffLines(diff)).toEqual({ linesAdded: 2, linesRemoved: 1 });
  });

  it('handles multiple files', () => {
    const diff = [
      'diff --git a/a b/a',
      '--- a/a',
      '+++ b/a',
      '@@ -1,1 +1,2 @@',
      ' x',
      '+y',
      'diff --git a/b b/b',
      '--- a/b',
      '+++ b/b',
      '@@ -1,2 +1,1 @@',
      ' x',
      '-z',
    ].join('\n');
    expect(countDiffLines(diff)).toEqual({ linesAdded: 1, linesRemoved: 1 });
  });

  it('handles new file creation (only + lines)', () => {
    const diff = [
      'diff --git a/c b/c',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/c',
      '@@ -0,0 +1,2 @@',
      '+first',
      '+second',
    ].join('\n');
    expect(countDiffLines(diff)).toEqual({ linesAdded: 2, linesRemoved: 0 });
  });

  it('ignores lines that look like headers but only at the start of a hunk', () => {
    // A body line starting with --- or +++ (rare in practice) would be 3-char prefixed;
    // the simple rule we use: lines starting with exactly "+++" or "---" are headers.
    const diff = [
      '--- a/x',
      '+++ b/x',
      '@@ -1 +1 @@',
      '-abc',
      '+def',
    ].join('\n');
    expect(countDiffLines(diff)).toEqual({ linesAdded: 1, linesRemoved: 1 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd packages/cli && pnpm vitest run test/agent/diff-stats.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `packages/cli/src/agent/diff-stats.ts`:

```typescript
export interface DiffStats {
  linesAdded: number;
  linesRemoved: number;
}

/**
 * Count `+` / `-` body lines in a unified diff, excluding the `+++` / `---`
 * file-header lines. No tolerance for context-prefixed lines (e.g. ` +foo` —
 * leading whitespace means context line).
 */
export function countDiffLines(diff: string): DiffStats {
  if (!diff) return { linesAdded: 0, linesRemoved: 0 };
  let linesAdded = 0;
  let linesRemoved = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) linesAdded++;
    else if (line.startsWith('-')) linesRemoved++;
  }
  return { linesAdded, linesRemoved };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/cli && pnpm vitest run test/agent/diff-stats.test.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/diff-stats.ts packages/cli/test/agent/diff-stats.test.ts
git commit -m "feat(agent): countDiffLines helper for audit lines_added/removed"
```

---

## Task 3: Server writes audit entries on `/ask` and `/chat`

`AgentOptions` gains `auditLog: AuditLog`. `/ask` (on the success path, after `captureDiff` and before `concurrency.release(lease)`) computes the prompt hash, counts diff lines, and appends. `/chat` does the equivalent inside the `chat_done` branch of the emit wrapper.

Existing `buildServer` tests don't care about audit; we wire them with a `NoopAuditLog`.

**Files:**
- Modify: `packages/cli/src/agent/server.ts`
- Modify: `packages/cli/test/agent.test.ts` (pass `NoopAuditLog` into all `buildServer({...})` calls; verify audit lines appear on successful `/ask`)
- Modify: `packages/cli/test/agent/auth-multi-user.test.ts` (pass `NoopAuditLog` into the helper)

- [ ] **Step 1: Update `src/agent/server.ts`**

Add imports near the existing agent-module imports:

```typescript
import { createHash } from 'node:crypto';
import type { AuditLog } from './audit-log.ts';
import { countDiffLines } from './diff-stats.ts';
```

Update `AgentOptions` to add `auditLog: AuditLog` (REQUIRED). Place it right after `concurrency?: ConcurrencyManager;`:

```typescript
  /** Audit log sink. Required — use NoopAuditLog in tests that don't care. */
  auditLog: AuditLog;
```

Inside `/ask`, locate the existing success-path return statement:

```typescript
      return {
        diff: diffData.diff,
        files: diffData.files,
        durationMs: Date.now() - start,
        stdout: claudeResult.stdout,
        stderr: claudeResult.stderr,
        exitCode: claudeResult.exitCode,
      };
```

Just BEFORE that `return`, append the audit line:

```typescript
      const durationMs = Date.now() - start;
      const stats = countDiffLines(diffData.diff);
      opts.auditLog.append({
        route: '/ask',
        ts: new Date().toISOString(),
        user: username,
        project,
        prompt_sha256: createHash('sha256').update(prompt).digest('hex'),
        files: diffData.files.length,
        lines_added: stats.linesAdded,
        lines_removed: stats.linesRemoved,
        duration_ms: durationMs,
        queue_wait_ms: lease.queueWaitMs,
        exit_code: claudeResult.exitCode,
      });
      return {
        diff: diffData.diff,
        files: diffData.files,
        durationMs,
        stdout: claudeResult.stdout,
        stderr: claudeResult.stderr,
        exitCode: claudeResult.exitCode,
      };
```

(Note: I introduced a local `durationMs` so the audit entry and the response use the same value. The existing inline `durationMs: Date.now() - start` becomes a reference to the local.)

Inside `/chat`, the emit wrapper currently does:

```typescript
          emit: (e) => {
            if (e.type === 'chat_done') {
              turns.complete(body.uuid, {
                tokensIn: e.tokensIn,
                tokensOut: e.tokensOut,
                durationMs: e.durationMs,
              });
            }
            emit(e);
          },
```

Extend the `chat_done` branch to also append an audit entry:

```typescript
          emit: (e) => {
            if (e.type === 'chat_done') {
              turns.complete(body.uuid, {
                tokensIn: e.tokensIn,
                tokensOut: e.tokensOut,
                durationMs: e.durationMs,
              });
              opts.auditLog.append({
                route: '/chat',
                ts: new Date().toISOString(),
                user: username,
                project: body.projectName,
                prompt_sha256: createHash('sha256').update(body.prompt).digest('hex'),
                uuid: body.uuid,
                tokens_in: e.tokensIn,
                tokens_out: e.tokensOut,
                duration_ms: e.durationMs,
                queue_wait_ms: lease.queueWaitMs,
              });
            }
            emit(e);
          },
```

(`username` and `lease` are both already in scope inside the `/chat` handler thanks to phases 2 and 3.)

- [ ] **Step 2: Update `test/agent.test.ts`**

Add the import at the top, just below the existing `import { UsersStore } from '../src/agent/users-store.ts';`:

```typescript
import { JsonlAuditLog, NoopAuditLog } from '../src/agent/audit-log.ts';
import { join as pathJoin } from 'node:path';
```

(Aliasing `join` to `pathJoin` avoids a name collision if `join` is already imported.)

In every existing `buildServer({...})` call inside the file (there are 7), add `auditLog: new NoopAuditLog(),` to the options object (anywhere; convention: just below `version: ...`).

Then ADD one new test at the end of the `describe('agent server', ...)` block to prove an audit line is written on a successful `/ask`:

```typescript
  it('writes an audit line after a successful /ask', async () => {
    fakeClaudeBin = await makeFakeClaude(`printf 'three-edited\\n' >> a.txt`);
    const auditPath = pathJoin(projectsRoot, 'audit.log');
    const log = new JsonlAuditLog({ path: auditPath });
    const app = buildServer({
      usersStore: makeStore(),
      projectsRoot,
      aiCommand: fakeClaudeBin, aiArgs: [],
      timeoutSec: 10, version: 'x',
      auditLog: log,
    });
    const res = await app.inject({
      method: 'POST', url: '/ask',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      payload: { prompt: 'edit it', project: 'sample' },
    });
    expect(res.statusCode).toBe(200);
    const entries = log.readAll();
    expect(entries).toHaveLength(1);
    const e = entries[0] as { route: string; user: string; project: string; lines_added: number; prompt_sha256: string };
    expect(e.route).toBe('/ask');
    expect(e.user).toBe('tester');
    expect(e.project).toBe('sample');
    expect(e.lines_added).toBeGreaterThan(0);
    expect(e.prompt_sha256).toMatch(/^[0-9a-f]{64}$/);
    await app.close();
  });
```

Note: the existing tests' `projectDir` lives at `projectsRoot/tester/sample/` (phase 2 fixture). This new test uses project `sample` so the path resolves the same way.

- [ ] **Step 3: Update `test/agent/auth-multi-user.test.ts`**

Add the import at the top:

```typescript
import { NoopAuditLog } from '../../src/agent/audit-log.ts';
```

In the existing `app()` helper inside `describe('server auth hook (multi-user)', ...)`, add `auditLog: new NoopAuditLog(),` to the `buildServer` call.

- [ ] **Step 4: Run all related tests + typecheck**

```bash
cd packages/cli && pnpm vitest run test/agent.test.ts test/agent/ && pnpm typecheck
```

Expected: ALL PASS, plus the new audit-line test (1 extra in `test/agent.test.ts`).

If TypeScript complains about `auditLog` being required in OTHER test files (e.g., `test/integration/multi-user.e2e.test.ts`, `test/integration/per-user-paths.e2e.test.ts`, `test/integration/concurrency.e2e.test.ts`, `test/commands/whoami.test.ts`), pass `auditLog: new NoopAuditLog(),` in each — they import `buildServer` too.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/agent/server.ts packages/cli/test/agent.test.ts packages/cli/test/agent/auth-multi-user.test.ts packages/cli/test/integration packages/cli/test/commands/whoami.test.ts
git commit -m "feat(agent): write audit entries on successful /ask and /chat"
```

(Only stage the test files you actually had to modify. `git status --short` after Step 4 will show the actual set.)

---

## Task 4: `runServe` constructs a `JsonlAuditLog` from env

New env var `PW_AUDIT_LOG` (path; default `~/.patchwire/agent.log`). Optional `PW_AUDIT_LOG_MAX_BYTES` (default `50 * 1024 * 1024`) and `PW_AUDIT_LOG_MAX_FILES` (default `3`).

**File:**
- Modify: `packages/cli/src/agent.ts`

- [ ] **Step 1: Edit `src/agent.ts`**

Add the import near the other agent-module imports:

```typescript
import { JsonlAuditLog } from './agent/audit-log.ts';
```

Inside `runServe()`, AFTER the `ConcurrencyManager` construction and BEFORE the `buildServer({...})` call, add:

```typescript
  const auditLogPath = process.env.PW_AUDIT_LOG ?? join(homedir(), '.patchwire', 'agent.log');
  const auditMaxBytes = process.env.PW_AUDIT_LOG_MAX_BYTES
    ? Number(process.env.PW_AUDIT_LOG_MAX_BYTES)
    : undefined;
  const auditMaxFiles = process.env.PW_AUDIT_LOG_MAX_FILES
    ? Number(process.env.PW_AUDIT_LOG_MAX_FILES)
    : undefined;
  const auditLog = new JsonlAuditLog({
    path: auditLogPath,
    ...(auditMaxBytes !== undefined ? { maxBytes: auditMaxBytes } : {}),
    ...(auditMaxFiles !== undefined ? { maxFiles: auditMaxFiles } : {}),
  });
```

Pass it to `buildServer`:

```typescript
  const app = buildServer({
    usersStore,
    projectsRoot,
    aiCommand,
    aiArgs,
    timeoutSec,
    version: VERSION,
    concurrency,
    auditLog,
  });
```

After the existing `concurrency: global=…, per_user=…` log line, add:

```typescript
    app.log.info(`audit log: ${auditLogPath}`);
```

- [ ] **Step 2: Typecheck**

```bash
cd packages/cli && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/agent.ts
git commit -m "feat(agent): construct JsonlAuditLog from PW_AUDIT_LOG env"
```

---

## Task 5: `patchwire-agent log` CLI subcommand + log reader

Reader semantics: read the live file first, then `.1`, `.2`, ... in order. Each file's lines are in chronological append order; combined, we sort by `ts` ascending. Filters: `--user`, `--project`, `--since <duration>`, `--limit <n>` (default 100). Output: pretty by default; `--json` for raw passthrough.

**Files:**
- Create: `packages/cli/src/agent/log-reader.ts`
- Create: `packages/cli/src/commands/agent-log.ts`
- Modify: `packages/cli/src/agent.ts` (register the subcommand)
- Test: `packages/cli/test/agent/log-reader.test.ts`
- Test: `packages/cli/test/commands/agent-log.test.ts`

- [ ] **Step 1: Write tests for the reader**

Create `packages/cli/test/agent/log-reader.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readEntries } from '../../src/agent/log-reader.ts';
import { JsonlAuditLog, type AskAuditEntry } from '../../src/agent/audit-log.ts';

describe('readEntries', () => {
  let dir: string;
  let basePath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-logread-'));
    basePath = join(dir, 'agent.log');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function ask(over: Partial<AskAuditEntry>): AskAuditEntry {
    return {
      route: '/ask',
      ts: '2026-06-02T10:00:00.000Z',
      user: 'alice',
      project: 'app',
      prompt_sha256: 'a'.repeat(64),
      files: 1, lines_added: 0, lines_removed: 0,
      duration_ms: 100, queue_wait_ms: 0, exit_code: 0,
      ...over,
    };
  }

  it('returns [] when no log files exist', () => {
    expect(readEntries({ basePath })).toEqual([]);
  });

  it('reads the live file', () => {
    const log = new JsonlAuditLog({ path: basePath });
    log.append(ask({ user: 'alice', ts: '2026-06-02T10:00:00.000Z' }));
    log.append(ask({ user: 'bob', ts: '2026-06-02T10:01:00.000Z' }));
    const entries = readEntries({ basePath });
    expect(entries.map((e) => e.user)).toEqual(['alice', 'bob']);
  });

  it('reads rotated files (.1, .2) alongside the live file, sorted by ts asc', () => {
    // Forge a layered set: .2 = oldest, .1 = middle, live = newest
    writeFileSync(`${basePath}.2`, JSON.stringify(ask({ user: 'old', ts: '2026-06-01T00:00:00.000Z' })) + '\n');
    writeFileSync(`${basePath}.1`, JSON.stringify(ask({ user: 'mid', ts: '2026-06-01T12:00:00.000Z' })) + '\n');
    writeFileSync(basePath, JSON.stringify(ask({ user: 'new', ts: '2026-06-02T10:00:00.000Z' })) + '\n');
    const entries = readEntries({ basePath });
    expect(entries.map((e) => e.user)).toEqual(['old', 'mid', 'new']);
  });

  it('filter: user', () => {
    const log = new JsonlAuditLog({ path: basePath });
    log.append(ask({ user: 'alice' }));
    log.append(ask({ user: 'bob' }));
    log.append(ask({ user: 'alice' }));
    const e = readEntries({ basePath, filter: { user: 'alice' } });
    expect(e.map((x) => x.user)).toEqual(['alice', 'alice']);
  });

  it('filter: project', () => {
    const log = new JsonlAuditLog({ path: basePath });
    log.append(ask({ project: 'app-a' }));
    log.append(ask({ project: 'app-b' }));
    const e = readEntries({ basePath, filter: { project: 'app-a' } });
    expect(e.map((x) => x.project)).toEqual(['app-a']);
  });

  it('filter: since (ISO timestamp comparison)', () => {
    const log = new JsonlAuditLog({ path: basePath });
    log.append(ask({ ts: '2026-06-01T10:00:00.000Z' }));
    log.append(ask({ ts: '2026-06-02T10:00:00.000Z' }));
    const e = readEntries({ basePath, filter: { sinceMs: Date.parse('2026-06-02T00:00:00Z') } });
    expect(e).toHaveLength(1);
    expect(e[0].ts).toBe('2026-06-02T10:00:00.000Z');
  });

  it('filter: limit returns the LAST N entries (newest)', () => {
    const log = new JsonlAuditLog({ path: basePath });
    for (let i = 0; i < 10; i++) {
      log.append(ask({ user: `u${i}`, ts: `2026-06-02T10:0${i}:00.000Z` }));
    }
    const e = readEntries({ basePath, filter: { limit: 3 } });
    expect(e.map((x) => x.user)).toEqual(['u7', 'u8', 'u9']);
  });
});
```

- [ ] **Step 2: Run reader tests — expect FAIL**

```bash
cd packages/cli && pnpm vitest run test/agent/log-reader.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the reader**

Create `packages/cli/src/agent/log-reader.ts`:

```typescript
import { existsSync, readFileSync } from 'node:fs';
import type { AuditEntry } from './audit-log.ts';

export interface LogFilter {
  user?: string;
  project?: string;
  /** Unix ms; entries with ts >= sinceMs are included. */
  sinceMs?: number;
  /** Return at most the LAST N entries (after sort). */
  limit?: number;
}

export interface ReadEntriesInput {
  basePath: string;
  filter?: LogFilter;
  /** How many rotated files to scan beyond the live one. Default: 10. */
  maxRotated?: number;
}

/**
 * Read audit entries from the live file plus rotated tail (.1, .2, ...).
 * Returns entries sorted by `ts` ascending. Tolerates partial/malformed lines.
 */
export function readEntries(input: ReadEntriesInput): AuditEntry[] {
  const maxRotated = input.maxRotated ?? 10;
  const paths: string[] = [];
  // Oldest first: .N, .N-1, ..., .1, live
  for (let i = maxRotated; i >= 1; i--) {
    const p = `${input.basePath}.${i}`;
    if (existsSync(p)) paths.push(p);
  }
  if (existsSync(input.basePath)) paths.push(input.basePath);

  const all: AuditEntry[] = [];
  for (const p of paths) {
    const raw = readFileSync(p, 'utf8');
    for (const line of raw.split('\n')) {
      if (!line) continue;
      try {
        all.push(JSON.parse(line) as AuditEntry);
      } catch {
        /* tolerate */
      }
    }
  }

  all.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  const f = input.filter ?? {};
  const filtered = all.filter((e) => {
    if (f.user && e.user !== f.user) return false;
    if (f.project && e.project !== f.project) return false;
    if (f.sinceMs !== undefined && Date.parse(e.ts) < f.sinceMs) return false;
    return true;
  });

  if (f.limit !== undefined && filtered.length > f.limit) {
    return filtered.slice(-f.limit);
  }
  return filtered;
}
```

- [ ] **Step 4: Run reader tests — expect PASS**

```bash
cd packages/cli && pnpm vitest run test/agent/log-reader.test.ts
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Write tests for the CLI command**

Create `packages/cli/test/commands/agent-log.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { registerAgentLogCommand } from '../../src/commands/agent-log.ts';
import { JsonlAuditLog, type AskAuditEntry } from '../../src/agent/audit-log.ts';

describe('patchwire-agent log', () => {
  let dir: string;
  let basePath: string;
  let logs: string[];
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pw-log-cmd-'));
    basePath = join(dir, 'agent.log');
    process.env.PW_AUDIT_LOG = basePath;
    logs = [];
    logSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      logs.push(String(chunk));
      return true;
    });
  });
  afterEach(() => {
    logSpy.mockRestore();
    delete process.env.PW_AUDIT_LOG;
    rmSync(dir, { recursive: true, force: true });
  });

  function ask(over: Partial<AskAuditEntry>): AskAuditEntry {
    return {
      route: '/ask',
      ts: '2026-06-02T10:00:00.000Z',
      user: 'alice', project: 'app',
      prompt_sha256: 'a'.repeat(64),
      files: 1, lines_added: 0, lines_removed: 0,
      duration_ms: 100, queue_wait_ms: 0, exit_code: 0,
      ...over,
    };
  }

  function run(argv: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerAgentLogCommand(program);
    return program.parseAsync(['node', 'patchwire-agent', ...argv]);
  }

  it('prints "(no entries)" when the log is empty', async () => {
    await run(['log']);
    expect(logs.join('')).toContain('(no entries)');
  });

  it('pretty-prints recent entries by default', async () => {
    const log = new JsonlAuditLog({ path: basePath });
    log.append(ask({ user: 'alice', project: 'app-a' }));
    log.append(ask({ user: 'bob', project: 'app-b' }));
    await run(['log']);
    const out = logs.join('');
    expect(out).toMatch(/alice/);
    expect(out).toMatch(/bob/);
    expect(out).toMatch(/app-a/);
    expect(out).toMatch(/app-b/);
  });

  it('--user filters', async () => {
    const log = new JsonlAuditLog({ path: basePath });
    log.append(ask({ user: 'alice' }));
    log.append(ask({ user: 'bob' }));
    await run(['log', '--user', 'alice']);
    const out = logs.join('');
    expect(out).toMatch(/alice/);
    expect(out).not.toMatch(/bob/);
  });

  it('--json outputs raw JSONL', async () => {
    const log = new JsonlAuditLog({ path: basePath });
    log.append(ask({ user: 'alice' }));
    await run(['log', '--json']);
    const out = logs.join('').trim();
    const parsed = JSON.parse(out);
    expect(parsed.user).toBe('alice');
  });

  it('--limit caps the count', async () => {
    const log = new JsonlAuditLog({ path: basePath });
    for (let i = 0; i < 5; i++) log.append(ask({ user: `u${i}`, ts: `2026-06-02T10:0${i}:00.000Z` }));
    await run(['log', '--limit', '2', '--json']);
    const lines = logs.join('').trim().split('\n');
    expect(lines).toHaveLength(2);
  });
});
```

- [ ] **Step 6: Run CLI tests — expect FAIL**

```bash
cd packages/cli && pnpm vitest run test/commands/agent-log.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 7: Implement the CLI command**

Create `packages/cli/src/commands/agent-log.ts`:

```typescript
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { readEntries, type LogFilter } from '../agent/log-reader.ts';
import type { AuditEntry, AskAuditEntry, ChatAuditEntry } from '../agent/audit-log.ts';

const DURATION_RE = /^(\d+)\s*(s|m|h|d)$/;

function parseSince(value: string): number {
  const m = value.match(DURATION_RE);
  if (!m) {
    throw new Error(`--since must look like '15m', '6h', '7d', '30s' (got '${value}')`);
  }
  const n = Number(m[1]);
  const unit = m[2];
  const ms = unit === 's' ? 1000
    : unit === 'm' ? 60 * 1000
    : unit === 'h' ? 60 * 60 * 1000
    : 24 * 60 * 60 * 1000;
  return Date.now() - n * ms;
}

function basePath(): string {
  return process.env.PW_AUDIT_LOG ?? join(homedir(), '.patchwire', 'agent.log');
}

function pretty(entry: AuditEntry): string {
  const ts = entry.ts;
  const base = `${ts}  ${entry.user.padEnd(10)} ${entry.project.padEnd(20)} ${entry.route}`;
  if (entry.route === '/ask') {
    const a = entry as AskAuditEntry;
    return `${base}  files=${a.files} +${a.lines_added}/-${a.lines_removed} dur=${a.duration_ms}ms wait=${a.queue_wait_ms}ms exit=${a.exit_code}`;
  }
  const c = entry as ChatAuditEntry;
  return `${base}  uuid=${c.uuid.slice(0, 8)} tokens_in=${c.tokens_in} tokens_out=${c.tokens_out} dur=${c.duration_ms}ms wait=${c.queue_wait_ms}ms`;
}

export function registerAgentLogCommand(program: Command): void {
  program
    .command('log')
    .description('Tail the audit log (filtered)')
    .option('--user <name>', 'show only this user')
    .option('--project <name>', 'show only this project')
    .option('--since <duration>', "show only entries newer than this (e.g. '30m', '6h', '7d')")
    .option('--limit <n>', 'show only the last N entries (default 100)', (v) => Number(v))
    .option('--json', 'emit raw JSONL instead of pretty text')
    .action((opts: { user?: string; project?: string; since?: string; limit?: number; json?: boolean }) => {
      const filter: LogFilter = {};
      if (opts.user) filter.user = opts.user;
      if (opts.project) filter.project = opts.project;
      if (opts.since) filter.sinceMs = parseSince(opts.since);
      filter.limit = opts.limit ?? 100;
      const entries = readEntries({ basePath: basePath(), filter });
      if (entries.length === 0) {
        process.stdout.write('(no entries)\n');
        return;
      }
      if (opts.json) {
        for (const e of entries) process.stdout.write(JSON.stringify(e) + '\n');
        return;
      }
      for (const e of entries) process.stdout.write(pretty(e) + '\n');
    });
}
```

- [ ] **Step 8: Wire it into `src/agent.ts`**

Add the import:

```typescript
import { registerAgentLogCommand } from './commands/agent-log.ts';
```

After the existing `registerUserCommands(program);` line, add:

```typescript
registerAgentLogCommand(program);
```

- [ ] **Step 9: Run all CLI + reader tests + typecheck**

```bash
cd packages/cli && pnpm vitest run test/agent/log-reader.test.ts test/commands/agent-log.test.ts && pnpm typecheck
```

Expected: PASS (7 reader + 5 CLI).

- [ ] **Step 10: Commit**

```bash
git add packages/cli/src/agent/log-reader.ts packages/cli/src/commands/agent-log.ts packages/cli/src/agent.ts packages/cli/test/agent/log-reader.test.ts packages/cli/test/commands/agent-log.test.ts
git commit -m "feat(agent): patchwire-agent log subcommand + log reader with filters"
```

---

## Task 6: Documentation refresh

**Files:**
- Modify: `packages/website/src/content/docs/configuration.md` — document `PW_AUDIT_LOG` + companions
- Modify: `packages/website/src/content/docs/agent.md` — describe audit log + `patchwire-agent log`

- [ ] **Step 1: Read each file first**

```bash
cat packages/website/src/content/docs/configuration.md
cat packages/website/src/content/docs/agent.md
```

- [ ] **Step 2: Add env vars to `configuration.md`**

In the "Agent environment variables" table, after the `PW_MAX_CONCURRENT_PER_USER` row (added in phase 3), add:

```markdown
| `PW_AUDIT_LOG` | no | `~/.patchwire/agent.log` | JSONL audit log path. One line per successful `/ask` or `/chat` turn. No plaintext prompts (only sha256). |
| `PW_AUDIT_LOG_MAX_BYTES` | no | `52428800` (50 MiB) | Size threshold that triggers rotation to `.1`. |
| `PW_AUDIT_LOG_MAX_FILES` | no | `3` | How many rotated tail files to keep (`.1`, `.2`, `.3`). Older files are dropped. |
```

- [ ] **Step 3: Add an audit-log section to `agent.md`**

After the "Concurrency + queue" section (added in phase 3), add:

```markdown
### Audit log (v0.2.3+)

Every successful `/ask` and `/chat` turn appends one JSONL line to
`~/.patchwire/agent.log` (override via `PW_AUDIT_LOG`). The line records:

- `ts`, `user`, `project`, `route`
- `prompt_sha256` — SHA-256 of the prompt text. Plaintext is never persisted.
- For `/ask`: `files`, `lines_added`, `lines_removed`, `exit_code`
- For `/chat`: `uuid`, `tokens_in`, `tokens_out`
- `duration_ms`, `queue_wait_ms`

The file is size-rotated to `.1`, `.2`, ... on a 50 MiB threshold (configurable
via `PW_AUDIT_LOG_MAX_BYTES` / `PW_AUDIT_LOG_MAX_FILES`).

View it with the new subcommand:

```bash
patchwire-agent log                        # last 100, pretty
patchwire-agent log --user alice --since 24h
patchwire-agent log --project flutter-app --limit 10
patchwire-agent log --json                  # raw JSONL (pipe into jq)
```

Reader looks at the live file plus rotated tail and prints in chronological
order, applying filters before the limit.
```

- [ ] **Step 4: Commit**

```bash
git add packages/website/src/content/docs/configuration.md packages/website/src/content/docs/agent.md
git commit -m "docs: audit log + patchwire-agent log CLI (v0.2 phase 4)"
```

If `git show --stat HEAD` shows MORE than these two files, investigate.

---

## Final verification

- [ ] **Step 1: Full pipeline**

```bash
cd packages/cli && pnpm verify
```

Expected: typecheck, tests, build, smoke all green (modulo the known environmental flake in `test/agent.test.ts:161`).

- [ ] **Step 2: Tag**

```bash
git tag -a v0.2.3-phase4 -m "Phase 4: JSONL audit log + patchwire-agent log CLI"
```

---

## Spec coverage check

| Spec requirement | Covered by |
|---|---|
| JSONL audit log at `~/.patchwire/agent.log` | Task 1 (`JsonlAuditLog`), Task 4 (boot path) |
| Metadata only, no plaintext prompts | Task 1 (entry schema), Task 3 (sha256 only) |
| Size rotation (default 50 MiB, `.1` … `.N`) | Task 1 (`rotateIfNeeded` + maxFiles) |
| 0o600 file mode | Task 1 (`appendFileSync mode: 0o600`) |
| `/ask` and `/chat` write entries on success | Task 3 |
| `patchwire-agent log` CLI w/ `--user --project --since --limit --json` | Task 5 |
| Reader merges live + rotated tail, sorted by `ts` | Task 5 (`readEntries`) |
| `PW_AUDIT_LOG` env var override | Task 4 |
| Docs updated | Task 6 |
