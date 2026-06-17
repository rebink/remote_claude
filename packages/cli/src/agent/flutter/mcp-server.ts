// packages/cli/src/agent/flutter/mcp-server.ts
import type { TargetKind } from '../../lib/flutter-vmservice.ts';
import { capabilitiesFor, wsUrlFor, parseVmServiceUri } from '../../lib/flutter-vmservice.ts';
import { VmServiceClient, findFlutterIsolate, realSocketFactory } from './vm-client.ts';

/** The VM dependency the tool handlers need (subset of VmServiceClient). */
export interface VmDep {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
  onStreamEvent: ((streamId: string, event: Record<string, unknown>) => void)[];
}

async function flutterIsolateId(vm: VmDep): Promise<string> {
  const v = (await vm.call('getVM', {})) as { isolates: { id: string; extensionRPCs?: string[] }[] };
  const id = findFlutterIsolate(v);
  if (!id) throw new Error('no Flutter isolate found (is a Flutter app running in debug mode?)');
  return id;
}

export interface FlutterTools {
  hotReload(args: { restart?: boolean }): Promise<{ ok: boolean; error?: string }>;
  screenshot(): Promise<{ ok: boolean; mimeType?: string; base64?: string; error?: string }>;
  inspect(args: { subtree?: string }): Promise<{ ok: boolean; tree?: unknown; error?: string }>;
  logs(args: { limit?: number }): Promise<{ ok: boolean; lines: string[] }>;
}

/**
 * Build the four scoped tool handlers over a VM dependency and target kind.
 * NOTE: there is deliberately NO `evaluate`/arbitrary-eval handler (threat model).
 */
export function makeFlutterTools(vm: VmDep, target: TargetKind): FlutterTools {
  const caps = capabilitiesFor(target);
  const logBuffer: string[] = [];
  vm.onStreamEvent.push((streamId, event) => {
    if (streamId === 'Stdout' || streamId === 'Stderr' || streamId === 'Logging' || streamId === 'Extension') {
      const bytes = event.bytes as string | undefined;
      if (bytes) logBuffer.push(Buffer.from(bytes, 'base64').toString('utf8'));
    }
  });

  return {
    async hotReload({ restart }) {
      const isolateId = await flutterIsolateId(vm);
      const r = (await vm.call('reloadSources', { isolateId, force: !!restart })) as { success?: boolean };
      await vm.call('ext.flutter.reassemble', { isolateId });
      return { ok: r.success !== false };
    },
    async screenshot() {
      if (!caps.screenshot) return { ok: false, error: `screenshot unsupported on ${target} target` };
      const r = (await vm.call('_flutter.screenshot', {})) as { screenshot?: string };
      if (!r.screenshot) return { ok: false, error: 'no screenshot returned' };
      return { ok: true, mimeType: 'image/png', base64: r.screenshot };
    },
    async inspect({ subtree } = {}) {
      const isolateId = await flutterIsolateId(vm);
      const r = (await vm.call('ext.flutter.inspector.getRootWidgetSummaryTree', {
        isolateId, groupName: 'patchwire', ...(subtree ? { subtreeDepth: subtree } : {}),
      })) as { result?: unknown };
      return { ok: true, tree: r.result };
    },
    async logs({ limit } = {}) {
      const n = limit ?? 200;
      return { ok: true, lines: logBuffer.slice(-n) };
    },
  };
}

/**
 * Boot a stdio MCP server named `patchwire-flutter` that connects to the
 * tunnelled VM Service (from env) and registers the four scoped tools.
 * Env: PW_FLUTTER_VM_URL (full tunnelled http url incl. token path),
 *      PW_FLUTTER_TARGET ('device'|'web'|'desktop').
 */
export async function runFlutterMcpServer(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
  const { z } = await import('zod');

  const url = env.PW_FLUTTER_VM_URL;
  const target = (env.PW_FLUTTER_TARGET ?? 'device') as TargetKind;
  if (!url) throw new Error('PW_FLUTTER_VM_URL not set');
  const parsed = parseVmServiceUri(url);
  if (!parsed.ok) throw new Error(`bad PW_FLUTTER_VM_URL: ${parsed.error}`);
  const wsUrl = wsUrlFor(parsed.value, parsed.value.host, parsed.value.port);

  const client = new VmServiceClient(realSocketFactory(wsUrl));
  await client.ready();
  for (const s of ['Stdout', 'Stderr', 'Logging', 'Extension']) {
    await client.call('streamListen', { streamId: s }).catch(() => {});
  }
  const tools = makeFlutterTools(client, target);

  const server = new McpServer({ name: 'patchwire-flutter', version: '0.1.0' });

  server.registerTool(
    'flutter_hot_reload',
    { description: 'Hot reload (or restart) the running Flutter app', inputSchema: { restart: z.boolean().optional() } },
    async (a) => {
      const r = await tools.hotReload(a);
      return { content: [{ type: 'text' as const, text: JSON.stringify(r) }] };
    },
  );

  server.registerTool(
    'flutter_screenshot',
    { description: 'Capture a screenshot of the running Flutter app (device/desktop only)', inputSchema: {} },
    async () => {
      const r = await tools.screenshot();
      if (r.ok && r.base64) {
        return { content: [{ type: 'image' as const, data: r.base64, mimeType: r.mimeType! }] };
      }
      return { content: [{ type: 'text' as const, text: JSON.stringify(r) }], isError: !r.ok };
    },
  );

  server.registerTool(
    'flutter_inspect',
    { description: 'Get the Flutter widget summary tree', inputSchema: { subtree: z.string().optional() } },
    async (a) => {
      const r = await tools.inspect(a);
      return { content: [{ type: 'text' as const, text: JSON.stringify(r.tree ?? r) }] };
    },
  );

  server.registerTool(
    'flutter_logs',
    { description: 'Get buffered stdout/stderr/log output from the running Flutter app', inputSchema: { limit: z.number().optional() } },
    async (a) => {
      const r = await tools.logs(a);
      return { content: [{ type: 'text' as const, text: r.lines.join('') }] };
    },
  );

  await server.connect(new StdioServerTransport());
}
