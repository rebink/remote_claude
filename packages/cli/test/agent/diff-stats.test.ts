import { describe, it, expect } from 'vitest';
import { countDiffLines } from '../../src/agent/diff-stats.ts';

describe('countDiffLines', () => {
  it('returns zeros for empty input', () => {
    expect(countDiffLines('')).toEqual({ linesAdded: 0, linesRemoved: 0 });
  });

  it('counts + and - body lines, excluding +++/--- file headers', () => {
    const diff = [
      'diff --git a/a.txt b/a.txt',
      'index 1111..2222 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,3 +1,3 @@',
      '-old line',
      '+new line',
      ' unchanged',
      '+extra',
    ].join('\n');
    expect(countDiffLines(diff)).toEqual({ linesAdded: 2, linesRemoved: 1 });
  });

  it('handles multiple files', () => {
    const diff = [
      'diff --git a/a b/a',
      '--- a/a',
      '+++ b/a',
      '@@ -1,1 +1,2 @@',
      ' x',
      '+y',
      'diff --git a/b b/b',
      '--- a/b',
      '+++ b/b',
      '@@ -1,2 +1,1 @@',
      ' x',
      '-z',
    ].join('\n');
    expect(countDiffLines(diff)).toEqual({ linesAdded: 1, linesRemoved: 1 });
  });

  it('handles new file creation (only + lines)', () => {
    const diff = [
      'diff --git a/c b/c',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/c',
      '@@ -0,0 +1,2 @@',
      '+first',
      '+second',
    ].join('\n');
    expect(countDiffLines(diff)).toEqual({ linesAdded: 2, linesRemoved: 0 });
  });

  it('ignores lines that look like headers but only at the start of a hunk', () => {
    // A body line starting with --- or +++ (rare in practice) would be 3-char prefixed;
    // the simple rule we use: lines starting with exactly "+++" or "---" are headers.
    const diff = [
      '--- a/x',
      '+++ b/x',
      '@@ -1 +1 @@',
      '-abc',
      '+def',
    ].join('\n');
    expect(countDiffLines(diff)).toEqual({ linesAdded: 1, linesRemoved: 1 });
  });
});
