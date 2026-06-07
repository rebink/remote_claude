import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parsePreImageSha, detectDrift, gitApply3way } from '../src/lib/patch.ts';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** Build a temp git repo, return its path. */
function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pw-3way-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 't@t.t');
  git(dir, 'config', 'user.name', 't');
  return dir;
}

/** Produce a unified diff (as Patchwire's agent does) for the current staged changes. */
function stagedDiff(dir: string): string {
  git(dir, 'add', '-A');
  return execFileSync('git', ['diff', '--cached', '--no-color'], { cwd: dir, encoding: 'utf8' });
}

describe('parsePreImageSha', () => {
  it('extracts the pre-image blob sha from an index line', () => {
    const chunk = [
      'diff --git a/app.ts b/app.ts',
      'index 1111111aaa..2222222bbb 100644',
      '--- a/app.ts',
      '+++ b/app.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');
    expect(parsePreImageSha(chunk)).toBe('1111111aaa');
  });

  it('returns null for a new file (all-zero pre-image)', () => {
    const chunk = [
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      'index 0000000000..3333333ccc',
      '--- /dev/null',
      '+++ b/new.ts',
    ].join('\n');
    expect(parsePreImageSha(chunk)).toBeNull();
  });
});

describe('detectDrift', () => {
  let dir: string;
  beforeEach(() => {
    dir = makeRepo();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('reports no drift when the local file still matches the diff pre-image', () => {
    writeFileSync(join(dir, 'a.txt'), 'line1\nline2\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'init');
    // produce a diff that edits a.txt, but DON'T change a.txt locally
    writeFileSync(join(dir, 'a.txt'), 'line1\nCHANGED\n');
    const diff = stagedDiff(dir);
    git(dir, 'reset', '-q', '--hard', 'HEAD'); // restore local to pre-image state

    return detectDrift(diff, dir).then((res) => {
      expect(res.drifted).toEqual([]);
    });
  });

  it('flags a file that changed locally since the snapshot as modified-drift', async () => {
    writeFileSync(join(dir, 'a.txt'), 'line1\nline2\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'init');
    writeFileSync(join(dir, 'a.txt'), 'line1\nFROM_AI\n');
    const diff = stagedDiff(dir);
    git(dir, 'reset', '-q', '--hard', 'HEAD');
    // now drift locally: edit a.txt to something the snapshot never saw
    writeFileSync(join(dir, 'a.txt'), 'LOCAL_EDIT\nline2\n');

    const res = await detectDrift(diff, dir);
    expect(res.drifted.map((d) => d.path)).toContain('a.txt');
    expect(res.drifted.find((d) => d.path === 'a.txt')?.reason).toBe('modified');
  });

  it('flags a modified file that is missing locally', async () => {
    writeFileSync(join(dir, 'a.txt'), 'x\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'init');
    writeFileSync(join(dir, 'a.txt'), 'y\n');
    const diff = stagedDiff(dir);
    git(dir, 'reset', '-q', '--hard', 'HEAD');
    rmSync(join(dir, 'a.txt'));

    const res = await detectDrift(diff, dir);
    expect(res.drifted.find((d) => d.path === 'a.txt')?.reason).toBe('missing');
  });
});

describe('gitApply3way', () => {
  let dir: string;
  beforeEach(() => {
    dir = makeRepo();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('applies cleanly when there is no local drift', async () => {
    writeFileSync(join(dir, 'a.txt'), 'one\ntwo\nthree\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'init');
    writeFileSync(join(dir, 'a.txt'), 'one\nTWO\nthree\n');
    const diff = stagedDiff(dir);
    git(dir, 'reset', '-q', '--hard', 'HEAD');

    const res = await gitApply3way(diff, dir);
    expect(res.ok).toBe(true);
    expect(res.conflicted).toEqual([]);
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toBe('one\nTWO\nthree\n');
  });

  it('3-way merges non-overlapping local drift that plain apply would reject', async () => {
    // base
    writeFileSync(join(dir, 'a.txt'), 'L1\nL2\nL3\nL4\nL5\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'init');
    // AI edits L5 (far from L1)
    writeFileSync(join(dir, 'a.txt'), 'L1\nL2\nL3\nL4\nL5_AI\n');
    const diff = stagedDiff(dir);
    git(dir, 'reset', '-q', '--hard', 'HEAD');
    // local independently edits L1 (non-overlapping) — plain `git apply` would fail on context
    writeFileSync(join(dir, 'a.txt'), 'L1_LOCAL\nL2\nL3\nL4\nL5\n');

    const res = await gitApply3way(diff, dir);
    expect(res.ok).toBe(true);
    expect(res.conflicted).toEqual([]);
    const out = readFileSync(join(dir, 'a.txt'), 'utf8');
    expect(out).toContain('L1_LOCAL'); // local edit preserved
    expect(out).toContain('L5_AI'); // AI edit merged in
  });

  it('reports conflicted files when local and AI edit the same lines', async () => {
    writeFileSync(join(dir, 'a.txt'), 'base\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-qm', 'init');
    writeFileSync(join(dir, 'a.txt'), 'ai-version\n');
    const diff = stagedDiff(dir);
    git(dir, 'reset', '-q', '--hard', 'HEAD');
    writeFileSync(join(dir, 'a.txt'), 'local-version\n'); // same line, different content

    const res = await gitApply3way(diff, dir);
    expect(res.conflicted).toContain('a.txt');
    expect(readFileSync(join(dir, 'a.txt'), 'utf8')).toContain('<<<<<<<');
  });
});
