// packages/cli/src/agent/services/mcp-server.ts
import { readManifest, type ManifestEntry } from '../../services/manifest.ts';

export interface ServiceTools {
  list_services(): Promise<{ services: ManifestEntry[] }>;
  get_connection(args: { id: string }): Promise<
    | { ok: true; connectionHint: string; remotePort: number }
    | { ok: false; error: string }
  >;
}

/** Pure tool handlers over a manifest source (injectable for tests). */
export function makeServiceTools(source: () => ManifestEntry[]): ServiceTools {
  return {
    async list_services() {
      return { services: source() };
    },
    async get_connection({ id }) {
      const hit = source().find((e) => e.id === id);
      if (!hit) return { ok: false, error: `no service with id ${id}` };
      return { ok: true, connectionHint: hit.connectionHint, remotePort: hit.remotePort };
    },
  };
}

/**
 * Boot a stdio MCP server named `patchwire-services` backed by the services manifest.
 * Env: PW_SERVICES_PROJECT_DIR (defaults to cwd).
 */
export async function runServiceMcpServer(): Promise<void> {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { z } = await import('zod');

  const projectDir = process.env.PW_SERVICES_PROJECT_DIR ?? process.cwd();
  const tools = makeServiceTools(() => readManifest(projectDir));

  const server = new McpServer({ name: 'patchwire-services', version: '1.0.0' });

  server.registerTool(
    'list_services',
    { description: 'List local services projected onto this agent host', inputSchema: {} },
    async () => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await tools.list_services()) }],
    }),
  );

  server.registerTool(
    'get_connection',
    {
      description: 'Get the loopback connection hint for a projected service id',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(await tools.get_connection({ id })) }],
    }),
  );

  await server.connect(new StdioServerTransport());
}
