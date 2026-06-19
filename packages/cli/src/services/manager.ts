// packages/cli/src/services/manager.ts
import { firstStablePort } from './mirror.ts';
import type {
  DiscoveredService, Projection, ServiceProjectionManager, Transport, TunnelHandle,
} from './types.ts';

interface ManagerDeps {
  /** Probe window passed to firstStablePort (injectable for tests). */
  probe?: () => Promise<void>;
  /** Backoff before a reconnect attempt (injectable for tests). */
  delay?: () => Promise<void>;
}

interface Entry {
  projection: Projection;
  handle: TunnelHandle;
  stopped: boolean;
}

export function makeManager(transport: Transport, deps: ManagerDeps = {}): ServiceProjectionManager {
  const entries = new Map<string, Entry>();
  const listeners: ((p: Projection[]) => void)[] = [];
  const delay = deps.delay ?? (() => new Promise<void>((r) => setTimeout(r, 1000)));

  const snapshot = () => [...entries.values()].map((e) => e.projection);
  const emit = () => { const s = snapshot(); for (const l of listeners) l(s); };

  function supervise(entry: Entry, onClose: (code: number | null) => void) {
    // Re-open the SAME remote port, wiring the same close handler back in.
    entry.handle = transport.open(
      { localPort: entry.projection.service.localPort, remotePort: entry.projection.remotePort },
      onClose,
    );
  }

  function makeOnClose(entry: Entry): (code: number | null) => void {
    // P1: flat backoff, retries forever. The 'failed' (give-up after N attempts)
    // and 'stale' (service vanished) statuses in ProjectionStatus are reserved
    // for P2 and are intentionally never set here yet.
    const onClose = async () => {
      if (entry.stopped) return;
      entry.projection.status = 'reconnecting';
      emit();
      await delay();
      if (entry.stopped) return;
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
      const entry: Entry = { projection, handle, stopped: false };
      entries.set(service.id, entry);

      // Replace the throwaway probe handle's close wiring with supervision.
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
