import { timingSafeEqual } from 'node:crypto';
import type { UsersStore, LookupResult } from './users-store.ts';

/**
 * Legacy single-token check. Retained because the migration path may still
 * want to validate the PW_AGENT_TOKEN env at boot. Not used by the server's
 * per-request hook anymore — `resolveUserFromHeader` is.
 */
export function verifyToken(headerValue: string | undefined, expected: string): boolean {
  if (!headerValue || !headerValue.startsWith('Bearer ')) return false;
  const provided = headerValue.slice('Bearer '.length).trim();
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

/**
 * Parse a Bearer header and look the token up in the UsersStore. Returns
 * the user + disabled flag on match, or null if the header is missing,
 * malformed, or the token does not correspond to any known user.
 *
 * The auth hook in server.ts uses this and maps:
 *   - null            → 401 unauthorized
 *   - { disabled: true } → 403 user disabled
 *   - { disabled: false} → continue, decorate req.username
 */
export function resolveUserFromHeader(
  headerValue: string | undefined,
  store: UsersStore,
): LookupResult | null {
  if (!headerValue || !headerValue.startsWith('Bearer ')) return null;
  const provided = headerValue.slice('Bearer '.length).trim();
  if (!provided) return null;
  return store.lookupByToken(provided);
}
