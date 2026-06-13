import { describe, it, expect } from 'vitest';
import { corepackPnpmInstaller } from '../../../src/agent/provision/installer.ts';
import type { RemoteRunner } from '../../../src/agent/provision/installer.ts';

const CONN = { host: 'h', user: 'u', port: 22, keyPath: '/k' };

/** Records every command and returns scripted results in order (or a default). */
function fakeRunner(results: Array<{ stdout?: string; stderr?: string; code: number }>): {
  runner: RemoteRunner;
  commands: string[];
} {
  const commands: string[] = [];
  let i = 0;
  const runner: RemoteRunner = async (command) => {
    commands.push(command);
    const r = results[i++] ?? { code: 0 };
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.code };
  };
  return { runner, commands };
}

describe('corepackPnpmInstaller.version / check', () => {
  it('version returns the trimmed CLI version, or null on non-zero exit', async () => {
    const ok = corepackPnpmInstaller(CONN, fakeRunner([{ stdout: '0.3.18\n', code: 0 }]).runner);
    expect(await ok.version()).toBe('0.3.18');

    const missing = corepackPnpmInstaller(CONN, fakeRunner([{ code: 127 }]).runner);
    expect(await missing.version()).toBeNull();
  });

  it('check reports present/version from the version probe', async () => {
    const present = corepackPnpmInstaller(CONN, fakeRunner([{ stdout: '0.3.18', code: 0 }]).runner);
    expect(await present.check()).toEqual({ present: true, version: '0.3.18' });

    const absent = corepackPnpmInstaller(CONN, fakeRunner([{ code: 127 }]).runner);
    expect(await absent.check()).toEqual({ present: false });
  });
});

describe('corepackPnpmInstaller.install / uninstall', () => {
  it('install runs corepack+pnpm and returns ok with a compensating uninstall', async () => {
    const f = fakeRunner([{ code: 0 }, { code: 0 }]); // [install, uninstall(via compensate)]
    const inst = corepackPnpmInstaller(CONN, f.runner);
    const { result, compensate } = await inst.install();
    expect(result.ok).toBe(true);
    expect(f.commands[0]).toContain('corepack enable');
    expect(f.commands[0]).toContain('corepack prepare pnpm@10.26.1 --activate');
    expect(f.commands[0]).toContain('pnpm add -g @rebink/patchwire');
    expect(typeof compensate).toBe('function');

    await compensate!();
    expect(f.commands[1]).toBe('pnpm remove -g @rebink/patchwire');
  });

  it('install reports failure (no compensate) on non-zero exit', async () => {
    const inst = corepackPnpmInstaller(CONN, fakeRunner([{ code: 1, stderr: 'EACCES' }]).runner);
    const { result, compensate } = await inst.install();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('EACCES');
    expect(compensate).toBeUndefined();
  });

  it('uninstall runs pnpm remove and reports ok', async () => {
    const inst = corepackPnpmInstaller(CONN, fakeRunner([{ code: 0 }]).runner);
    expect(await inst.uninstall()).toEqual({ ok: true, detail: 'removed' });
  });
});
