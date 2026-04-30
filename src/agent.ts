import { buildServer } from './agent/server.ts';

const VERSION = '0.1.0';

function envRequired(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const token = envRequired('DEVBRIDGE_AGENT_TOKEN');
  const projectsRoot = envRequired('DEVBRIDGE_PROJECTS_ROOT');
  const host = process.env.DEVBRIDGE_AGENT_HOST ?? '127.0.0.1';
  const port = Number(process.env.DEVBRIDGE_AGENT_PORT ?? 7878);
  const claudeCommand = process.env.DEVBRIDGE_CLAUDE_BIN ?? 'claude';
  const claudeArgs = (process.env.DEVBRIDGE_CLAUDE_ARGS ?? '--print').split(/\s+/).filter(Boolean);
  const timeoutSec = Number(process.env.DEVBRIDGE_TIMEOUT_SEC ?? 600);

  const app = buildServer({
    token,
    projectsRoot,
    claudeCommand,
    claudeArgs,
    timeoutSec,
    version: VERSION,
  });

  try {
    const addr = await app.listen({ host, port });
    app.log.info(`devbridge-agent listening on ${addr}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
