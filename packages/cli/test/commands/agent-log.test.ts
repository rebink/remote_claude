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
