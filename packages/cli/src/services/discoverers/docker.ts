// packages/cli/src/services/discoverers/docker.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Discoverer, DiscoveredService } from '../types.ts';

const pexec = promisify(execFile);

interface DockerInfo { kind: string; label: string; scheme: string }

/** Map a Docker image (name[:tag]) to a known service kind + connection scheme. */
function classify(image: string): DockerInfo {
  const withoutTag = image.split(':')[0] ?? image;
  const base = withoutTag.split('/').at(-1) ?? withoutTag;
  switch (base) {
    case 'postgres': return { kind: 'postgres', label: 'Postgres', scheme: 'postgres' };
    case 'mysql':
    case 'mariadb': return { kind: 'mysql', label: 'MySQL', scheme: 'mysql' };
    case 'redis': return { kind: 'redis', label: 'Redis', scheme: 'redis' };
    case 'mongo': return { kind: 'mongo', label: 'MongoDB', scheme: 'mongodb' };
    default: return { kind: 'generic', label: base, scheme: 'tcp' };
  }
}

/** First published host port from a docker Ports string, or null. */
function firstHostPort(ports: string): number | null {
  // e.g. "0.0.0.0:5432->5432/tcp, :::5432->5432/tcp"
  const m = ports.match(/:(\d+)->/);
  return m ? Number(m[1]) : null;
}

/** Parse `docker ps --format '{{json .}}'` (one JSON object per line). */
export function parseDockerPs(stdout: string): DiscoveredService[] {
  const out: DiscoveredService[] = [];
  for (const line of stdout.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let row: { Names?: string; Image?: string; Ports?: string };
    try { row = JSON.parse(t); } catch { continue; }
    const port = firstHostPort(row.Ports ?? '');
    if (port == null) continue;
    const name = row.Names ?? 'container';
    const info = classify(row.Image ?? '');
    out.push({
      id: `docker:${name}:${port}`,
      label: `${info.label} (${name})`,
      kind: 'docker',
      localPort: port,
      connectionHint: `${info.scheme}://127.0.0.1:${port}`,
      meta: { image: row.Image ?? '', container: name },
    });
  }
  return out;
}

export type DockerRunner = () => Promise<string>;

const defaultRunner: DockerRunner = async () => {
  const { stdout } = await pexec('docker', ['ps', '--format', '{{json .}}']);
  return stdout;
};

/** Discoverer that returns [] if Docker is unavailable (never throws). */
export function makeDockerDiscoverer(runner: DockerRunner = defaultRunner): Discoverer {
  return {
    async discover() {
      try { return parseDockerPs(await runner()); }
      catch { return []; }
    },
  };
}
