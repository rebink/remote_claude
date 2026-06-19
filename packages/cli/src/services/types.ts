// packages/cli/src/services/types.ts
import type { TunnelHandle } from '../lib/reverse-tunnel.ts';
export type { TunnelHandle } from '../lib/reverse-tunnel.ts';

export type ServiceKind = 'docker' | 'dart-vm' | 'dart-server' | 'generic';
export type ProjectionStatus = 'binding' | 'active' | 'reconnecting' | 'stale' | 'failed';

export interface DiscoveredService {
  /** Stable across discovery runs: derived from kind + identity + localPort. */
  id: string;
  label: string;
  kind: ServiceKind;
  localPort: number;
  /** References 127.0.0.1 only; never carries credentials. */
  connectionHint: string;
  meta?: Record<string, string>;
}

export interface Projection {
  service: DiscoveredService;
  remotePort: number;
  mirrored: boolean;
  status: ProjectionStatus;
}

export interface SshTarget {
  host: string;
  user: string;
  port: number;
  keyPath: string;
}

export interface Discoverer {
  discover(): Promise<DiscoveredService[]>;
}

export interface Transport {
  /** Open a reverse tunnel; `onClose(code)` fires when ssh exits (null = killed). */
  open(o: { localPort: number; remotePort: number }, onClose: (code: number | null) => void): TunnelHandle;
}

export interface ServiceProjectionManager {
  bind(service: DiscoveredService): Promise<Projection>;
  unbind(id: string): Promise<void>;
  status(): Projection[];
  on(event: 'change', cb: (projections: Projection[]) => void): void;
  stopAll(): void;
}
