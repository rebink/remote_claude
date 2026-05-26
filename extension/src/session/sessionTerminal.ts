import * as vscode from 'vscode';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TERMINAL_NAME_PREFIX = 'Claude →';

export interface SessionTarget {
  project: string;
  host: string;
  user: string;
  sshPort?: number;
  remotePath: string;
}

/** Returns the active Remote Claude terminal if one exists. */
export function findExistingSessionTerminal(project: string): vscode.Terminal | undefined {
  const name = `${TERMINAL_NAME_PREFIX} ${project}`;
  return vscode.window.terminals.find((t) => t.name === name && t.exitStatus === undefined);
}

/**
 * Open (or focus) an integrated terminal SSH'd to the Mac Mini, cd'd into the
 * synced project directory, running `claude` under a login shell. The user
 * interacts with the real claude REPL directly — all slash commands, tool use,
 * plan mode, /resume, etc. work natively.
 *
 * The `-t` flag allocates a TTY so claude's interactive UI renders correctly.
 * `exec $SHELL -l -c claude` runs claude under a login shell so PATH includes
 * brew/.local/.node etc. — needed for the claude binary to resolve via the
 * user's normal shell environment.
 */
export function openSessionTerminal(target: SessionTarget): vscode.Terminal {
  const existing = findExistingSessionTerminal(target.project);
  if (existing) {
    existing.show(true);
    return existing;
  }

  // Session terminal deliberately uses PASSWORD auth (not the per-project key)
  // because the password prompt is what unlocks the Mini's login keychain.
  // claude reads its OAuth credentials from that keychain, so without an
  // unlock, every session would say "Not logged in". The other SSH callers
  // (rsync, pullChanges, doctor) still use the key — they need to be
  // non-interactive and don't care about keychain access.
  const sshArgs: string[] = [];
  if (target.sshPort && target.sshPort !== 22) sshArgs.push('-p', String(target.sshPort));
  sshArgs.push(
    '-t',
    '-o', 'ServerAliveInterval=30',
    '-o', 'PreferredAuthentications=password,keyboard-interactive',
    '-o', 'PubkeyAuthentication=no',
    `${target.user}@${target.host}`,
  );
  // Remote command: cd into the project, print a banner so the user can SEE
  // they're on the remote, then exec the first claude binary we find. SSH
  // non-interactive doesn't source .zshrc, so we can't rely on PATH alone —
  // try the common macOS install locations explicitly. `exec` replaces the
  // shell so Ctrl+D / claude exit closes the SSH session cleanly.
  const remoteCmd = [
    `cd ${target.remotePath}`,
    `printf '\\033[36m── Remote Claude · %s:%s\\033[0m\\n' "$(hostname)" "$(pwd)"`,
    `for p in "$HOME/.node/bin/claude" "$HOME/.local/bin/claude" "/opt/homebrew/bin/claude" "/usr/local/bin/claude"; do`,
    `  [ -x "$p" ] && exec "$p"`,
    `done`,
    `exec claude`,
  ].join('; ');
  sshArgs.push(remoteCmd);

  const terminal = vscode.window.createTerminal({
    name: `${TERMINAL_NAME_PREFIX} ${target.project}`,
    shellPath: 'ssh',
    shellArgs: sshArgs,
    iconPath: new vscode.ThemeIcon('comment-discussion'),
  });
  terminal.show(true);
  return terminal;
}
