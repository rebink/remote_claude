import { describe, it, expect } from 'vitest';
import { binaryInstaller, REMOTE_BIN_PATH, type BinaryArtifact, type BinaryArtifactSource } from '../../../src/agent/provision/binary-installer.ts';
import { WINDOWS_BIN_VERSION_CMD, REMOVE_WINDOWS_BIN_PS } from '../../../src/agent/provision/windows-primitives.ts';
import type { RemoteRunner } from '../../../src/agent/provision/installer.ts';
import type { DetectedServerPlatform } from '../../../src/agent/server-platform/types.ts';

const CONN = { host: 'h', user: 'u', port: 22, keyPath: '/k' };
const DETECTED = { os: 'linux', arch: 'x64' } as unknown as DetectedServerPlatform;

/** 64-char hex string used as a valid sha256. */
const SHA = 'a'.repeat(64);

/** Wraps a BinaryArtifact into a BinaryArtifactSource. */
const src = (a: BinaryArtifact): BinaryArtifactSource => async () => a;

/** Records every command + input and returns scripted results in order (or a default). */
function fakeRunner(results: Array<{ stdout?: string; stderr?: string; code: number }>): {
  runner: RemoteRunner;
  commands: string[];
  inputs: Array<string | undefined>;
} {
  const commands: string[] = [];
  const inputs: Array<string | undefined> = [];
  let i = 0;
  const runner: RemoteRunner = async (command, input) => {
    commands.push(command);
    inputs.push(input);
    const r = results[i++] ?? { code: 0 };
    return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', code: r.code };
  };
  return { runner, commands, inputs };
}

describe('binaryInstaller.install', () => {
  it('copies binary and verifies sha256 on success', async () => {
    const f = fakeRunner([{ code: 0 }, { code: 0 }]); // [install, compensate/uninstall]
    const artifact: BinaryArtifact = { bytes: Buffer.from('BINARY'), sha256: SHA, version: '1.2.3' };
    const inst = binaryInstaller(CONN, { source: src(artifact), detected: DETECTED, runner: f.runner });
    const { result, compensate } = await inst.install();

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('1.2.3');
    expect(result.detail).toContain('sha256 verified');

    expect(f.commands[0]).toContain('openssl base64 -A -d');
    expect(f.commands[0]).toContain('openssl dgst -sha256');
    expect(f.commands[0]).toContain(`[ "$ACTUAL" = "${SHA}" ]`);
    expect(f.commands[0]).toContain('chmod 700');
    expect(f.commands[0]).toContain('mv -f');
    expect(f.commands[0]).toContain(REMOTE_BIN_PATH);
    expect(f.inputs[0]).toBe(Buffer.from('BINARY').toString('base64'));
    expect(typeof compensate).toBe('function');

    await compensate!();
    expect(f.commands[1]).toBe(`rm -f "${REMOTE_BIN_PATH}"`);
  });

  it('reports failure on non-zero exit (e.g. sha mismatch on remote)', async () => {
    const f = fakeRunner([{ code: 1, stderr: 'PW mismatch' }]);
    const artifact: BinaryArtifact = { bytes: Buffer.from('BINARY'), sha256: SHA };
    const inst = binaryInstaller(CONN, { source: src(artifact), detected: DETECTED, runner: f.runner });
    const { result, compensate } = await inst.install();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('PW mismatch');
    expect(compensate).toBeUndefined();
  });

  it('rejects an invalid sha256 without touching the runner', async () => {
    const f = fakeRunner([{ code: 0 }]);
    const artifact: BinaryArtifact = { bytes: Buffer.from('BINARY'), sha256: 'xyz' };
    const inst = binaryInstaller(CONN, { source: src(artifact), detected: DETECTED, runner: f.runner });
    const { result, compensate } = await inst.install();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain('invalid artifact sha256');
    expect(f.commands.length).toBe(0);
    expect(compensate).toBeUndefined();
  });
});

describe('binaryInstaller.version / check', () => {
  it('version returns trimmed stdout on code 0, null on non-zero', async () => {
    const present = binaryInstaller(CONN, { source: src({ bytes: Buffer.alloc(0), sha256: SHA }), detected: DETECTED, runner: fakeRunner([{ stdout: '1.2.3\n', code: 0 }]).runner });
    expect(await present.version()).toBe('1.2.3');

    const absent = binaryInstaller(CONN, { source: src({ bytes: Buffer.alloc(0), sha256: SHA }), detected: DETECTED, runner: fakeRunner([{ code: 127 }]).runner });
    expect(await absent.version()).toBeNull();
  });

  it('check reports present/version when installed, present:false when absent', async () => {
    const present = binaryInstaller(CONN, { source: src({ bytes: Buffer.alloc(0), sha256: SHA }), detected: DETECTED, runner: fakeRunner([{ stdout: '1.2.3', code: 0 }]).runner });
    expect(await present.check()).toEqual({ present: true, version: '1.2.3' });

    const absent = binaryInstaller(CONN, { source: src({ bytes: Buffer.alloc(0), sha256: SHA }), detected: DETECTED, runner: fakeRunner([{ code: 127 }]).runner });
    expect(await absent.check()).toEqual({ present: false });
  });
});

describe('binaryInstaller.uninstall', () => {
  it('returns ok:true with detail removed on code 0', async () => {
    const f = fakeRunner([{ code: 0 }]);
    const inst = binaryInstaller(CONN, { source: src({ bytes: Buffer.alloc(0), sha256: SHA }), detected: DETECTED, runner: f.runner });
    expect(await inst.uninstall()).toEqual({ ok: true, detail: 'removed' });
  });

  it('returns ok:false with stderr detail on non-zero exit', async () => {
    const f = fakeRunner([{ code: 1, stderr: 'permission denied' }]);
    const inst = binaryInstaller(CONN, { source: src({ bytes: Buffer.alloc(0), sha256: SHA }), detected: DETECTED, runner: f.runner });
    const r = await inst.uninstall();
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('permission denied');
  });
});

// ── Windows branch ────────────────────────────────────────────────────────────
const WIN_DETECTED = { os: 'windows', arch: 'x64' } as unknown as DetectedServerPlatform;

describe('binaryInstaller (Windows) — install', () => {
  it('uses PowerShell install command, passes base64 payload, returns ok:true', async () => {
    const f = fakeRunner([{ code: 0, stdout: 'PW_BIN_OK' }]);
    const artifact: BinaryArtifact = { bytes: Buffer.from('BIN'), sha256: SHA, version: '1.0.0' };
    const inst = binaryInstaller(CONN, { source: src(artifact), detected: WIN_DETECTED, runner: f.runner });
    const { result, compensate } = await inst.install();

    expect(result.ok).toBe(true);
    expect(result.detail).toContain('1.0.0');
    expect(result.detail).toContain('sha256 verified');

    expect(f.commands[0]).toContain('FromBase64String');
    expect(f.commands[0]).toContain('Get-FileHash');
    expect(f.inputs[0]).toBe(Buffer.from('BIN').toString('base64'));
    expect(typeof compensate).toBe('function');
  });

  it('compensate runs the Remove-Item PowerShell', async () => {
    const f = fakeRunner([{ code: 0 }, { code: 0 }]);
    const artifact: BinaryArtifact = { bytes: Buffer.from('BIN'), sha256: SHA };
    const inst = binaryInstaller(CONN, { source: src(artifact), detected: WIN_DETECTED, runner: f.runner });
    const { compensate } = await inst.install();
    await compensate!();
    expect(f.commands[1]).toBe(REMOVE_WINDOWS_BIN_PS);
  });

  it('returns ok:false on non-zero exit (e.g. sha mismatch)', async () => {
    const f = fakeRunner([{ code: 4, stderr: 'PW_SHA_MISMATCH' }]);
    const artifact: BinaryArtifact = { bytes: Buffer.from('BIN'), sha256: SHA };
    const inst = binaryInstaller(CONN, { source: src(artifact), detected: WIN_DETECTED, runner: f.runner });
    const { result, compensate } = await inst.install();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('PW_SHA_MISMATCH');
    expect(compensate).toBeUndefined();
  });
});

describe('binaryInstaller (Windows) — version', () => {
  it('uses WINDOWS_BIN_VERSION_CMD', async () => {
    const f = fakeRunner([{ stdout: '2.0.0\n', code: 0 }]);
    const inst = binaryInstaller(CONN, { source: src({ bytes: Buffer.alloc(0), sha256: SHA }), detected: WIN_DETECTED, runner: f.runner });
    expect(await inst.version()).toBe('2.0.0');
    expect(f.commands[0]).toBe(WINDOWS_BIN_VERSION_CMD);
  });

  it('returns null on non-zero exit', async () => {
    const f = fakeRunner([{ code: 1 }]);
    const inst = binaryInstaller(CONN, { source: src({ bytes: Buffer.alloc(0), sha256: SHA }), detected: WIN_DETECTED, runner: f.runner });
    expect(await inst.version()).toBeNull();
  });
});

describe('binaryInstaller (Windows) — uninstall', () => {
  it('uses REMOVE_WINDOWS_BIN_PS and returns ok:true', async () => {
    const f = fakeRunner([{ code: 0 }]);
    const inst = binaryInstaller(CONN, { source: src({ bytes: Buffer.alloc(0), sha256: SHA }), detected: WIN_DETECTED, runner: f.runner });
    const r = await inst.uninstall();
    expect(r.ok).toBe(true);
    expect(r.detail).toBe('removed');
    expect(f.commands[0]).toBe(REMOVE_WINDOWS_BIN_PS);
  });

  it('returns ok:false with stderr on non-zero exit', async () => {
    const f = fakeRunner([{ code: 1, stderr: 'access denied' }]);
    const inst = binaryInstaller(CONN, { source: src({ bytes: Buffer.alloc(0), sha256: SHA }), detected: WIN_DETECTED, runner: f.runner });
    const r = await inst.uninstall();
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('access denied');
  });
});
