import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import prompts from 'prompts';
import { log } from './log.ts';

export function colorizeDiff(diff: string): string {
  return diff
    .split('\n')
    .map((line) => {
      if (line.startsWith('+++') || line.startsWith('---')) return chalk.bold(line);
      if (line.startsWith('@@')) return chalk.cyan(line);
      if (line.startsWith('+')) return chalk.green(line);
      if (line.startsWith('-')) return chalk.red(line);
      if (line.startsWith('diff ')) return chalk.bold.magenta(line);
      return line;
    })
    .join('\n');
}

export function summarizeDiff(diff: string): { files: string[]; added: number; removed: number } {
  const files: string[] = [];
  let added = 0;
  let removed = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) files.push(line.slice(6));
    else if (line.startsWith('+') && !line.startsWith('+++')) added++;
    else if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  return { files, added, removed };
}

export async function savePatch(diff: string, cwd: string): Promise<string> {
  const dir = join(cwd, '.devbridge');
  await mkdir(dir, { recursive: true });
  const path = join(dir, 'last.patch');
  await writeFile(path, diff, 'utf8');
  return path;
}

export interface ApplyOutcome {
  applied: boolean;
  reason?: string;
  patchPath?: string;
}

export async function applyPatchInteractive(diff: string, cwd: string): Promise<ApplyOutcome> {
  if (!diff.trim()) {
    log.warn('Diff is empty — nothing to apply.');
    return { applied: false, reason: 'empty' };
  }

  console.log(colorizeDiff(diff));
  const summary = summarizeDiff(diff);
  log.step(`\n${summary.files.length} file(s) changed, ${chalk.green(`+${summary.added}`)} ${chalk.red(`-${summary.removed}`)}`);

  const checkOk = await gitApplyCheck(diff, cwd);
  if (!checkOk) {
    log.warn('Patch does not apply cleanly to your local tree.');
    const path = await savePatch(diff, cwd);
    log.dim(`Saved patch → ${path}`);
    return { applied: false, reason: 'check-failed', patchPath: path };
  }

  const { action } = await prompts({
    type: 'select',
    name: 'action',
    message: 'Apply this patch?',
    choices: [
      { title: 'Apply all changes', value: 'apply' },
      { title: 'Save patch to .devbridge/last.patch (do not apply)', value: 'save' },
      { title: 'Reject', value: 'reject' },
    ],
    initial: 0,
  });

  if (action === 'apply') {
    await gitApply(diff, cwd);
    log.ok('Applied patch.');
    return { applied: true };
  }
  if (action === 'save') {
    const path = await savePatch(diff, cwd);
    log.ok(`Saved patch to ${path}`);
    return { applied: false, reason: 'saved', patchPath: path };
  }
  log.info('Rejected.');
  return { applied: false, reason: 'rejected' };
}

function gitApplyCheck(diff: string, cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('git', ['apply', '--check'], { cwd, stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (b) => (stderr += b.toString()));
    child.on('error', () => resolve(false));
    child.on('close', (code) => {
      if (code !== 0 && stderr) log.debug(stderr.trim());
      resolve(code === 0);
    });
    child.stdin.end(diff);
  });
}

function gitApply(diff: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['apply'], { cwd, stdio: ['pipe', 'inherit', 'inherit'] });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`git apply exited with code ${code}`));
    });
    child.stdin.end(diff);
  });
}
