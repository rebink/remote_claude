import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

export interface InitInput {
  projectsRoot: string;
  gitUrl: string;
  branch: string;
  projectName: string;
}

export type InitResult =
  | { ok: true; sha: string; path: string }
  | {
      ok: false;
      code: 'target_exists' | 'clone_failed' | 'rev_parse_failed';
      stderr: string;
    };

export async function runInit(input: InitInput): Promise<InitResult> {
  const target = join(input.projectsRoot, input.projectName);
  if (existsSync(target) && readdirSync(target).length > 0) {
    return { ok: false, code: 'target_exists', stderr: `${target} is not empty` };
  }
  mkdirSync(input.projectsRoot, { recursive: true });

  const clone = spawnSync(
    'git',
    ['clone', '-b', input.branch, '--', input.gitUrl, target],
    { encoding: 'utf8' },
  );
  if (clone.status !== 0) {
    return { ok: false, code: 'clone_failed', stderr: String(clone.stderr ?? '').slice(0, 500) };
  }

  const rev = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: target, encoding: 'utf8' });
  if (rev.status !== 0) {
    return { ok: false, code: 'rev_parse_failed', stderr: String(rev.stderr ?? '').slice(0, 500) };
  }

  return { ok: true, sha: rev.stdout.trim(), path: target };
}
