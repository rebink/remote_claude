import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '../../src/agent/policy.ts';

describe('evaluatePolicy', () => {
  it('allows when policy is empty', () => {
    expect(evaluatePolicy({}, { project: 'app', recentCount: 0 })).toEqual({ allowed: true });
  });
  it('allows a project in the allowlist', () => {
    const d = evaluatePolicy({ projects: ['app', 'api'] }, { project: 'api', recentCount: 0 });
    expect(d.allowed).toBe(true);
  });
  it('denies a project not in the allowlist', () => {
    const d = evaluatePolicy({ projects: ['app'] }, { project: 'secret', recentCount: 0 });
    expect(d).toMatchObject({ allowed: false, code: 'project_not_allowed' });
  });
  it('treats an empty allowlist as "all allowed"', () => {
    expect(evaluatePolicy({ projects: [] }, { project: 'anything', recentCount: 0 }).allowed).toBe(true);
  });
  it('allows under the rate limit', () => {
    expect(evaluatePolicy({ rateLimit: { max: 5, windowMs: 3600_000 } }, { project: 'app', recentCount: 4 }).allowed).toBe(true);
  });
  it('denies at/over the rate limit', () => {
    const d = evaluatePolicy({ rateLimit: { max: 5, windowMs: 3600_000 } }, { project: 'app', recentCount: 5 });
    expect(d).toMatchObject({ allowed: false, code: 'rate_limited' });
  });
  it('checks the allowlist before the rate limit', () => {
    const d = evaluatePolicy(
      { projects: ['app'], rateLimit: { max: 1, windowMs: 1000 } },
      { project: 'other', recentCount: 99 },
    );
    expect(d).toMatchObject({ allowed: false, code: 'project_not_allowed' });
  });
});
