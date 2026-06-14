import type { HostRecord } from './host-record.ts';
import type { ProvisionArgs } from './ipc.ts';

export function recordToFormValues(r: HostRecord): { [K in keyof Omit<ProvisionArgs, 'token'>]: string } {
  return { host: r.host, user: r.user, port: String(r.port), keyPath: r.keyPath, agentPort: String(r.agentPort) };
}

export function hostBadge(r: HostRecord): { text: string; cls: string } {
  if (r.lastStatus !== 'completed') return { text: 'failed', cls: 'badge-failed' };
  if (r.lastHealth && r.lastHealth !== 'healthy') return { text: r.lastHealth, cls: 'badge-warn' };
  return { text: r.lastHealth ?? 'ok', cls: 'badge-ok' };
}
