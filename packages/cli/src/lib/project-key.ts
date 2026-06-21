import { homedir } from 'node:os';
import { join } from 'node:path';

/** Absolute path to the per-project SSH private key for a host+user. */
export function resolveProjectKey(host: string, user: string): string {
  return join(homedir(), '.patchwire', 'keys', `${host}-${user}`);
}
