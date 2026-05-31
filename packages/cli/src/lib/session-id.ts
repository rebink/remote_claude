import { randomUUID } from 'node:crypto';

/**
 * Generate a session id in UUID format (8-4-4-4-12 with dashes).
 * Claude's `--session-id <uuid>` flag rejects anything that isn't a valid UUID,
 * so this must NOT be raw hex.
 */
export function newSessionId(): string {
  return randomUUID();
}
