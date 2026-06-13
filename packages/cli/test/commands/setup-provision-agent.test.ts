import { describe, it, expect, vi, afterEach } from 'vitest';
import * as cp from 'node:child_process';
import * as fs from 'node:fs';

vi.mock('node:child_process');
vi.mock('node:fs');
vi.mock('undici', () => ({ fetch: vi.fn(async () => ({ ok: true })) }));

afterEach(() => vi.restoreAllMocks());

function captureStdout(fn: () => Promise<void>): Promise<string> {
  const writes: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((c: unknown) => { writes.push(String(c)); return true; }) as typeof process.stdout.write;
  return fn().finally(() => { process.stdout.write = orig; }).then(() => writes.join(''));
}

const TOKEN = 'a1b2c3d4e5f60718293a4b5c'; // valid: hex-ish, ≥16 chars

describe('setup --provision-agent', () => {
  it('ssh-installs via a login shell, writes the token, and reports healthy', async () => {
    vi.spyOn(cp, 'spawnSync').mockReturnValue({ status: 0, stdout: '', stderr: '' } as never);
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);
    vi.spyOn(fs, 'mkdirSync').mockReturnValue(undefined as never);
    const wf = vi.spyOn(fs, 'writeFileSync').mockReturnValue(undefined as never);
    vi.spyOn(fs, 'chmodSync').mockReturnValue(undefined as never);
    const { runProvisionAgent } = await import('../../src/commands/setup.ts');

    const out = await captureStdout(() => runProvisionAgent({
      host: 'h', user: 'u', port: 22, keyPath: '/k', agentPort: 7878, token: TOKEN,
    }));

    expect(JSON.parse(out)).toEqual({ ok: true, healthy: true });
    const sshArgs = (cp.spawnSync as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] as string[];
    expect(sshArgs.join(' ')).toMatch(/bash -lc/);
    expect(sshArgs.join(' ')).toMatch(/corepack enable/);
    expect(sshArgs.join(' ')).toMatch(/pnpm add -g @rebink\/patchwire/);
    expect(sshArgs.join(' ')).not.toMatch(/npm i -g/);
    expect(sshArgs.join(' ')).toMatch(/agent\.env/);
    expect(sshArgs.join(' ')).not.toContain(TOKEN); // token rides stdin, not the command
    expect(sshArgs.join(' ')).toMatch(/patchwire-agent install/);
    expect(sshArgs.join(' ')).not.toMatch(/--token/);
    expect(sshArgs).toEqual(expect.arrayContaining(['-o', 'IdentitiesOnly=yes']));
    // token written to local ~/.patchwire/env
    expect(wf.mock.calls.some((c) => String(c[0]).endsWith('.patchwire/env') && String(c[1]).includes(`PW_TOKEN=${TOKEN}`))).toBe(true);
  });

  it('maps a missing remote Node to code no_node', async () => {
    vi.spyOn(cp, 'spawnSync').mockReturnValue({ status: 3, stdout: 'PW_NO_NODE\n', stderr: '' } as never);
    const { runProvisionAgent } = await import('../../src/commands/setup.ts');
    const out = await captureStdout(() => runProvisionAgent({ host: 'h', user: 'u', port: 22, keyPath: '/k', agentPort: 7878, token: TOKEN }));
    expect(JSON.parse(out).code).toBe('no_node');
  });

  it('rejects shell-metacharacter inputs without running ssh (command-injection guard)', async () => {
    const spy = vi.spyOn(cp, 'spawnSync').mockReturnValue({ status: 0, stdout: '', stderr: '' } as never);
    const { runProvisionAgent } = await import('../../src/commands/setup.ts');
    const out = await captureStdout(() => runProvisionAgent({
      host: 'h; rm -rf ~', user: 'u', port: 22, keyPath: '/k', agentPort: 7878, token: TOKEN,
    }));
    expect(JSON.parse(out)).toEqual({ ok: false, code: 'invalid_input', stderr: 'Refusing to provision: unsafe host.' });
    expect(spy).not.toHaveBeenCalled();
  });
});
