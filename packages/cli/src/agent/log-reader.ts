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
