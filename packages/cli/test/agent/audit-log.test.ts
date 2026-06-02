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

  it('rotates when file exceeds maxBytes — shifts .N → .N+1, dropping the oldest', () => {
    const log = new JsonlAuditLog({ path, maxBytes: 200, maxFiles: 3 });
    // Each entry (~280 bytes) exceeds maxBytes, so every append after the first
    // rotates: one entry per file. With maxFiles: 3 the survivors are live + .1 +
    // .2 + .3 (the newest 4); the oldest (u0) is correctly dropped.
    for (let i = 0; i < 5; i++) log.append(askEntry({ user: `u${i}`.repeat(10) }));
    expect(existsSync(path)).toBe(true);
    expect(existsSync(`${path}.1`)).toBe(true);
    // Combined across the live file and every rotated tail file that exists.
    let combined = readFileSync(path, 'utf8');
    for (let i = 1; i <= 3; i++) {
      const p = `${path}.${i}`;
      if (existsSync(p)) combined += readFileSync(p, 'utf8');
    }
    // Newest 4 entries survive; the oldest was dropped per "drop the oldest".
    for (let i = 1; i < 5; i++) expect(combined).toContain(`u${i}`.repeat(10));
    expect(combined).not.toContain(`u0`.repeat(10));
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
