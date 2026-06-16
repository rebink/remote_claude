import { describe, it, expect } from 'vitest';
import { corepackPnpmInstaller } from '../src/agent/provision/installer.ts';
import { POSIX_PATH_PREFIX, POSIX_PNPM_ENV } from '../src/agent/provision/primitives.ts';

const EXPECTED_ENV_PREFIX = `${POSIX_PATH_PREFIX}${POSIX_PNPM_ENV}`;

const fakeConn = { host: 'test-host', user: 'testuser', port: 22, keyPath: '~/.ssh/id_ed25519' };

function makeCapturingRunner(exitCode = 0) {
  const captured: string[] = [];
  const runner = async (cmd: string) => {
    captured.push(cmd);
    return { stdout: '1.2.3', stderr: '', code: exitCode };
  };
  return { runner, captured };
}

describe('corepackPnpmInstaller', () => {
  describe('version()', () => {
    it('prefixes command with POSIX_PATH_PREFIX + POSIX_PNPM_ENV', async () => {
      const { runner, captured } = makeCapturingRunner(0);
      const installer = corepackPnpmInstaller(fakeConn, runner);
      await installer.version();
      expect(captured).toHaveLength(1);
      expect(captured[0]).toMatch(/^export PATH=/);
      expect(captured[0]).toContain(EXPECTED_ENV_PREFIX);
      expect(captured[0]).toContain('patchwire --version');
    });

    it('returns trimmed stdout on exit code 0', async () => {
      const { runner } = makeCapturingRunner(0);
      const installer = corepackPnpmInstaller(fakeConn, runner);
      const v = await installer.version();
      expect(v).toBe('1.2.3');
    });

    it('returns null on non-zero exit code', async () => {
      const { runner } = makeCapturingRunner(1);
      const installer = corepackPnpmInstaller(fakeConn, runner);
      const v = await installer.version();
      expect(v).toBeNull();
    });
  });

  describe('uninstall()', () => {
    it('prefixes command with POSIX_PATH_PREFIX + POSIX_PNPM_ENV', async () => {
      const { runner, captured } = makeCapturingRunner(0);
      const installer = corepackPnpmInstaller(fakeConn, runner);
      await installer.uninstall();
      expect(captured).toHaveLength(1);
      expect(captured[0]).toMatch(/^export PATH=/);
      expect(captured[0]).toContain(EXPECTED_ENV_PREFIX);
      expect(captured[0]).toContain('pnpm remove -g');
    });

    it('returns ok:true on exit code 0', async () => {
      const { runner } = makeCapturingRunner(0);
      const installer = corepackPnpmInstaller(fakeConn, runner);
      const result = await installer.uninstall();
      expect(result.ok).toBe(true);
    });

    it('returns ok:false on non-zero exit code', async () => {
      const { runner } = makeCapturingRunner(1);
      const installer = corepackPnpmInstaller(fakeConn, runner);
      const result = await installer.uninstall();
      expect(result.ok).toBe(false);
    });
  });

  describe('install() command', () => {
    it('also prefixes with POSIX env (via AGENT_INSTALL_CMD)', async () => {
      const { runner, captured } = makeCapturingRunner(0);
      const installer = corepackPnpmInstaller(fakeConn, runner);
      await installer.install();
      expect(captured[0]).toContain(EXPECTED_ENV_PREFIX);
    });
  });
});
