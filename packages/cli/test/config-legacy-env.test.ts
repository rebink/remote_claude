import { describe, it, expect } from 'vitest';
import { applyLegacyEnvFallback } from '../src/lib/config.ts';

describe('applyLegacyEnvFallback (Remote Claude → Patchwire env migration)', () => {
  it('maps RC_TOKEN to PW_TOKEN when PW_TOKEN is unset', () => {
    const env: NodeJS.ProcessEnv = { RC_TOKEN: 'abc' };
    applyLegacyEnvFallback(env);
    expect(env.PW_TOKEN).toBe('abc');
  });

  it('does not override an existing PW_TOKEN', () => {
    const env: NodeJS.ProcessEnv = { RC_TOKEN: 'old', PW_TOKEN: 'new' };
    applyLegacyEnvFallback(env);
    expect(env.PW_TOKEN).toBe('new');
  });

  it('maps any RC_* var and leaves non-RC vars untouched', () => {
    const env: NodeJS.ProcessEnv = { RC_AGENT_HOST: 'h', PATH: '/x' };
    applyLegacyEnvFallback(env);
    expect(env.PW_AGENT_HOST).toBe('h');
    expect(env.PATH).toBe('/x');
  });
});
