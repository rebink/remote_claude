import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as cp from 'node:child_process';
import { applyPatch, filterPatchToFiles } from './applyPatch.ts';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof cp>();
  return { ...actual };
});

describe('applyPatch', () => {
  it('applies a patch to a real git repo', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rc-apply-'));
    spawnSync('git', ['init', '-q'], { cwd: dir });
    spawnSync('git', ['config', 'user.email', 't@t'], { cwd: dir });
    spawnSync('git', ['config', 'user.name', 't'], { cwd: dir });
    writeFileSync(join(dir, 'x.txt'), 'hello\n');
    spawnSync('git', ['add', 'x.txt'], { cwd: dir });
    spawnSync('git', ['commit', '-q', '-m', 'init'], { cwd: dir });

    const patch = `diff --git a/x.txt b/x.txt
--- a/x.txt
+++ b/x.txt
@@ -1 +1 @@
-hello
+goodbye
`;
    const res = await applyPatch(patch, dir);
    expect(res.ok).toBe(true);
    expect(readFileSync(join(dir, 'x.txt'), 'utf8')).toBe('goodbye\n');
    rmSync(dir, { recursive: true, force: true });
  });

  it('filterPatchToFiles keeps only requested files', () => {
    const patch = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -1 +1 @@
-a
+A
diff --git a/b.txt b/b.txt
--- a/b.txt
+++ b/b.txt
@@ -1 +1 @@
-b
+B
`;
    const out = filterPatchToFiles(patch, ['a.txt']);
    expect(out).toContain('a/a.txt');
    expect(out).not.toContain('a/b.txt');
  });

  it('resolves with ok=false when git spawn errors', async () => {
    vi.spyOn(cp, 'spawn').mockReturnValue({
      stdin: { write: vi.fn(), end: vi.fn(), on: vi.fn() },
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: (event: string, cb: (arg: unknown) => void) => {
        if (event === 'error') queueMicrotask(() => cb(new Error('ENOENT git')));
      },
    } as unknown as cp.ChildProcessWithoutNullStreams);

    const res = await applyPatch('patch', '/tmp');
    expect(res.ok).toBe(false);
    expect(res.stderr).toMatch(/ENOENT/);
    vi.restoreAllMocks();
  });
});
