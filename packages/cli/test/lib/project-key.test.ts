import { describe, it, expect } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { resolveProjectKey } from '../../src/lib/project-key.ts';

describe('resolveProjectKey', () => {
  it('builds ~/.patchwire/keys/<host>-<user>', () => {
    expect(resolveProjectKey('h.example', 'admin')).toBe(join(homedir(), '.patchwire', 'keys', 'h.example-admin'));
  });
});
