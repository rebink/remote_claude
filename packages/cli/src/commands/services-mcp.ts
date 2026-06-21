// packages/cli/src/commands/services-mcp.ts
import type { Command } from 'commander';
import { runServiceMcpServer } from '../agent/services/mcp-server.ts';

/** Hidden subcommand launched by `claude` via --mcp-config. Reads PW_SERVICES_* env. */
export function registerServicesMcpCommand(program: Command): void {
  program
    .command('services-mcp', { hidden: true })
    .description('Run the patchwire-services MCP server (stdio) backed by the services manifest')
    .action(async () => {
      await runServiceMcpServer();
    });
}
