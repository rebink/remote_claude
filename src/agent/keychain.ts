import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const loginKeychainPath = (): string => join(homedir(), 'Library', 'Keychains', 'login.keychain-db');

/**
 * Best-effort: disable idle-timeout auto-lock on the user's login keychain.
 *
 * Why: macOS Keychain auto-locks after an idle period. When locked, processes
 * (including our launchd-spawned agent + the `claude` CLI it invokes) cannot
 * read OAuth credentials and `claude` returns "Not logged in · Please run /login".
 * Interactive SSH sessions unlock the keychain via the user's password prompt,
 * which is why `claude` works in a terminal but fails for the background agent.
 *
 * Calling `security set-keychain-settings <path>` with no other args means
 * "no idle timeout, do not lock when sleeping". It requires the keychain to
 * currently be unlocked — this function CANNOT unlock a locked keychain
 * (that needs the user's password). It's a forward-looking guard so that
 * once the keychain IS unlocked (e.g., user logs in or SSHs in), it stays
 * unlocked until next reboot.
 *
 * No-op on non-macOS platforms.
 */
export function tryDisableKeychainAutoLock(): { ok: boolean; reason?: string } {
  if (process.platform !== 'darwin') return { ok: true, reason: 'non-darwin' };
  const r = spawnSync('security', ['set-keychain-settings', loginKeychainPath()], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (r.status === 0) return { ok: true };
  return { ok: false, reason: (r.stderr || `exit ${r.status}`).trim() };
}

/** Heuristic: does the given claude output indicate the keychain is locked / auth not accessible? */
export function isNotLoggedIn(text: string): boolean {
  return /Not logged in|Please run \/login|keychain.*locked/i.test(text);
}

/**
 * Build a remediation message for the user when the agent detects an auth-locked
 * claude. Used by the chat turn error path to give actionable guidance instead
 * of a bare "claude exited 1".
 */
export const NOT_LOGGED_IN_REMEDIATION =
  'claude on the remote reports "Not logged in". The macOS keychain holding the OAuth ' +
  'credentials is locked. Fix:\n' +
  '  ssh <user>@<host>          # this unlocks the login keychain via your password prompt\n' +
  '  security set-keychain-settings ~/Library/Keychains/login.keychain-db\n' +
  '                             # disables idle auto-lock so the agent keeps working\n' +
  'Then retry the chat.';
