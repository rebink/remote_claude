import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Command } from 'commander';
import { readEntries, type LogFilter } from '../agent/log-reader.ts';
import { parseSince } from './agent-log.ts';
import { aggregateUsage, humanizeMs, type UserUsage } from '../agent/usage.ts';

function basePath(): string {
  return process.env.PW_AUDIT_LOG ?? join(homedir(), '.patchwire', 'agent.log');
}

/** Humanize a token count: "880", "12.3k", "1.2M". */
function humanizeTokens(n: number): string {
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** "$1.23" (reported), "~$1.23" (estimated), or "—" when no cost was recorded. */
function formatCost(u: UserUsage): string {
  if (!u.has_cost) return '—';
  return `${u.cost_estimated ? '~$' : '$'}${u.cost_usd.toFixed(2)}`;
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
    humanizeTokens(u.tokens_in + u.tokens_out).padStart(8) +
    formatCost(u).padStart(9) +
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

      // --json always emits the structured report (even when empty) so JSON consumers never see the human sentinel.
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
        'ASK'.padStart(6) + 'CHAT'.padStart(6) + '+LN'.padStart(8) + '-LN'.padStart(8) +
        'TOK'.padStart(8) + '$EQV'.padStart(9) + '  DUR';
      process.stdout.write(header + '\n');
      for (const u of report.users) process.stdout.write(row(u) + '\n');
      process.stdout.write('─'.repeat(74) + '\n');
      process.stdout.write(row(report.totals) + '\n');
      if (report.totals.has_cost) {
        process.stdout.write(
          '\n$EQV = API-equivalent cost (provider-reported; ~ = estimated from a price table).\n' +
          'With a flat-rate subscription this is attribution across the team, not extra spend.\n',
        );
      }
    });
}
