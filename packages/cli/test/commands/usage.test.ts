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
