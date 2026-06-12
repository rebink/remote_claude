import { describe, it, expect } from 'vitest';
import { nodeResolveMutagenDeps } from './node-deps.ts';

describe('nodeResolveMutagenDeps', () => {
  it('computes a correct sha256 and reports platform/arch/home', () => {
    const deps = nodeResolveMutagenDeps({ bundledPath: () => null });
    // sha256 of the empty string is well-known.
    expect(deps.sha256(Buffer.from(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(deps.platform).toBe(process.platform);
    expect(deps.arch).toBe(process.arch);
    expect(typeof deps.homeDir).toBe('string');
  });

  it('which returns null for a command that does not exist', () => {
    const deps = nodeResolveMutagenDeps({ bundledPath: () => null });
    expect(deps.which('definitely-not-a-real-binary-xyz')).toBeNull();
  });
});
