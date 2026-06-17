// packages/cli/test/agent/flutter/vm-client.test.ts
import { describe, it, expect, vi } from 'vitest';
import { VmServiceClient, findFlutterIsolate } from '../../../src/agent/flutter/vm-client.ts';

class FakeSocket {
  handlers: Record<string, ((data: unknown) => void)[]> = {};
  sent: string[] = [];
  on(ev: string, cb: (data: unknown) => void) { (this.handlers[ev] ??= []).push(cb); }
  emit(ev: string, data?: unknown) { (this.handlers[ev] ?? []).forEach((h) => h(data)); }
  send(s: string) {
    this.sent.push(s);
    const msg = JSON.parse(s);
    // Echo a JSON-RPC result keyed by the request id on the next tick.
    queueMicrotask(() => this.emit('message', JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { echoed: msg.method } })));
  }
  close() { this.emit('close'); }
}

describe('VmServiceClient', () => {
  it('resolves a call with the result matched by id', async () => {
    const sock = new FakeSocket();
    const client = new VmServiceClient(() => sock as never);
    sock.emit('open');
    await client.ready();
    const res = await client.call('getVM', {});
    expect(res).toEqual({ echoed: 'getVM' });
    expect(JSON.parse(sock.sent[0]!)).toMatchObject({ method: 'getVM', jsonrpc: '2.0' });
  });

  it('rejects a call when the response carries an error', async () => {
    const sock = new FakeSocket();
    sock.send = (s: string) => {
      const msg = JSON.parse(s);
      queueMicrotask(() => sock.emit('message', JSON.stringify({ id: msg.id, error: { code: 1, message: 'boom' } })));
    };
    const client = new VmServiceClient(() => sock as never);
    sock.emit('open');
    await expect(client.call('getVM', {})).rejects.toThrow('boom');
  });

  it('rejects pending calls when the socket closes', async () => {
    const sock = new FakeSocket();
    // suppress the auto-echo so the call stays pending until close
    sock.send = () => {};
    const client = new VmServiceClient(() => sock as never);
    sock.emit('open');
    const p = client.call('getVM', {});
    sock.emit('close');
    await expect(p).rejects.toThrow(/closed|connection/i);
  });
});

describe('findFlutterIsolate', () => {
  it('returns the isolate id that has a flutter extension registered', () => {
    const vm = { isolates: [
      { id: 'iso-1', extensionRPCs: [] },
      { id: 'iso-2', extensionRPCs: ['ext.flutter.reassemble', 'ext.flutter.inspector.getRootWidgetSummaryTree'] },
    ] };
    expect(findFlutterIsolate(vm)).toBe('iso-2');
  });
  it('returns undefined when no flutter isolate exists', () => {
    expect(findFlutterIsolate({ isolates: [{ id: 'x', extensionRPCs: [] }] })).toBeUndefined();
  });
});
