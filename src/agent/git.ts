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
