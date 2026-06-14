import { runSsh, type SshOpts } from '../lib/ssh-runner.ts';
import { POSIX_PATH_PREFIX, POSIX_PNPM_ENV } from '../agent/provision/primitives.ts';

export interface HostOpInput {
  host: string;
  user: string;
  port: number;
  keyPath: string;
  agentPort: number;
}

export type SshRunner = (opts: SshOpts) => Promise<{ code: number | null; stdout: string; stderr: string }>;

const HOST_RE = /^[A-Za-z0-9._:-]+$/;
const USER_RE = /^[A-Za-z0-9._-]+$/;

export function badHostField(i: HostOpInput): string | null {
  if (i.host.startsWith('-') || !HOST_RE.test(i.host)) return 'host';
  if (i.user.startsWith('-') || !USER_RE.test(i.user)) return 'user';
  if (i.keyPath.startsWith('-') || i.keyPath === '') return 'keyPath';
  if (!Number.isInteger(i.port) || i.port < 1 || i.port > 65535) return 'port';
  if (!Number.isInteger(i.agentPort) || i.agentPort < 1 || i.agentPort > 65535) return 'agentPort';
  return null;
}

function emit(o: unknown) {
  process.stdout.write(JSON.stringify(o) + '\n');
}

export async function runHostCheck(input: HostOpInput, deps: { ssh?: SshRunner } = {}): Promise<void> {
  const bad = badHostField(input);
  if (bad) {
    emit({ ok: false, code: 'invalid_input', detail: `unsafe ${bad}` });
    return;
  }
  const ssh = deps.ssh ?? runSsh;
  const command = `curl -fsS -m 5 http://127.0.0.1:${input.agentPort}/health 2>/dev/null || echo PW_UNREACHABLE`;
  const r = await ssh({ host: input.host, user: input.user, port: input.port, keyPath: input.keyPath, command });
  const out = r.stdout.trim();
  if (r.code !== 0 || out === '' || out.includes('PW_UNREACHABLE')) {
    emit({ ok: false, code: 'unreachable', detail: (r.stderr || 'agent not reachable on the host').trim() });
    return;
  }
  try {
    const h = JSON.parse(out) as { ok?: boolean; version?: string };
    emit({ ok: true, healthy: h.ok === true, version: h.version });
  } catch {
    emit({ ok: false, code: 'bad_response', detail: out.slice(0, 120) });
  }
}
