// packages/cli/src/services/session.ts
import type { DiscoveredService, Projection, ServiceProjectionManager } from './types.ts';

export interface SessionIo {
  onLine(cb: (line: string) => void): void;
  write(obj: unknown): void;
  onClose(cb: () => void): void;
}

export interface SessionDeps {
  manager: ServiceProjectionManager;
  discover: (dartVmUri?: string) => Promise<DiscoveredService[]>;
  /** Called with the latest projections on every manager change (manifest write). */
  onManifest?: (projections: Projection[]) => void;
}

interface Command {
  cmd?: string;
  id?: string;
  dartVmUri?: string;
}

/** Run the NDJSON command/event loop over an injectable IO. */
export function runServicesSession(io: SessionIo, deps: SessionDeps): void {
  const { manager, discover, onManifest } = deps;
  let candidates: DiscoveredService[] = [];

  manager.on('change', (projections) => {
    io.write({ type: 'status', projections });
    onManifest?.(projections);
  });

  io.onLine((line) => {
    const text = line.trim();
    if (!text) return;
    let msg: Command;
    try {
      msg = JSON.parse(text) as Command;
    } catch {
      io.write({ type: 'error', message: `bad command: ${text}` });
      return;
    }
    void handle(msg);
  });

  io.onClose(() => manager.stopAll());

  async function handle(msg: Command): Promise<void> {
    try {
      switch (msg.cmd) {
        case 'discover': {
          candidates = await discover(msg.dartVmUri);
          io.write({ type: 'candidates', services: candidates });
          manager.refresh(candidates);
          return;
        }
        case 'bind': {
          const svc = candidates.find((s) => s.id === msg.id);
          if (!svc) { io.write({ type: 'error', message: `unknown service id: ${msg.id}` }); return; }
          await manager.bind(svc);
          return;
        }
        case 'unbind':
          if (msg.id) await manager.unbind(msg.id);
          return;
        case 'retry':
          if (msg.id) await manager.retry(msg.id);
          return;
        default:
          io.write({ type: 'error', message: `unknown cmd: ${String(msg.cmd)}` });
      }
    } catch (e) {
      io.write({ type: 'error', message: (e as Error).message ?? String(e) });
    }
  }
}
