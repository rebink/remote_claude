// packages/cli/test/agent/flutter/mcp-server.test.ts
import { describe, it, expect, vi } from 'vitest';
import { makeFlutterTools } from '../../../src/agent/flutter/mcp-server.ts';

function fakeVm(overrides: Record<string, unknown> = {}) {
  return {
    call: vi.fn(async (method: string) => {
      if (method === 'getVM') return { isolates: [{ id: 'iso', extensionRPCs: ['ext.flutter.reassemble'] }] };
      if (method === 'reloadSources') return { success: true };
      if (method === 'ext.flutter.reassemble') return {};
      if (method === '_flutter.screenshot') return { screenshot: 'UE5HBASE64' };
      if (method === 'ext.flutter.inspector.getRootWidgetSummaryTree') return { result: { description: 'Root' } };
      return {};
    }),
    onStreamEvent: [] as ((s: string, e: Record<string, unknown>) => void)[],
    ...overrides,
  };
}

describe('makeFlutterTools', () => {
  it('hot reload calls reloadSources then reassemble on the flutter isolate', async () => {
    const vm = fakeVm();
    const tools = makeFlutterTools(vm as never, 'device');
    const out = await tools.hotReload({ restart: false });
    expect(vm.call).toHaveBeenCalledWith('reloadSources', expect.objectContaining({ isolateId: 'iso' }));
    expect(vm.call).toHaveBeenCalledWith('ext.flutter.reassemble', expect.objectContaining({ isolateId: 'iso' }));
    expect(out.ok).toBe(true);
  });

  it('screenshot returns a base64 PNG image on device', async () => {
    const vm = fakeVm();
    const tools = makeFlutterTools(vm as never, 'device');
    const out = await tools.screenshot();
    expect(out).toEqual({ ok: true, mimeType: 'image/png', base64: 'UE5HBASE64' });
  });

  it('screenshot is unsupported on web (no _flutter.screenshot call made)', async () => {
    const vm = fakeVm();
    const tools = makeFlutterTools(vm as never, 'web');
    const out = await tools.screenshot();
    expect(out).toEqual({ ok: false, error: 'screenshot unsupported on web target' });
    expect(vm.call).not.toHaveBeenCalledWith('_flutter.screenshot', expect.anything());
  });

  it('inspect returns the summary widget tree', async () => {
    const vm = fakeVm();
    const tools = makeFlutterTools(vm as never, 'device');
    const out = await tools.inspect({});
    expect(out.ok).toBe(true);
    expect(out.tree).toEqual({ description: 'Root' });
  });

  it('logs returns buffered stream events', async () => {
    const vm = fakeVm();
    const tools = makeFlutterTools(vm as never, 'device');
    vm.onStreamEvent.forEach((h) => h('Stdout', { kind: 'WriteEvent', bytes: Buffer.from('hello\n').toString('base64') }));
    const out = await tools.logs({ limit: 10 });
    expect(out.ok).toBe(true);
    expect(out.lines.join('')).toContain('hello');
  });

  it('does NOT expose an evaluate tool', () => {
    const vm = fakeVm();
    const tools = makeFlutterTools(vm as never, 'device') as Record<string, unknown>;
    expect(tools.evaluate).toBeUndefined();
  });
});
