import { spawn } from 'node:child_process';

interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

function run(cmd: string, args: string[], cwd: string, input?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b.toString()));
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, code: code ?? -1 }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  const r = await run('git', ['rev-parse', '--is-inside-work-tree'], cwd);
  return r.code === 0 && r.stdout.trim() === 'true';
}

export async function isClean(cwd: string): Promise<{ clean: boolean; status: string }> {
  const r = await run('git', ['status', '--porcelain'], cwd);
  if (r.code !== 0) throw new Error(`git status failed: ${r.stderr}`);
  return { clean: r.stdout.trim().length === 0, status: r.stdout };
}

export async function captureDiff(cwd: string): Promise<{ diff: string; files: string[] }> {
  // Stage everything (including untracked) so `git diff --cached` includes new files.
  const add = await run('git', ['add', '-A'], cwd);
  if (add.code !== 0) throw new Error(`git add failed: ${add.stderr}`);

  const diff = await run('git', ['diff', '--cached', '--no-color'], cwd);
  if (diff.code !== 0) throw new Error(`git diff failed: ${diff.stderr}`);

  const names = await run('git', ['diff', '--cached', '--name-only'], cwd);
  const files = names.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  return { diff: diff.stdout, files };
}

export async function resetClean(cwd: string): Promise<void> {
  // Unstage, then hard reset, then remove any leftover untracked.
  const r1 = await run('git', ['reset', 'HEAD', '--'], cwd);
  if (r1.code !== 0) throw new Error(`git reset failed: ${r1.stderr}`);
  const r2 = await run('git', ['checkout', '--', '.'], cwd);
  if (r2.code !== 0) throw new Error(`git checkout -- . failed: ${r2.stderr}`);
  const r3 = await run('git', ['clean', '-fd'], cwd);
  if (r3.code !== 0) throw new Error(`git clean failed: ${r3.stderr}`);
}

/**
 * Hard-reset the working tree to HEAD and remove untracked files/dirs.
 * Best-effort: errors are swallowed so cleanup never throws over a failing turn.
 */
export async function cleanResetToHead(cwd: string): Promise<void> {
  await run('git', ['reset', '--hard', 'HEAD'], cwd).catch(() => {});
  await run('git', ['clean', '-fd'], cwd).catch(() => {});
}

/**
 * Capture `git diff HEAD` (tracked changes) plus a structured list of changed files
 * with per-file additions/deletions. Returns empty patch + files when tree is clean.
 *
 * Rename handling:
 *   - `--name-status` emits rename entries as `R<score>\told-path\tnew-path` (3 fields).
 *     We record the NEW path under the `R` status.
 *   - `--numstat` may emit rename entries as `0\t0\told => new` (older git) or as
 *     `0\t0\tnew` (newer git with rename detection disabled). We defensively take the
 *     segment after ` => ` when present so the stats key matches the path used above.
 */
export async function diffHead(
  cwd: string,
): Promise<{
  patch: string;
  files: { path: string; status: 'A' | 'M' | 'D' | 'R'; additions: number; deletions: number }[];
}> {
  const patchRes = await run('git', ['diff', 'HEAD'], cwd);
  const numstatRes = await run('git', ['diff', '--name-status', 'HEAD'], cwd);
  const statRes = await run('git', ['diff', '--numstat', 'HEAD'], cwd);

  const additions: Record<string, number> = {};
  const deletions: Record<string, number> = {};
  for (const line of statRes.stdout.trim().split('\n').filter(Boolean)) {
    const [a, d, rawPath] = line.split('\t');
    if (!rawPath) continue;
    const path = rawPath.includes(' => ') ? rawPath.split(' => ').pop()! : rawPath;
    additions[path] = Number(a) || 0;
    deletions[path] = Number(d) || 0;
  }

  const files: { path: string; status: 'A' | 'M' | 'D' | 'R'; additions: number; deletions: number }[] = [];
  for (const l of numstatRes.stdout.trim().split('\n').filter(Boolean)) {
    const parts = l.split('\t');
    const code = parts[0];
    if (!code) continue;
    // Rename entries have 3 fields: code, old-path, new-path. Use new-path.
    const path = code.startsWith('R') ? parts[2] : parts[1];
    if (!path) continue;
    files.push({
      path,
      status: code[0] as 'A' | 'M' | 'D' | 'R',
      additions: additions[path] ?? 0,
      deletions: deletions[path] ?? 0,
    });
  }

  return { patch: patchRes.stdout, files };
}
