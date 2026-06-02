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

  it('--json on an empty log emits an empty structured report (not the sentinel)', async () => {
    await run(['usage', '--json']);
    const out = logs.join('').trim();
    const report = JSON.parse(out); // must be valid JSON
    expect(report.users).toEqual([]);
    expect(report.totals.requests).toBe(0);
    expect(out).not.toContain('(no usage yet)');
  });

  it('--project filters to one project', async () => {
    const log = new JsonlAuditLog({ path: basePath });
    log.append(ask({ user: 'alice', project: 'app' }));
    log.append(ask({ user: 'bob', project: 'other' }));
    await run(['usage', '--project', 'app', '--json']);
    const report = JSON.parse(logs.join('').trim());
    expect(report.users).toHaveLength(1);
    expect(report.users[0].user).toBe('alice');
  });

  it('--since excludes entries older than the window', async () => {
    const log = new JsonlAuditLog({ path: basePath });
    log.append(ask({ user: 'old', ts: '2000-01-01T00:00:00.000Z' }));
    log.append(ask({ user: 'recent', ts: new Date().toISOString() }));
    await run(['usage', '--since', '1h', '--json']);
    const report = JSON.parse(logs.join('').trim());
    expect(report.users).toHaveLength(1);
    expect(report.users[0].user).toBe('recent');
    expect(report.totals.requests).toBe(1);
  });
});
