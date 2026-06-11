import * as vscode from 'vscode';

const TERMINAL_NAME_PREFIX = 'Claude →';

export interface SessionTarget {
  project: string;
  host: string;
  user: string;
  sshPort?: number;
  remotePath: string;
}

/** Returns the active Patchwire terminal if one exists. */
export function findExistingSessionTerminal(project: string): vscode.Terminal | undefined {
  const name = `${TERMINAL_NAME_PREFIX} ${project}`;
  return vscode.window.terminals.find((t) => t.name === name && t.exitStatus === undefined);
}

/**
 * Build the remote command run over SSH: cd into the project, print the
 * Patchwire banner (plus a red warning when permission checks are bypassed),
 * then exec a login+interactive zsh running `claude`.
 *
 * The `-i` flag is critical — it makes zsh source ~/.zshrc, which is where most
 * users set up PATH and ANTHROPIC_* env that affect claude's auth context
 * (Claude Max vs API key billing). SSH's default `$SHELL -c` mode is
 * non-interactive and skips .zshrc, which is why the same claude binary reports
 * different auth state in an interactive ssh vs ours. `exec` chains so Ctrl+D /
 * claude exit closes the SSH session cleanly.
 *
 * `claudeCmd` is single-quoted so the remote shell passes the whole
 * `claude --dangerously-skip-permissions` string as ONE argument to zsh's
 * `-c`. Unquoted, the remote shell would split on whitespace and bind the flag
 * to zsh instead of claude, silently dropping it. The flag is a fixed literal
 * (not user input), so the quoting adds no injection surface.
 *
 * Note: leave ${remotePath} UNQUOTED so a leading ~ expands. Project name is
 * regex-validated upstream (^[a-zA-Z0-9._-]+$) so no shell metachars sneak in.
 */
export function buildRemoteCommand(target: SessionTarget, skipPermissions: boolean): string {
  const claudeCmd = skipPermissions ? 'claude --dangerously-skip-permissions' : 'claude';
  const parts = [
    `cd ${target.remotePath}`,
    `printf '\\033[36m── Patchwire · %s:%s\\033[0m\\n' "$(hostname)" "$(pwd)"`,
  ];
  if (skipPermissions) {
    parts.push(
      `printf '\\033[31m⚠ permissions bypassed (--dangerously-skip-permissions)\\033[0m\\n'`,
    );
  }
  parts.push(`exec zsh -lic '${claudeCmd}'`);
  return parts.join(' && ');
}

/**
 * Open (or focus) an integrated terminal SSH'd to the Mac Mini that runs
 * `claude` against the synced project. The user interacts with the real claude
 * REPL directly — all slash commands, tool use, plan mode, /resume, etc. work
 * natively.
 *
 * This function owns the SSH connection (the `-t` flag allocates a TTY so
 * claude's interactive UI renders correctly, plus the auth options) and
 * delegates the remote command — cd into the project, print the banner, and
 * `exec zsh -lic claude` — to {@link buildRemoteCommand}.
 */
export function openSessionTerminal(target: SessionTarget): vscode.Terminal {
  const existing = findExistingSessionTerminal(target.project);
  if (existing) {
    existing.show(true);
    return existing;
  }

  // Session terminal uses PASSWORD auth (not the per-project key) so that
  // sshd's PAM stack triggers the macOS keychain unlock prompts on the Mini.
  // claude reads its OAuth credentials from the login keychain — without
  // those prompts, the keychain stays locked and claude reports "Not logged
  // in". This deliberately mirrors what the user gets when they type
  // `ssh admin@host` themselves in a normal terminal. Other SSH callers
  // (rsync push, pullChanges, doctor /health) keep using the per-project
  // key since they need non-interactive auth.
  const sshArgs: string[] = [];
  if (target.sshPort && target.sshPort !== 22) sshArgs.push('-p', String(target.sshPort));
  sshArgs.push(
    '-t',
    '-o', 'ServerAliveInterval=30',
    '-o', 'PreferredAuthentications=password,keyboard-interactive',
    '-o', 'PubkeyAuthentication=no',
    `${target.user}@${target.host}`,
  );
  // Remote command (cd + banner + exec zsh -lic claude) is assembled by
  // buildRemoteCommand; see its doc comment for the -i/.zshrc auth rationale.
  // Read at launch time so a changed setting takes effect on the next session
  // open (no window reload needed). `?? false` keeps the safe off state when
  // the setting is unset or the wrong type.
  const skipPermissions = vscode.workspace
    .getConfiguration('patchwire')
    .get<boolean>('dangerouslySkipPermissions') ?? false;
  sshArgs.push(buildRemoteCommand(target, skipPermissions));

  const terminal = vscode.window.createTerminal({
    name: `${TERMINAL_NAME_PREFIX} ${target.project}`,
    shellPath: 'ssh',
    shellArgs: sshArgs,
    iconPath: new vscode.ThemeIcon('comment-discussion'),
  });
  terminal.show(true);
  return terminal;
}
