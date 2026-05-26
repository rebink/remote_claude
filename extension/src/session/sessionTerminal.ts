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

  // Session terminal uses the per-project key for silent auth. The Mini's
  // login keychain must already be unlocked (claude reads OAuth credentials
  // from it). Users do this once by SSH-ing in interactively and running:
  //   security set-keychain-settings ~/Library/Keychains/login.keychain-db
  // which disables idle auto-lock until reboot. After that, key-based SSH
  // from this extension finds the keychain unlocked and claude "just works".
  const keyPath = join(homedir(), '.remote-claude', 'keys', `${target.host}-${target.user}`);
  const sshArgs: string[] = [];
  if (existsSync(keyPath)) sshArgs.push('-i', keyPath);
  if (target.sshPort && target.sshPort !== 22) sshArgs.push('-p', String(target.sshPort));
  sshArgs.push('-t', '-o', 'ServerAliveInterval=30', `${target.user}@${target.host}`);
  // Remote command: cd into the project, print a banner, then exec a
  // login+interactive zsh that runs `claude`. The `-i` flag is critical —
  // it makes zsh source ~/.zshrc, which is where most users set up PATH and
  // ANTHROPIC_* env that affect claude's auth context (Claude Max vs API
  // key billing). SSH's default `$SHELL -c` mode is non-interactive and
  // skips .zshrc, which is why the same claude binary reports different
  // auth state in an interactive ssh vs ours. `exec` chains so Ctrl+D /
  // claude exit closes the SSH session cleanly.
  const remoteCmd = [
    `cd "${target.remotePath}"`,
    `printf '\\033[36m── Remote Claude · %s:%s\\033[0m\\n' "$(hostname)" "$(pwd)"`,
    `exec zsh -lic claude`,
  ].join(' && ');
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
