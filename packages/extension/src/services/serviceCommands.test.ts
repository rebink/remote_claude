import { describe, it, expect, vi } from 'vitest';
import { boundIdsFrom, makeServiceCommandHandlers, type Memento } from './serviceCommands.ts';
import { ServiceItem } from './ServicesTreeProvider.ts';

function fakeMemento(initial: string[] = []): Memento & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>([['patchwire.boundServiceIds', initial]]);
  return {
    store,
    get: (<T>(k: string, d?: T) => (store.has(k) ? store.get(k) : d) as T),
    update: (k: string, v: unknown) => { store.set(k, v); return Promise.resolve(); },
  };
}

function item(id: string, remoteAddr: string | null = '127.0.0.1:5432') {
  return new ServiceItem({ id, label: id, status: 'available', bound: false, remoteAddr, connectionHint: 'postgres://127.0.0.1:5432' });
}

describe('boundIdsFrom', () => {
  it('reads the persisted set', () => {
    expect([...boundIdsFrom(fakeMemento(['a', 'b']))].sort()).toEqual(['a', 'b']);
  });
});

describe('service command handlers', () => {
  it('bind sends to the controller and persists the id', async () => {
    const controller = { bind: vi.fn(), unbind: vi.fn(), retry: vi.fn() };
    const mem = fakeMemento();
    const h = makeServiceCommandHandlers(controller, mem);
    await h.bind(item('docker:db:5432'));
    expect(controller.bind).toHaveBeenCalledWith('docker:db:5432');
    expect(mem.store.get('patchwire.boundServiceIds')).toEqual(['docker:db:5432']);
  });

  it('unbind sends and removes the persisted id', async () => {
    const controller = { bind: vi.fn(), unbind: vi.fn(), retry: vi.fn() };
    const mem = fakeMemento(['docker:db:5432']);
    const h = makeServiceCommandHandlers(controller, mem);
    await h.unbind(item('docker:db:5432'));
    expect(controller.unbind).toHaveBeenCalledWith('docker:db:5432');
    expect(mem.store.get('patchwire.boundServiceIds')).toEqual([]);
  });

  it('retry forwards to the controller', async () => {
    const controller = { bind: vi.fn(), unbind: vi.fn(), retry: vi.fn() };
    const h = makeServiceCommandHandlers(controller, fakeMemento());
    await h.retry(item('x'));
    expect(controller.retry).toHaveBeenCalledWith('x');
  });

  it('copyAddress writes the remote addr to the clipboard', async () => {
    const writeText = vi.fn(async () => {});
    const h = makeServiceCommandHandlers({ bind: vi.fn(), unbind: vi.fn(), retry: vi.fn() }, fakeMemento(), { writeText });
    await h.copyAddress(item('x', '127.0.0.1:5432'));
    expect(writeText).toHaveBeenCalledWith('127.0.0.1:5432');
  });

  it('copyAddress is a no-op when the item has no remote address', async () => {
    const writeText = vi.fn(async () => {});
    const h = makeServiceCommandHandlers({ bind: vi.fn(), unbind: vi.fn(), retry: vi.fn() }, fakeMemento(), { writeText });
    await h.copyAddress(item('x', null));
    expect(writeText).not.toHaveBeenCalled();
  });
});
