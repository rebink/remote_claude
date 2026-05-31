import { spawn } from 'node:child_process';

export interface ApplyResult { ok: boolean; conflicted: string[]; stderr: string }

export async function applyPatch(patch: string, cwd: string): Promise<ApplyResult> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (r: ApplyResult) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    const child = spawn('git', ['apply', '--3way', '--whitespace=nowarn', '-'], { cwd });
    let stderr = '';
    child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });

    child.on('error', (err: Error) => {
      settle({ ok: false, conflicted: [], stderr: err.message });
    });
    child.stdin.on('error', (err: Error) => {
      // EPIPE if git exits before we finish writing — surface as a failure rather than throwing
      settle({ ok: false, conflicted: [], stderr: err.message });
    });

    try {
      child.stdin.write(patch);
      child.stdin.end();
    } catch (err) {
      settle({ ok: false, conflicted: [], stderr: (err as Error).message });
      return;
    }

    child.on('close', (code) => {
      const conflicted = [...stderr.matchAll(/CONFLICT.*?in (.+)/g)].map((m) => m[1]);
      settle({ ok: code === 0 && conflicted.length === 0, conflicted, stderr });
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
