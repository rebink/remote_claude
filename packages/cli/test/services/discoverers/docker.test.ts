// packages/cli/test/services/discoverers/docker.test.ts
import { describe, it, expect } from 'vitest';
import { parseDockerPs, makeDockerDiscoverer } from '../../../src/services/discoverers/docker.ts';

const PG_LINE = JSON.stringify({ Names: 'pw-db', Image: 'postgres:16', Ports: '0.0.0.0:5432->5432/tcp, :::5432->5432/tcp' });
const REDIS_LINE = JSON.stringify({ Names: 'cache', Image: 'redis:7', Ports: '0.0.0.0:6379->6379/tcp' });
const NOPORT_LINE = JSON.stringify({ Names: 'worker', Image: 'busybox', Ports: '' });

describe('parseDockerPs', () => {
  it('maps a postgres container to a docker service with the published port + hint', () => {
    const [svc] = parseDockerPs(PG_LINE);
    expect(svc).toMatchObject({
      kind: 'docker', localPort: 5432, label: 'Postgres (pw-db)',
      connectionHint: 'postgres://127.0.0.1:5432',
    });
    expect(svc.id).toBe('docker:pw-db:5432');
  });

  it('infers redis hint and skips containers with no published port', () => {
    const out = parseDockerPs([REDIS_LINE, NOPORT_LINE].join('\n'));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ localPort: 6379, connectionHint: 'redis://127.0.0.1:6379' });
  });

  it('returns [] for empty output', () => {
    expect(parseDockerPs('')).toEqual([]);
  });
});

describe('makeDockerDiscoverer', () => {
  it('returns [] when the docker command fails (daemon down)', async () => {
    const d = makeDockerDiscoverer(async () => { throw new Error('Cannot connect to the Docker daemon'); });
    expect(await d.discover()).toEqual([]);
  });

  it('parses the runner output when docker is up', async () => {
    const d = makeDockerDiscoverer(async () => PG_LINE);
    const out = await d.discover();
    expect(out[0].localPort).toBe(5432);
  });
});
