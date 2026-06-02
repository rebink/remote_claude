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
