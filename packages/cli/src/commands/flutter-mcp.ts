// packages/cli/src/commands/flutter-mcp.ts
import type { Command } from 'commander';
import { runFlutterMcpServer } from '../agent/flutter/mcp-server.ts';

/** Hidden subcommand launched by `claude` via --mcp-config. Reads PW_FLUTTER_* env. */
export function registerFlutterMcpCommand(program: Command): void {
  program
    .command('flutter-mcp', { hidden: true })
    .description('Run the patchwire-flutter MCP server (stdio) against a tunnelled VM Service')
    .action(async () => {
      await runFlutterMcpServer();
    });
}
