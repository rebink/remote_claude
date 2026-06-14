export function parseHostHealth(line: string): { text: string; cls: string } {
  try {
    const r = JSON.parse(line) as { ok?: boolean; healthy?: boolean; version?: string; code?: string };
    if (r.ok && r.healthy) return { text: `healthy${r.version ? ` ${r.version}` : ''}`, cls: 'badge-ok' };
    if (r.ok && !r.healthy) return { text: 'unhealthy', cls: 'badge-warn' };
    return { text: r.code ?? 'unreachable', cls: 'badge-failed' };
  } catch {
    return { text: 'error', cls: 'badge-failed' };
  }
}
