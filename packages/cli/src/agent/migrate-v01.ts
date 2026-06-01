import { existsSync } from 'node:fs';
import { UsersStore } from './users-store.ts';

export interface MigrationInput {
  usersJsonPath: string;
  legacyToken: string | undefined;
}

export interface MigrationResult {
  migrated: boolean;
  users: number;
}

/**
 * One-shot v0.1 → v0.2 migration. Run once at agent boot, BEFORE constructing
 * the UsersStore that buildServer consumes.
 *
 * Behavior:
 *   - If users.json already exists, no-op.
 *   - If users.json absent + legacyToken provided, create a `default` user
 *     with that token's hash so existing v0.1 laptops keep authenticating
 *     unchanged.
 *   - If users.json absent + no legacyToken, no-op (admin will need to run
 *     `patchwire-agent user add`).
 */
export function migrateIfNeeded(input: MigrationInput): MigrationResult {
  if (existsSync(input.usersJsonPath)) {
    return { migrated: false, users: 0 };
  }
  if (!input.legacyToken) {
    return { migrated: false, users: 0 };
  }
  const store = new UsersStore(input.usersJsonPath);
  store.addUser('default', input.legacyToken);
  return { migrated: true, users: 1 };
}
