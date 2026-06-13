/**
 * Real-host validation EXECUTE — detect → plan → consent(YES) → execute → health.
 * MUTATES the target host (installs agent, launchd service, writes secret).
 * Usage: tsx scripts/validate-execute.ts <host> <user> <keyPath> [port]
 */
import { randomBytes } from 'node:crypto';
import { provisionRemote, type PreviewEvent } from '../src/agent/provision/provision-remote.ts';
import type { RemoteConn } from '../src/agent/provision/remote-detect.ts';
import type { ProvisionEvent } from '../src/agent/provision/types.ts';

const [host = '127.0.0.1', user = 'apple', keyPath = `${process.env.HOME}/.ssh/pw_validate`, portArg] =
  process.argv.slice(2);
const conn: RemoteConn = { host, user, port: Number(portArg ?? 22), keyPath };
const AGENT_PORT = 7878;
const token = randomBytes(24).toString('hex');

console.log(`[execute] target ${user}@${host}:${conn.port}  agent :${AGENT_PORT}`);

const result = await provisionRemote(
  conn,
  { token, port: AGENT_PORT, host: '127.0.0.1' },
  {
    onEvent: (e: ProvisionEvent | PreviewEvent) => {
      if (e.type === 'preview') return;
      console.log('  event:', JSON.stringify(e));
    },
    confirm: () => { console.log('[consent] → YES (real execute)'); return true; },
  },
);

console.log('\n===== RESULT =====');
console.log('status:', result.status);
console.log('outcome:', JSON.stringify(result.outcome, null, 2));

// Independent agent-health probe over loopback (authoritative signal per the plan).
console.log('\n===== AGENT HEALTH (loopback, authoritative) =====');
try {
  const r = await fetch(`http://127.0.0.1:${AGENT_PORT}/health`);
  console.log('HTTP', r.status, await r.text());
} catch (err) {
  console.log('probe failed:', err instanceof Error ? err.message : String(err));
}
