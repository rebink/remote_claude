// packages/core/src/session-command.ts

export interface SessionTarget {
  project: string;
  host: string;
  user: string;
  sshPort?: number;
  remotePath: string;
}

/** POSIX single-quote a value so the local shell passes it through verbatim. */
function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Build the full shell command to launch a claude session: ssh into the remote
 * (with a TTY via -tt), cd into the synced project, and exec a login+interactive
 * shell running `claude`. The whole remote command is single-quote-escaped so the
 * launcher (osascript `do script` / `bash -lc`) and the `open_terminal` guard see
 * NO double quotes. `remotePath` is validated against `^~?[A-Za-z0-9_./-]+$`
 * (rejecting shell metacharacters) so the unquoted interpolation is safe; its
 * leading `~` still expands on the remote. host/user are token-validated upstream.
 */
export function buildSessionShellCommand(
  target: SessionTarget,
  keyPath: string,
  skipPermissions = false,
): string {
  if (!/^~?[A-Za-z0-9_./-]+$/.test(target.remotePath)) {
    throw new Error(`invalid remotePath (only ~, letters, digits, '.', '_', '/', '-' allowed): ${target.remotePath}`);
  }
  const claude = skipPermissions ? 'claude --dangerously-skip-permissions' : 'claude';
  const remote = `cd ${target.remotePath} && exec zsh -lic ${shSingleQuote(claude)}`;
  const port = target.sshPort ?? 22;
  return `ssh -tt -i ${shSingleQuote(keyPath)} -p ${port} -o StrictHostKeyChecking=accept-new ${target.user}@${target.host} ${shSingleQuote(remote)}`;
}
