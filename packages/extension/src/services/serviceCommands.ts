import * as vscode from 'vscode';
import type { ServiceItem } from './ServicesTreeProvider.ts';

const KEY = 'patchwire.boundServiceIds';

export interface Memento {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

export interface ServiceController {
  bind(id: string): void;
  unbind(id: string): void;
  retry(id: string): void;
}

export interface Clipboard { writeText(text: string): Thenable<void>; }

export function boundIdsFrom(state: Memento): Set<string> {
  return new Set(state.get<string[]>(KEY, []));
}

export interface ServiceCommandHandlers {
  bind(item: ServiceItem): Promise<void>;
  unbind(item: ServiceItem): Promise<void>;
  retry(item: ServiceItem): Promise<void>;
  copyAddress(item: ServiceItem): Promise<void>;
}

export function makeServiceCommandHandlers(
  controller: ServiceController,
  state: Memento,
  clipboard: Clipboard = vscode.env.clipboard,
): ServiceCommandHandlers {
  const persist = async (ids: Set<string>) => state.update(KEY, [...ids]);
  return {
    async bind(item) {
      controller.bind(item.data.id);
      const ids = boundIdsFrom(state);
      ids.add(item.data.id);
      await persist(ids);
    },
    async unbind(item) {
      controller.unbind(item.data.id);
      const ids = boundIdsFrom(state);
      ids.delete(item.data.id);
      await persist(ids);
    },
    async retry(item) {
      controller.retry(item.data.id);
    },
    async copyAddress(item) {
      if (item.data.remoteAddr) await clipboard.writeText(item.data.remoteAddr);
    },
  };
}
