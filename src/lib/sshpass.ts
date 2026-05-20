import { existsSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function resolveSshpassPath(): string {
  const platformKey = `${process.platform}-${process.arch}`;
  const vendored = join(__dirname, '..', '..', 'vendor', 'sshpass', `sshpass-${platformKey}`);
  if (existsSync(vendored)) return vendored;

  const system = spawnSync('which', ['sshpass'], { encoding: 'utf8' });
  if (system.status === 0 && system.stdout.trim()) return system.stdout.trim();

  throw new Error(
    'sshpass not found. Install with: brew install hudochenkov/sshpass/sshpass (macOS) or apt-get install sshpass (Linux).',
  );
}

export interface CopyIdInput {
  host: string;
  user: string;
  port: number;
  keyPath: string; // path to .pub key (without .pub suffix)
  password: string; // zeroed by caller after this returns
}

export type CopyIdResult =
  | { ok: true }
  | {
      ok: false;
      code: 'auth_failed' | 'unreachable' | 'host_key_mismatch' | 'unknown';
      stderr: string;
    };

export async function copyIdWithPassword(input: CopyIdInput): Promise<CopyIdResult> {
  const sshpass = resolveSshpassPath();
  const args = [
    '-d0', // password on fd 0 (stdin)
    'ssh-copy-id',
    '-i',
    `${input.keyPath}.pub`,
    '-p',
    String(input.port),
    '-o',
    'StrictHostKeyChecking=accept-new',
    `${input.user}@${input.host}`,
  ];

  return new Promise((resolve) => {
    const child = spawn(sshpass, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString();
    });

    const pwBuf = Buffer.from(input.password + '\n', 'utf8');
    child.stdin.write(pwBuf);
    child.stdin.end();
    pwBuf.fill(0);

    child.on('close', (code: number | null) => {
      if (code === 0) return resolve({ ok: true });
      if (/Permission denied/i.test(stderr)) return resolve({ ok: false, code: 'auth_failed', stderr });
      if (/Connection refused|No route to host|Could not resolve/i.test(stderr))
        return resolve({ ok: false, code: 'unreachable', stderr });
      if (/REMOTE HOST IDENTIFICATION HAS CHANGED|host key/i.test(stderr))
        return resolve({ ok: false, code: 'host_key_mismatch', stderr });
      resolve({ ok: false, code: 'unknown', stderr });
    });
  });
}
