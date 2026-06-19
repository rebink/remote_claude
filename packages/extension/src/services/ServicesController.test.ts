import { describe, it, expect, vi } from 'vitest';
import { ServicesController, type SpawnedChild } from './ServicesController.ts';
import type { ServicesView } from './protocol.ts';

function fakeChild() {
  let dataCb: (c: string) => void = () => {};
  let exitCb: (code: number | null) => void = () => {};
  const writes: string[] = [];
  const kill = vi.fn();
  const child: SpawnedChild = {
    stdout: { on: (_ev: 'data', cb: (c: Buffer | string) => void) => { dataCb = cb as (c: string) => void; } },
    stdin: { write: (s: string) => { writes.push(s); } },
    on: (_ev: 'exit', cb: (code: number | null) => void) => { exitCb = cb; },
    kill,
  };
  return { child, writes, kill, feed: (s: string) => dataCb(s), exit: () => exitCb(0) };
}

function makeController(child: SpawnedChild) {
  const spawnFn = vi.fn(() => child);
  const c = new ServicesController('patchwire', [], '/ws', {}, spawnFn);
  return { c, spawnFn };
}

describe('ServicesController', () => {
  it('start spawns `services serve --stream` in the workspace cwd', () => {
    const f = fakeChild();
    const { c, spawnFn } = makeController(f.child);
    c.start();
    expect(spawnFn).toHaveBeenCalledWith('patchwire', ['services', 'serve', '--stream'], { cwd: '/ws', env: {} });
  });

  it('parses streamed stdout lines into the view and fires onDidChange', () => {
    const f = fakeChild();
    const { c } = makeController(f.child);
    const seen: ServicesView[] = [];
    c.onDidChange((v) => seen.push(v));
    c.start();
    f.feed('{"type":"candidates","services":[{"id":"docker:db:5432","label":"Postgres","kind":"docker","localPort":5432,"connectionHint":"postgres://127.0.0.1:5432"}]}\n');
    expect(seen.at(-1)!.candidates).toHaveLength(1);
    expect(c.current().candidates[0].id).toBe('docker:db:5432');
  });

  it('buffers a partial line until the newline arrives', () => {
    const f = fakeChild();
    const { c } = makeController(f.child);
    const seen: ServicesView[] = [];
    c.onDidChange((v) => seen.push(v));
    c.start();
    f.feed('{"type":"error","mess');
    expect(seen).toHaveLength(0);
    f.feed('age":"boom"}\n');
    expect(seen.at(-1)!.error).toBe('boom');
  });

  it('bind/unbind/retry/discover write NDJSON commands to stdin', () => {
    const f = fakeChild();
    const { c } = makeController(f.child);
    c.start();
    c.discover(); c.bind('x'); c.unbind('y'); c.retry('z');
    expect(f.writes).toEqual([
      '{"cmd":"discover"}\n',
      '{"cmd":"bind","id":"x"}\n',
      '{"cmd":"unbind","id":"y"}\n',
      '{"cmd":"retry","id":"z"}\n',
    ]);
  });

  it('stop kills the child; start is idempotent', () => {
    const f = fakeChild();
    const { c, spawnFn } = makeController(f.child);
    c.start(); c.start();
    expect(spawnFn).toHaveBeenCalledTimes(1);
    c.stop();
    expect(f.kill).toHaveBeenCalled();
  });

  it('child exit surfaces a stopped error in the view', () => {
    const f = fakeChild();
    const { c } = makeController(f.child);
    const seen: ServicesView[] = [];
    c.onDidChange((v) => seen.push(v));
    c.start();
    f.exit();
    expect(seen.at(-1)!.error).toBe('session stopped');
  });

  it('clears the stopped error when restarted', () => {
    const f = fakeChild();
    const { c } = makeController(f.child);
    c.start();
    f.exit(); // sets error 'session stopped', nulls child
    expect(c.current().error).toBe('session stopped');
    c.start(); // restart
    expect(c.current().error).toBeUndefined();
  });
});
