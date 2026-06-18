/**
 * Resolve the `patchwire` CLI binary that serves the `flutter-mcp` subcommand.
 * The agent process entry (`process.argv[1]`) points at the AGENT binary, not
 * the CLI, so we rely on the installed `patchwire` command being on PATH (same
 * assumption the agent makes for `claude`). Overridable via PW_CLI_BIN.
 */
export function resolvePatchwireBin(env: NodeJS.ProcessEnv = process.env): string {
  return env.PW_CLI_BIN && env.PW_CLI_BIN.trim() ? env.PW_CLI_BIN.trim() : 'patchwire';
}
