import { describe, it, expect } from 'vitest';
import { buildAgentEnv, WRITE_AGENT_ENV_CMD, AGENT_INSTALL_CMD, AGENT_PACKAGE, POSIX_PATH_PREFIX, POSIX_PNPM_ENV } from '../../../src/agent/provision/primitives.ts';
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
  it('AGENT_INSTALL_CMD uses a pnpm-first fallback chain (pnpm on PATH → corepack) then installs the agent', () => {
    // pnpm-on-PATH fast path
    expect(AGENT_INSTALL_CMD).toContain('command -v pnpm');
    // corepack branch is present (for hosts with corepack but no pnpm)
    expect(AGENT_INSTALL_CMD).toContain('command -v corepack');
    expect(AGENT_INSTALL_CMD).toContain('corepack enable');
    expect(AGENT_INSTALL_CMD).toContain(`corepack prepare pnpm@`);
    // npm fallback is NOT present — npm does not set PNPM_HOME correctly
    expect(AGENT_INSTALL_CMD).not.toMatch(/\bnpm\s+i\b/);
    expect(AGENT_INSTALL_CMD).not.toMatch(/\bnpm\s+install\b/);
    // final install step always present
    expect(AGENT_INSTALL_CMD).toContain(`pnpm add -g ${AGENT_PACKAGE}`);
  });
  it('AGENT_INSTALL_CMD sets PNPM_HOME and creates the dir before pnpm add -g', () => {
    expect(AGENT_INSTALL_CMD).toContain('PNPM_HOME');
    expect(AGENT_INSTALL_CMD).toContain('mkdir -p "$PNPM_HOME"');
    // PNPM_HOME must be set before pnpm add -g
    expect(AGENT_INSTALL_CMD.indexOf('PNPM_HOME')).toBeLessThan(AGENT_INSTALL_CMD.indexOf('pnpm add -g'));
  });
  it('POSIX_PNPM_ENV sets PNPM_HOME with a default and prepends it to PATH', () => {
    expect(POSIX_PNPM_ENV).toContain('PNPM_HOME');
    expect(POSIX_PNPM_ENV).toContain('$HOME/.local/share/pnpm');
    expect(POSIX_PNPM_ENV).toContain('$PNPM_HOME:$PATH');
    expect(POSIX_PNPM_ENV).toMatch(/"; $/);
  });
  it('AGENT_INSTALL_CMD is prefixed with POSIX_PATH_PREFIX so pnpm/node are found in non-interactive SSH sessions', () => {
    expect(AGENT_INSTALL_CMD).toContain(POSIX_PATH_PREFIX);
    expect(AGENT_INSTALL_CMD.indexOf(POSIX_PATH_PREFIX)).toBeLessThan(AGENT_INSTALL_CMD.indexOf('command -v pnpm'));
    expect(POSIX_PATH_PREFIX).toContain('/opt/homebrew/bin');
    expect(POSIX_PATH_PREFIX).toContain('$PATH');
  });
  it('POSIX_PATH_PREFIX is a self-contained export statement (not a bare assignment-prefix) so it applies to the whole command line', () => {
    // Must be "export PATH=..." form — not a bare assignment-prefix (PATH=val cmd)
    expect(POSIX_PATH_PREFIX).toMatch(/^export PATH=/);
    // Must end with "; " so concatenation never produces ";;" or "export ... if"
    // The closing quote from the PATH value comes before the "; " terminator:
    //   export PATH="..."; <trailing space>
    expect(POSIX_PATH_PREFIX).toMatch(/"; $/);
  });
  it('AGENT_INSTALL_CMD starts with export PATH=...; export PNPM_HOME=...; mkdir ... (no ";;" anywhere)', () => {
    // Must start with the PATH prefix
    expect(AGENT_INSTALL_CMD).toMatch(/^export PATH=/);
    // Must not contain ";;" (would be a parse error in bash/zsh)
    expect(AGENT_INSTALL_CMD).not.toContain(';;');
    // PNPM_HOME export comes before the if block
    expect(AGENT_INSTALL_CMD).toMatch(/export PNPM_HOME=.*; .*mkdir -p "\$PNPM_HOME"; if /s);
  });
  it('WRITE_AGENT_ENV_CMD is an atomic temp→rename into ~/.patchwire/agent.env', () => {
    expect(WRITE_AGENT_ENV_CMD).toContain('umask 077');
    expect(WRITE_AGENT_ENV_CMD).toMatch(/cat > .*agent\.env\.tmp/);
    expect(WRITE_AGENT_ENV_CMD).toMatch(/mv -f .*agent\.env\.tmp.* .*\/\.patchwire\/agent\.env/);
  });
});
