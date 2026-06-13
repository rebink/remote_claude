import { describe, it, expect } from 'vitest';
import { buildAgentEnv, WRITE_AGENT_ENV_CMD, AGENT_INSTALL_CMD, AGENT_PACKAGE, POSIX_PATH_PREFIX } from '../../../src/agent/provision/primitives.ts';
import { quoteForShell } from '../../../src/lib/ssh-runner.ts';

describe('buildAgentEnv', () => {
  it('emits PW_AGENT_TOKEN + config, shell-quoted, with defaults', () => {
    const env = buildAgentEnv({ token: 'TKN-123' });
    expect(env).toContain(`export PW_AGENT_TOKEN=${quoteForShell('TKN-123')}`);
    expect(env).toContain(`export PW_AGENT_HOST=${quoteForShell('127.0.0.1')}`);
    expect(env).toContain(`export PW_AGENT_PORT=${quoteForShell('7878')}`);
    expect(env).toContain(`export PW_AI_BIN=${quoteForShell('claude')}`);
    expect(env).not.toContain('PW_TOKEN='); // client var must not leak into the agent env
  });
  it('honors explicit host/port/aiBin', () => {
    const env = buildAgentEnv({ token: 't', host: '100.64.0.1', port: 9999, aiBin: 'claude-next' });
    expect(env).toContain(`export PW_AGENT_HOST=${quoteForShell('100.64.0.1')}`);
    expect(env).toContain(`export PW_AGENT_PORT=${quoteForShell('9999')}`);
    expect(env).toContain(`export PW_AI_BIN=${quoteForShell('claude-next')}`);
  });
});

describe('install + write primitives', () => {
  it('AGENT_INSTALL_CMD uses corepack + pnpm to install the agent package', () => {
    expect(AGENT_INSTALL_CMD).toContain('corepack enable');
    expect(AGENT_INSTALL_CMD).toContain('corepack prepare pnpm@');
    expect(AGENT_INSTALL_CMD).toContain(`pnpm add -g ${AGENT_PACKAGE}`);
    expect(AGENT_INSTALL_CMD).not.toContain('npm i -g'); // converged off npm
  });
  it('AGENT_INSTALL_CMD is prefixed with POSIX_PATH_PREFIX so corepack/pnpm/node are found in non-interactive SSH sessions', () => {
    expect(AGENT_INSTALL_CMD).toContain(POSIX_PATH_PREFIX);
    expect(AGENT_INSTALL_CMD.indexOf(POSIX_PATH_PREFIX)).toBeLessThan(AGENT_INSTALL_CMD.indexOf('corepack'));
    expect(POSIX_PATH_PREFIX).toContain('/opt/homebrew/bin');
    expect(POSIX_PATH_PREFIX).toContain('$PATH');
  });
  it('WRITE_AGENT_ENV_CMD is an atomic temp→rename into ~/.patchwire/agent.env', () => {
    expect(WRITE_AGENT_ENV_CMD).toContain('umask 077');
    expect(WRITE_AGENT_ENV_CMD).toMatch(/cat > .*agent\.env\.tmp/);
    expect(WRITE_AGENT_ENV_CMD).toMatch(/mv -f .*agent\.env\.tmp.* .*\/\.patchwire\/agent\.env/);
  });
});
