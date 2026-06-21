// packages/cli/src/services/manifest.ts
import { mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import type { Projection } from './types.ts';

export interface ManifestEntry {
  id: string;
  label: string;
  kind: string;
  host: '127.0.0.1';
  remotePort: number;
  localPort: number;
  connectionHint: string;
  mirrored: boolean;
  status: string;
}

export function manifestPath(projectDir: string): string {
  return join(projectDir, '.patchwire', 'services.json');
}

function toEntry(p: Projection): ManifestEntry {
  return {
    id: p.service.id,
    label: p.service.label,
    kind: p.service.kind,
    host: '127.0.0.1',
    remotePort: p.remotePort,
    localPort: p.service.localPort,
    connectionHint: p.service.connectionHint,
    mirrored: p.mirrored,
    status: p.status,
  };
}

/** Write the manifest 0o600. Returns the path written. */
export function writeManifest(projectDir: string, projections: Projection[]): string {
  const dir = join(projectDir, '.patchwire');
  mkdirSync(dir, { recursive: true });
  const path = manifestPath(projectDir);
  const body = JSON.stringify({ version: 1, services: projections.map(toEntry) }, null, 2);
  writeFileSync(path, body, { mode: 0o600 });
  chmodSync(path, 0o600);
  return path;
}

export function readManifest(projectDir: string): ManifestEntry[] {
  const path = manifestPath(projectDir);
  if (!existsSync(path)) return [];
  try {
    const o = JSON.parse(readFileSync(path, 'utf8')) as { services?: ManifestEntry[] };
    return o.services ?? [];
  } catch {
    return [];
  }
}
