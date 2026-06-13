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
