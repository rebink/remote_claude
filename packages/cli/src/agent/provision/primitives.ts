import { quoteForShell } from '../../lib/ssh-runner.ts';

export const AGENT_PACKAGE = '@rebink/patchwire';
export const PNPM_VERSION = '10.26.1';

/** Install the agent globally via Corepack-activated pnpm (Node >=20 is the only prerequisite). */
export const AGENT_INSTALL_CMD =
  `corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate && pnpm add -g ${AGENT_PACKAGE}`;

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
