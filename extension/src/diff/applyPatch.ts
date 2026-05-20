import { spawn } from 'node:child_process';

export interface ApplyResult { ok: boolean; conflicted: string[]; stderr: string }

export async function applyPatch(patch: string, cwd: string): Promise<ApplyResult> {
  return new Promise((resolve) => {
    const child = spawn('git', ['apply', '--3way', '--whitespace=nowarn', '-'], { cwd });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
    child.stdin.write(patch);
    child.stdin.end();
    child.on('close', (code) => {
      const conflicted = [...stderr.matchAll(/CONFLICT.*?in (.+)/g)].map((m) => m[1]);
      resolve({ ok: code === 0 && conflicted.length === 0, conflicted, stderr });
    });
  });
}

export function filterPatchToFiles(patch: string, keepPaths: string[]): string {
  const keep = new Set(keepPaths);
  const segments = patch.split(/(?=^diff --git )/m);
  return segments.filter((seg) => {
    const m = seg.match(/^diff --git a\/(\S+)/);
    return m ? keep.has(m[1]) : true;
  }).join('');
}
