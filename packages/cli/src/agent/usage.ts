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
