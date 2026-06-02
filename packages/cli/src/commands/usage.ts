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
