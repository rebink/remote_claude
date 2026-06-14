import { describe, it, expect } from 'vitest';
function captureStdout(fn: () => Promise<void>): Promise<string> {
  const writes: string[] = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((c: unknown) => { writes.push(String(c)); return true; }) as typeof process.stdout.write;
  return fn().finally(() => { process.stdout.write = orig; }).then(() => writes.join(''));
}
const INPUT = { host: '10.0.0.2', user: 'admin', port: 22, keyPath: '/k', agentPort: 7878 };
describe('runHostCheck', () => {
  it('healthy agent → {ok:true, healthy:true, version}', async () => {
    const ssh = async () => ({ code: 0, stdout: '{"ok":true,"version":"0.3.18","claude":{"found":true}}', stderr: '' });
    const { runHostCheck } = await import('../../src/commands/host-ops.ts');
    const out = await captureStdout(() => runHostCheck(INPUT, { ssh }));
    expect(JSON.parse(out)).toMatchObject({ ok: true, healthy: true, version: '0.3.18' });
  });
  it('agent unreachable → {ok:false, code:unreachable}', async () => {
    const ssh = async () => ({ code: 0, stdout: 'PW_UNREACHABLE', stderr: '' });
    const { runHostCheck } = await import('../../src/commands/host-ops.ts');
    const out = await captureStdout(() => runHostCheck(INPUT, { ssh }));
    expect(JSON.parse(out)).toMatchObject({ ok: false, code: 'unreachable' });
  });
  it('ssh failure (nonzero) → unreachable', async () => {
    const ssh = async () => ({ code: 255, stdout: '', stderr: 'Connection refused' });
    const { runHostCheck } = await import('../../src/commands/host-ops.ts');
    const out = await captureStdout(() => runHostCheck(INPUT, { ssh }));
    expect(JSON.parse(out)).toMatchObject({ ok: false, code: 'unreachable' });
  });
  it('rejects an option-injection host → invalid_input, no ssh', async () => {
    let called = false;
    const ssh = async () => { called = true; return { code: 0, stdout: '', stderr: '' }; };
    const { runHostCheck } = await import('../../src/commands/host-ops.ts');
    const out = await captureStdout(() => runHostCheck({ ...INPUT, host: '-oProxyCommand=x' }, { ssh }));
    expect(called).toBe(false);
    expect(JSON.parse(out)).toMatchObject({ ok: false, code: 'invalid_input' });
  });
});
describe('runHostUninstall', () => {
  it('ssh ok → {ok:true} and runs patchwire-agent uninstall', async () => {
    let cmd = '';
    const ssh = async (o: { command: string }) => { cmd = o.command; return { code: 0, stdout: 'removed', stderr: '' }; };
    const { runHostUninstall } = await import('../../src/commands/host-ops.ts');
    const out = await captureStdout(() => runHostUninstall(INPUT, { ssh }));
    expect(JSON.parse(out)).toMatchObject({ ok: true });
    expect(cmd).toContain('patchwire-agent uninstall');
  });
  it('ssh nonzero → {ok:false, code:uninstall_failed}', async () => {
    const ssh = async () => ({ code: 1, stdout: '', stderr: 'no service' });
    const { runHostUninstall } = await import('../../src/commands/host-ops.ts');
    const out = await captureStdout(() => runHostUninstall(INPUT, { ssh }));
    expect(JSON.parse(out)).toMatchObject({ ok: false, code: 'uninstall_failed', detail: 'no service' });
  });
  it('rejects bad input', async () => {
    let called = false;
    const ssh = async () => { called = true; return { code: 0, stdout: '', stderr: '' }; };
    const { runHostUninstall } = await import('../../src/commands/host-ops.ts');
    await captureStdout(() => runHostUninstall({ ...INPUT, keyPath: '-x' }, { ssh }));
    expect(called).toBe(false);
  });
});
