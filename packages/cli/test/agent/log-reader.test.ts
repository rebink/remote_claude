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
