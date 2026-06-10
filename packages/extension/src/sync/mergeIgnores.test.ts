import { describe, it, expect } from 'vitest';
import { mergeIgnores } from './MutagenController.ts';

describe('mergeIgnores', () => {
  it('merges baseline + excludes, deduped, baseline first', () => {
    expect(mergeIgnores(['node_modules', 'build'], ['build', '.dart_tool', 'node_modules']))
      .toEqual(['node_modules', 'build', '.dart_tool']);
  });
  it('returns the baseline when excludes are empty', () => {
    expect(mergeIgnores(['a', 'b'], [])).toEqual(['a', 'b']);
  });
});
