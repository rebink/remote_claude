import type { FlutterSession } from '@patchwire/protocol';

export interface McpConfig {
  mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
}

/** Build the `--mcp-config` JSON that wires the patchwire-flutter MCP server for a session. */
export function buildMcpConfig(session: FlutterSession, patchwireBin: string): McpConfig {
  return {
    mcpServers: {
      'patchwire-flutter': {
        command: patchwireBin,
        args: ['flutter-mcp'],
        env: { PW_FLUTTER_VM_URL: session.url, PW_FLUTTER_TARGET: session.target },
      },
    },
  };
}
