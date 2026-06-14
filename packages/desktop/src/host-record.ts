import type { ProvisionArgs } from './ipc.ts';
export interface HostRecord {
  id: string; label: string; host: string; user: string; port: number; keyPath: string;
  agentPort: number; lastStatus: string; lastHealth?: string; lastProvisionedAt: string;
}
export function buildHostRecord(
  args: ProvisionArgs,
  result: { status: string; health?: { tailnet: boolean; agent: string } },
  id: string, now: string,
): HostRecord {
  return {
    id, label: `${args.user}@${args.host}`, host: args.host, user: args.user, port: args.port,
    keyPath: args.keyPath, agentPort: args.agentPort, lastStatus: result.status,
    lastHealth: result.health?.agent, lastProvisionedAt: now,
  };
}
