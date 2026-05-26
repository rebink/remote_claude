import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface PullTarget {
  host: string;
  user: string;
  sshPort?: number;
  remotePath: string;
}

export interface ChangedFile {
  path: string;
  status: 'modified' | 'added' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
}

export interface PullResult {
  patch: string;
  files: ChangedFile[];
}

function sshArgs(target: PullTarget): string[] {
  const keyPath = join(homedir(), '.remote-claude', 'keys', `${target.host}-${target.user}`);
  const args: string[] = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10'];
  if (existsSync(keyPath)) args.push('-i', keyPath);
  if (target.sshPort && target.sshPort !== 22) args.push('-p', String(target.sshPort));
  args.push(`${target.user}@${target.host}`);
  return args;
}

function parseStatus(stdout: string): ChangedFile[] {
  // git status --porcelain output:
  //  M src/foo.ts        → modified
  //  A src/bar.ts        → added
  //  D src/old.ts        → deleted
  //  ?? src/new.ts       → added (untracked)
  //  R  old.ts -> new.ts → renamed
  const files: ChangedFile[] = [];
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const status = line.slice(0, 2);
    const rest = line.slice(3);
    let path = rest;
    let kind: ChangedFile['status'] = 'modified';
    if (status === '??' || status.includes('A')) kind = 'added';
    else if (status.includes('D')) kind = 'deleted';
    else if (status.includes('R')) {
      kind = 'renamed';
      const arrow = rest.indexOf(' -> ');
      if (arrow !== -1) path = rest.slice(arrow + 4);
    }
    files.push({ path, status: kind, additions: 0, deletions: 0 });
  }
  return files;
}

function parseStat(diffStat: string, files: ChangedFile[]): void {
  // git diff --numstat output:
  //  3   1   src/foo.ts
  //  -   -   bin.png    (binary; show 0/0)
  for (const line of diffStat.split('\n')) {
    if (!line.trim()) continue;
    const [aStr, dStr, ...rest] = line.split('\t');
    const path = rest.join('\t');
    const f = files.find((x) => x.path === path);
    if (!f) continue;
    f.additions = aStr === '-' ? 0 : Number(aStr) || 0;
    f.deletions = dStr === '-' ? 0 : Number(dStr) || 0;
  }
}

/**
 * Fetch the working-tree diff from the Mac Mini. Returns the unified patch
 * plus a per-file summary. Untracked files are included (they show up via
 * `git status --porcelain`; the patch via `git add -N` + `git diff HEAD`).
 */
export function pullRemoteDiff(target: PullTarget): { ok: true; result: PullResult } | { ok: false; error: string } {
  const ssh = sshArgs(target);

  // Stage untracked-file intent so they appear in `git diff HEAD`. -N adds
  // intent-to-add records; it does NOT stage content, so a `git reset` will
  // unwind it cleanly.
  const stageIntent = spawnSync(
    'ssh',
    [...ssh, `cd ${target.remotePath} && git ls-files --others --exclude-standard | xargs -0 -I{} echo {} | xargs -I{} git add -N -- {}; git diff HEAD`],
    { encoding: 'utf8', timeout: 60000 },
  );
  if (stageIntent.error) return { ok: false, error: `ssh failed: ${stageIntent.error.message}` };
  if (stageIntent.status !== 0) return { ok: false, error: `git diff failed (exit ${stageIntent.status}): ${stageIntent.stderr.trim()}` };
  const patch = stageIntent.stdout;

  const status = spawnSync(
    'ssh',
    [...ssh, `cd ${target.remotePath} && git status --porcelain`],
    { encoding: 'utf8', timeout: 30000 },
  );
  if (status.status !== 0) return { ok: false, error: `git status failed: ${status.stderr.trim()}` };

  const numstat = spawnSync(
    'ssh',
    [...ssh, `cd ${target.remotePath} && git diff HEAD --numstat`],
    { encoding: 'utf8', timeout: 30000 },
  );

  const files = parseStatus(status.stdout);
  if (numstat.status === 0) parseStat(numstat.stdout, files);

  return { ok: true, result: { patch, files } };
}
