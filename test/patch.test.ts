import { describe, expect, it } from 'vitest';
import { splitDiffByFile, summarizeDiff } from '../src/lib/patch.ts';

const SAMPLE = `diff --git a/foo.txt b/foo.txt
index 1111111..2222222 100644
--- a/foo.txt
+++ b/foo.txt
@@ -1,2 +1,2 @@
-old line
+new line
 keep
diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 4444444..0000000
--- a/gone.txt
+++ /dev/null
@@ -1,1 +0,0 @@
-bye
`;

describe('splitDiffByFile', () => {
  it('returns empty for empty input', () => {
    expect(splitDiffByFile('')).toEqual([]);
    expect(splitDiffByFile('\n')).toEqual([]);
  });

  it('splits a multi-file diff into per-file chunks with metadata', () => {
    const chunks = splitDiffByFile(SAMPLE);
    expect(chunks.map((c) => c.path)).toEqual(['foo.txt', 'new.txt', 'gone.txt']);

    expect(chunks[0]?.isNew).toBe(false);
    expect(chunks[0]?.isDeleted).toBe(false);
    expect(chunks[0]?.added).toBe(1);
    expect(chunks[0]?.removed).toBe(1);

    expect(chunks[1]?.isNew).toBe(true);
    expect(chunks[1]?.added).toBe(2);
    expect(chunks[1]?.removed).toBe(0);

    expect(chunks[2]?.isDeleted).toBe(true);
    expect(chunks[2]?.added).toBe(0);
    expect(chunks[2]?.removed).toBe(1);
  });

  it('chunk text starts at "diff --git" and is self-contained', () => {
    const chunks = splitDiffByFile(SAMPLE);
    for (const c of chunks) {
      expect(c.text.startsWith('diff --git ')).toBe(true);
      expect(c.text.endsWith('\n')).toBe(true);
    }
    // recombining chunk texts should reproduce the original (modulo trailing newline)
    const recombined = chunks.map((c) => c.text).join('');
    expect(recombined.replace(/\n+$/, '')).toBe(SAMPLE.replace(/\n+$/, ''));
  });
});

describe('summarizeDiff', () => {
  it('aggregates files and counts additions/removals', () => {
    const s = summarizeDiff(SAMPLE);
    expect(s.files).toEqual(['foo.txt', 'new.txt', 'gone.txt']);
    expect(s.added).toBe(3);
    expect(s.removed).toBe(2);
  });
});
