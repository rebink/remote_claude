import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { runApply } from '../src/commands/apply.ts';

const execFileP = promisify(execFile);

// A minimal valid unified diff that creates one new file.
const PATCH = `diff --git a/hello.txt b/hello.txt
new file mode 100644
index 0000000..3b18e51
--- /dev/null
+++ b/hello.txt
@@ -0,0 +1 @@
+hello world
`;

describe('runApply --yes --json', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pw-apply-'));
    // git apply requires a real git repo
    await execFileP('git', ['init'], { cwd: dir });
    await execFileP('git', ['config', 'user.email', 'test@test.com'], { cwd: dir });
    await execFileP('git', ['config', 'user.name', 'Test'], { cwd: dir });
    await mkdir(join(dir, '.patchwire'), { recursive: true });
    await writeFile(join(dir, '.patchwire', 'last.patch'), PATCH, 'utf8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('applies the default patch non-interactively and writes the file', async () => {
    const lines: string[] = [];
    await runApply(dir, undefined, { yes: true, json: true, print: (s) => lines.push(s) });
    const applied = await readFile(join(dir, 'hello.txt'), 'utf8');
    expect(applied.trim()).toBe('hello world');
    const result = JSON.parse(lines.at(-1)!);
    expect(result).toEqual({ type: 'result', applied: true, files: ['hello.txt'] });
  });

  it('emits a JSON error line when the patch file is missing', async () => {
    await rm(join(dir, '.patchwire', 'last.patch'));
    const lines: string[] = [];
    await runApply(dir, undefined, { yes: true, json: true, print: (s) => lines.push(s) });
    const result = JSON.parse(lines.at(-1)!);
    expect(result.type).toBe('error');
    expect(result.applied).not.toBe(true);
  });
});
