// packages/cli/src/services/manager.ts
import { firstStablePort } from './mirror.ts';
import type {
  DiscoveredService, Projection, ServiceProjectionManager, Transport, TunnelHandle,
} from './types.ts';

interface ManagerDeps {
  /** Probe window passed to firstStablePort (injectable for tests). */
  probe?: () => Promise<void>;
  /** Sleeper for the reconnect backoff; receives the computed ms (injectable for tests). */
  delay?: (ms: number) => Promise<void>;
  /** Backoff in ms for a given 1-based attempt. Default: 1s,2s,4s,… capped at 30s. */
  backoff?: (attempt: number) => number;
  /** Consecutive failed reconnects before giving up (status 'failed'). Default 6. */
  maxAttempts?: number;
}

interface Entry {
  projection: Projection;
  handle: TunnelHandle;
  stopped: boolean;
  attempts: number;
}

export function makeManager(transport: Transport, deps: ManagerDeps = {}): ServiceProjectionManager {
  const entries = new Map<string, Entry>();
  const listeners: ((p: Projection[]) => void)[] = [];
  const delay = deps.delay ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const backoff = deps.backoff ?? ((attempt: number) => Math.min(1000 * 2 ** (attempt - 1), 30_000));
  const maxAttempts = deps.maxAttempts ?? 6;

  const snapshot = () => [...entries.values()].map((e) => e.projection);
  const emit = () => { const s = snapshot(); for (const l of listeners) l(s); };

  function supervise(entry: Entry, onClose: (code: number | null) => void) {
    entry.handle = transport.open(
      { localPort: entry.projection.service.localPort, remotePort: entry.projection.remotePort },
      onClose,
    );
  }

  function makeOnClose(entry: Entry): (code: number | null) => void {
    const onClose = async () => {
      if (entry.stopped || entry.projection.status === 'stale') return;
      entry.attempts += 1;
      if (entry.attempts > maxAttempts) {
        entry.projection.status = 'failed';
        emit();
        return;
      }
      entry.projection.status = 'reconnecting';
      emit();
      await delay(backoff(entry.attempts));
      if (entry.stopped || entry.projection.status === 'stale') return;
      supervise(entry, onClose);
      entry.projection.status = 'active';
      emit();
    };
    return onClose;
  }

  return {
    async bind(service: DiscoveredService): Promise<Projection> {
      const existing = entries.get(service.id);
      if (existing) return existing.projection;

      const { handle, remotePort, mirrored } = await firstStablePort(transport, service.localPort, { probe: deps.probe });
      const projection: Projection = { service, remotePort, mirrored, status: 'active' };
      const entry: Entry = { projection, handle, stopped: false, attempts: 0 };
      entries.set(service.id, entry);

      const onClose = makeOnClose(entry);
      entry.handle.stop();
      supervise(entry, onClose);

      emit();
      return projection;
    },

    async unbind(id: string): Promise<void> {
      const entry = entries.get(id);
      if (!entry) return;
      entry.stopped = true;
      entry.handle.stop();
      entries.delete(id);
      emit();
    },

    refresh(present: DiscoveredService[]): void {
      const ids = new Set(present.map((s) => s.id));
      for (const entry of entries.values()) {
        if (!ids.has(entry.projection.service.id) && entry.projection.status !== 'stale') {
          entry.projection.status = 'stale';
          entry.handle.stop(); // onClose returns early because status === 'stale'
        }
      }
      emit();
    },

    async retry(id: string): Promise<void> {
      const entry = entries.get(id);
      if (!entry) return;
      entry.stopped = false;
      entry.attempts = 0;
      entry.projection.status = 'reconnecting';
      emit();
      const { handle, remotePort, mirrored } = await firstStablePort(transport, entry.projection.service.localPort, { probe: deps.probe });
      entry.handle = handle;
      entry.projection.remotePort = remotePort;
      entry.projection.mirrored = mirrored;
      entry.handle.stop();
      supervise(entry, makeOnClose(entry));
      entry.projection.status = 'active';
      emit();
    },

    status(): Projection[] {
      return snapshot();
    },

    on(_event: 'change', cb: (p: Projection[]) => void): void {
      listeners.push(cb);
    },

    stopAll(): void {
      for (const entry of entries.values()) {
        entry.stopped = true;
        entry.handle.stop();
      }
      entries.clear();
      emit();
    },
  };
}
