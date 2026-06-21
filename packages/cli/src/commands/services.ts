// packages/cli/src/commands/services.ts
import type { Command } from 'commander';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveProjectKey } from '../lib/project-key.ts';
import type { Readable, Writable } from 'node:stream';
import { parse as parseYaml } from 'yaml';
import { ConfigSchema } from '../lib/config.ts';
import { makeDockerDiscoverer } from '../services/discoverers/docker.ts';
import { parseDartOutput } from '../services/discoverers/dart.ts';
import { makeSshTransport } from '../services/transport-ssh.ts';
import { makeManager } from '../services/manager.ts';
import { writeManifest } from '../services/manifest.ts';
import { log } from '../lib/log.ts';
import { makeLineReader } from './setup.ts';
import type { DiscoveredService, Projection, SshTarget } from '../services/types.ts';
import { runServicesSession, type SessionIo } from '../services/session.ts';

/** True for y / yes (case-insensitive), false for everything else including empty. */
export function isAffirmative(answer: string): boolean {
  return /^y(es)?$/i.test(answer.trim());
}

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

/** Build a SessionIo over a readable line source and a writable sink (NDJSON). */
export function makeStdioIo(source: Readable, sink: Writable): SessionIo {
  let buf = '';
  let lineCb: (l: string) => void = () => {};
  source.on('data', (chunk: Buffer | string) => {
    buf += chunk.toString();
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      lineCb(line);
      nl = buf.indexOf('\n');
    }
  });
  return {
    onLine: (cb) => { lineCb = cb; },
    write: (obj) => { sink.write(JSON.stringify(obj) + '\n'); },
    onClose: (cb) => { source.on('end', cb); source.on('close', cb); },
  };
}

/** Read host/user/port from patchwire.yml in cwd. Uses per-project SSH key if present, else '' (SSH agent). */
function loadSshTarget(): SshTarget {
  const raw = parseYaml(readFileSync(resolve(process.cwd(), 'patchwire.yml'), 'utf8'));
  const cfg = ConfigSchema.parse(raw);
  const kp = resolveProjectKey(cfg.remote.host, cfg.remote.user);
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
    .option('--yes', 'skip confirmation prompt (for non-interactive / headless use)')
    .action(async (idOrPort: string, opts: { yes?: boolean }) => {
      const docker = await makeDockerDiscoverer().discover();
      const dart = parseDartOutput(process.env.PW_DART_OUTPUT ?? '');
      const all = aggregateDiscovered([docker, dart]);
      const svc = all.find((s) => s.id === idOrPort || String(s.localPort) === idOrPort);
      if (!svc) {
        log.err(`No service matches "${idOrPort}". Run \`patchwire services discover\` to list available services.`);
        process.exitCode = 1;
        return;
      }

      if (!opts.yes) {
        process.stdout.write(
          `About to expose local 127.0.0.1:${svc.localPort} (${svc.label}) on the remote agent's loopback. Proceed? [y/N] `,
        );
        const readLine = makeLineReader(process.stdin);
        const answer = await readLine();
        if (!isAffirmative(answer)) {
          log.info('Aborted.');
          return;
        }
      }

      const manager = makeManager(makeSshTransport(loadSshTarget()));
      manager.on('change', (ps) => writeManifest(process.cwd(), ps));
      const p = await manager.bind(svc);
      log.ok(`Bound ${p.service.label}: 127.0.0.1:${p.remotePort} on remote (${p.mirrored ? 'mirrored' : 'remapped'}).`);
      log.info(renderStatus(manager.status()));
    });

  cmd
    .command('serve')
    .description('Long-lived projection session: NDJSON commands on stdin, events on stdout')
    .option('--stream', 'stream NDJSON events (required)')
    .action(() => {
      const target = loadSshTarget();
      const manager = makeManager(makeSshTransport(target));
      const io = makeStdioIo(process.stdin, process.stdout);
      process.stdin.resume();
      runServicesSession(io, {
        manager,
        discover: async (dartVmUri?: string) => {
          const docker = await makeDockerDiscoverer().discover();
          const dart = parseDartOutput(dartVmUri ?? process.env.PW_DART_OUTPUT ?? '');
          return aggregateDiscovered([docker, dart]);
        },
        onManifest: (projections) => { try { writeManifest(process.cwd(), projections); } catch { /* ignore */ } },
      });
    });
}
