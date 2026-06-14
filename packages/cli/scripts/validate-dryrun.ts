/**
 * Real-host validation DRY RUN — detect → plan → preview, then DECLINE consent.
 * Zero mutation: confirm() returns false, so execute/verify never run.
 * Usage: tsx scripts/validate-dryrun.ts <host> <user> <keyPath> [port]
 */
import { provisionRemote, type PreviewEvent } from '../src/agent/provision/provision-remote.ts';
import type { RemoteConn } from '../src/agent/provision/remote-detect.ts';
import type { ProvisionEvent } from '../src/agent/provision/types.ts';

const [host = '127.0.0.1', user = 'apple', keyPath = `${process.env.HOME}/.ssh/pw_validate`, portArg] =
  process.argv.slice(2);
const conn: RemoteConn = { host, user, port: Number(portArg ?? 22), keyPath };

const events: string[] = [];
let preview: PreviewEvent | undefined;

const result = await provisionRemote(
  conn,
  { token: 'DRY-RUN-NOT-USED', port: 7878 },
  {
    onEvent: (e: ProvisionEvent | PreviewEvent) => {
      if (e.type === 'preview') preview = e;
      else events.push(JSON.stringify(e));
    },
    confirm: () => {
      console.log('\n[consent gate reached] → declining (dry run, no mutation)\n');
      return false;
    },
  },
);

console.log('===== DETECTED =====');
console.log(JSON.stringify(result.detected, null, 2));

console.log('\n===== PLAN (ordered steps) =====');
for (const s of preview?.plan.steps ?? []) {
  console.log(`  - ${s.id}${(s as { elevation?: boolean }).elevation ? '  [needs elevation]' : ''}` +
    ((s as { description?: string }).description ? `  — ${(s as { description?: string }).description}` : ''));
}

console.log('\n===== STEPS REQUIRING ELEVATION =====');
console.log((preview?.elevation ?? []).map((s) => s.id).join(', ') || '(none)');

console.log('\n===== EVENTS BEFORE CONSENT =====');
console.log(events.length ? events.join('\n') : '(none)');

console.log('\n===== RESULT =====');
console.log('status:', result.status, '(expected: cancelled)');
console.log('outcome:', result.outcome ? JSON.stringify(result.outcome) : '(none — never executed) ✓');
