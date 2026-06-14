export interface LogEntry { ts?: string; user?: string; project?: string; route?: string; [k: string]: unknown }
export function parseHostLogs(line: string): { ok: boolean; entries: LogEntry[]; detail?: string } {
  try {
    const r = JSON.parse(line) as { ok?: boolean; entries?: LogEntry[]; detail?: string };
    if (r.ok) return { ok: true, entries: r.entries ?? [] };
    return { ok: false, entries: [], detail: r.detail };
  } catch {
    return { ok: false, entries: [] };
  }
}
export function formatLogEntry(e: LogEntry): string {
  return `${e.ts ?? '?'}  ${e.user ?? '?'}  ${e.project ?? '?'}  ${e.route ?? '?'}`;
}
