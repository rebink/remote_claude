import { quoteForShell } from '../../lib/ssh-runner.ts';

export const AGENT_PACKAGE = '@rebink/patchwire';
export const PNPM_VERSION = '10.26.1';

/**
 * PATH prefix prepended to every POSIX SSH command so that Homebrew (/opt/homebrew/bin),
 * Linux Homebrew (/home/linuxbrew/.linuxbrew/bin), the classic /usr/local/bin prefix,
 * and user-local binaries (~/.local/bin) are found even in a non-interactive SSH session
 * whose default PATH is only /usr/bin:/bin:/usr/sbin:/sbin.
 */
export const POSIX_PATH_PREFIX = 'export PATH="/opt/homebrew/bin:/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"; ';

/**
 * Sets PNPM_HOME (defaulting to $HOME/.local/share/pnpm if unset) and prepends it to PATH
 * so that `pnpm add -g` knows where to install binaries and the installed binaries are found
 * immediately in the same shell session.
 */
export const POSIX_PNPM_ENV = 'export PNPM_HOME="${PNPM_HOME:-$HOME/.local/share/pnpm}"; export PATH="$PNPM_HOME:$PATH"; ';

/**
 * Install the agent globally with a robust pnpm acquisition fallback chain:
 *   1. pnpm already on PATH  → use it directly
 *   2. corepack available    → enable + prepare pnpm
 *   3. neither               → error (npm is not used — it does not set PNPM_HOME correctly)
 * then run pnpm add -g to install the agent package.
 * Uses an explicit if/elif/else to avoid && / || precedence surprises.
 *
 * POSIX_PATH_PREFIX ends with "; " so that ${POSIX_PATH_PREFIX}${POSIX_PNPM_ENV}mkdir ...
 * produces valid sh/zsh. POSIX_PNPM_ENV must precede `pnpm add -g` so PNPM_HOME is set.
 */
export const AGENT_INSTALL_CMD =
  `${POSIX_PATH_PREFIX}${POSIX_PNPM_ENV}mkdir -p "$PNPM_HOME"; if command -v pnpm >/dev/null 2>&1; then :; elif command -v corepack >/dev/null 2>&1; then corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate; else echo "pnpm not found and corepack unavailable; install pnpm on the host" >&2; exit 1; fi && pnpm add -g ${AGENT_PACKAGE}`;

/** Atomic, mode-600 write of stdin into ~/.patchwire/agent.env (temp → rename). */
export const WRITE_AGENT_ENV_CMD =
  'umask 077; mkdir -p "$HOME/.patchwire" && cat > "$HOME/.patchwire/agent.env.tmp" && mv -f "$HOME/.patchwire/agent.env.tmp" "$HOME/.patchwire/agent.env"';

export interface AgentEnvOpts {
  token: string;
  host?: string;
  port?: number;
  aiBin?: string;
}

/** The remote agent env file content (PW_AGENT_TOKEN + config), single-quoted for safe sourcing. */
export function buildAgentEnv(opts: AgentEnvOpts): string {
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? 7878;
  const aiBin = opts.aiBin ?? 'claude';
  return (
    '# patchwire-agent environment (managed by patchwire provisioning)\n' +
    `export PW_AGENT_TOKEN=${quoteForShell(opts.token)}\n` +
    `export PW_AGENT_HOST=${quoteForShell(host)}\n` +
    `export PW_AGENT_PORT=${quoteForShell(String(port))}\n` +
    `export PW_AI_BIN=${quoteForShell(aiBin)}\n`
  );
}
