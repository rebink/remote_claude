// packages/cli/src/commands/services.ts
import type { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ConfigSchema } from '../lib/config.ts';
import { makeDockerDiscoverer } from '../services/discoverers/docker.ts';
import { parseDartOutput } from '../services/discoverers/dart.ts';
import { makeSshTransport } from '../services/transport-ssh.ts';
import { makeManager } from '../services/manager.ts';
import { writeManifest } from '../services/manifest.ts';
import { log } from '../lib/log.ts';
import type { DiscoveredService, Projection, SshTarget } from '../services/types.ts';

/** Merge discoverer outputs, de-duping by service id. */
export function aggregateDiscovered(lists: DiscoveredService[][]): DiscoveredService[] {
  const byId = new Map<string, DiscoveredService>();
  for (const list of lists) for (const s of list) if (!byId.has(s.id)) byId.set(s.id, s);
  return [...byId.values()];
}

/** One line per projection: id  local→remote  mirrored  status. */
export function renderStatus(projections: Projection[]): string {
  if (projections.length === 0) return 'No services bound.';
  return projections
    .map((p) => `${p.service.id}\t${p.service.localPort}→${p.remotePort}\t${p.mirrored ? 'mirror' : 'remap'}\t${p.status}`)
    .join('\n');
}

/** Read host/user/port from patchwire.yml in cwd. Uses per-project SSH key if present, else '' (SSH agent). */
function loadSshTarget(): SshTarget {
  const raw = parseYaml(readFileSync(resolve(process.cwd(), 'patchwire.yml'), 'utf8'));
  const cfg = ConfigSchema.parse(raw);
  const kp = join(homedir(), '.patchwire', 'keys', `${cfg.remote.host}-${cfg.remote.user}`);
  return {
    host: cfg.remote.host,
    user: cfg.remote.user,
    port: cfg.remote.sshPort ?? 22,
    keyPath: existsSync(kp) ? kp : '',
  };
}

export function registerServicesCommand(program: Command): void {
  const cmd = program.command('services').description('Project local services (DBs, Dart servers) onto the remote agent');

  cmd
    .command('discover')
    .description('List local Docker/Dart services that can be projected')
    .action(async () => {
      const docker = await makeDockerDiscoverer().discover();
      const dart = parseDartOutput(process.env.PW_DART_OUTPUT ?? '');
      const all = aggregateDiscovered([docker, dart]);
      for (const s of all) log.info(`${s.id}\t${s.label}\t${s.connectionHint}`);
      if (all.length === 0) log.info('No services discovered.');
    });

  cmd
    .command('bind <idOrPort>')
    .description('Bind one discovered service onto the remote loopback')
    .action(async (idOrPort: string) => {
      const docker = await makeDockerDiscoverer().discover();
      const dart = parseDartOutput(process.env.PW_DART_OUTPUT ?? '');
      const all = aggregateDiscovered([docker, dart]);
      const svc = all.find((s) => s.id === idOrPort || String(s.localPort) === idOrPort);
      if (!svc) { log.err(`No discovered service matches "${idOrPort}".`); process.exitCode = 1; return; }

      const manager = makeManager(makeSshTransport(loadSshTarget()));
      manager.on('change', (ps) => writeManifest(process.cwd(), ps));
      const p = await manager.bind(svc);
      log.ok(`Bound ${p.service.label}: 127.0.0.1:${p.remotePort} on remote (${p.mirrored ? 'mirrored' : 'remapped'}).`);
      log.info(renderStatus(manager.status()));
    });
}
