import { loadConfig } from '../lib/config.ts';
import { AgentClient } from '../lib/client.ts';

export async function runWhoami(cwd: string): Promise<void> {
  const cfg = await loadConfig(cwd);
  const client = new AgentClient(cfg);
  const me = await client.whoami();
  const created = me.createdAt ? `created ${me.createdAt}` : 'no created date';
  const seen = me.lastSeen ? `last seen ${me.lastSeen}` : 'never seen before';
  const status = me.disabled ? ' [DISABLED]' : '';
  process.stdout.write(`${me.user}${status} (${created}, ${seen})\n`);
}
