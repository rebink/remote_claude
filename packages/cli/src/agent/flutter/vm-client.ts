// packages/cli/src/agent/flutter/vm-client.ts
import WebSocket from 'ws';

interface Socket {
  on(ev: 'open' | 'message' | 'close' | 'error', cb: (data: unknown) => void): void;
  send(data: string): void;
  close(): void;
}
export type SocketFactory = () => Socket;

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; }

/** Minimal JSON-RPC 2.0 client over the Dart VM Service WebSocket. */
export class VmServiceClient {
  private sock: Socket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private isOpen = false;
  private openWaiters: (() => void)[] = [];
  /** Per-stream listener registry for streamed events (e.g. 'Stdout'). */
  readonly onStreamEvent: ((streamId: string, event: Record<string, unknown>) => void)[] = [];

  constructor(factory: SocketFactory) {
    this.sock = factory();
    this.sock.on('open', () => {
      this.isOpen = true;
      this.openWaiters.splice(0).forEach((w) => w());
    });
    this.sock.on('message', (data) => this.handleMessage(String(data)));
  }

  ready(): Promise<void> {
    if (this.isOpen) return Promise.resolve();
    return new Promise<void>((res) => this.openWaiters.push(res));
  }

  private handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(raw); } catch { return; }
    if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id)!;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error((msg.error as { message?: string }).message ?? 'VM Service error'));
      else p.resolve(msg.result);
      return;
    }
    // Streamed event: { method: 'streamNotify', params: { streamId, event } }
    if (msg.method === 'streamNotify' && msg.params) {
      const { streamId, event } = msg.params as { streamId: string; event: Record<string, unknown> };
      this.onStreamEvent.forEach((h) => h(streamId, event));
    }
  }

  call(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.sock.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
    });
  }

  close(): void { this.sock.close(); }
}

/** Default factory: a real `ws` WebSocket adapted to the Socket interface. */
export function realSocketFactory(url: string): SocketFactory {
  return () => {
    const ws = new WebSocket(url);
    return {
      on: (ev, cb) => ws.on(ev, cb as never),
      send: (d) => ws.send(d),
      close: () => ws.close(),
    };
  };
}

interface VmIsolateRef { id: string; extensionRPCs?: string[] }
/** Pick the isolate that has Flutter service extensions registered. */
export function findFlutterIsolate(vm: { isolates: VmIsolateRef[] }): string | undefined {
  const iso = vm.isolates.find((i) => (i.extensionRPCs ?? []).some((e) => e.startsWith('ext.flutter.')));
  return iso?.id;
}
