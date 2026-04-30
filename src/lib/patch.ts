import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import chalk from 'chalk';
import prompts from 'prompts';
import { log } from './log.ts';

export interface FileChunk {
  /** path used for display + selection (the b/ side, or a/ for deletes) */
  path: string;
  /** raw text for this file's section, ready to feed to `git apply` on its own */
  text: string;
  added: number;
  removed: number;
  isNew: boolean;
  isDeleted: boolean;
}

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

/**
 * Split a unified `git diff` into per-file chunks. Each chunk is a self-contained
 * patch beginning with its `diff --git` header and ending at (but not including)
 * the next file's header.
 */
export function splitDiffByFile(diff: string): FileChunk[] {
  if (!diff.trim()) return [];
  const lines = diff.split('\n');
  const chunks: FileChunk[] = [];
  let start = -1;

  const flush = (end: number) => {
    if (start < 0) return;
    const text = lines.slice(start, end).join('\n').replace(/\n*$/, '\n');
    chunks.push(parseChunk(text));
  };

  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.startsWith('diff --git ')) {
      flush(i);
      start = i;
    }
  }
  flush(lines.length);
  return chunks;
}

function parseChunk(text: string): FileChunk {
  let path = '';
  let isNew = false;
  let isDeleted = false;
  let added = 0;
  let removed = 0;
  for (const line of text.split('\n')) {
    if (!path && line.startsWith('diff --git ')) {
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (m) path = m[2] ?? m[1] ?? '';
    } else if (line.startsWith('new file mode')) isNew = true;
    else if (line.startsWith('deleted file mode')) isDeleted = true;
    else if (line.startsWith('+++ b/') && !path) path = line.slice(6);
    else if (line.startsWith('+') && !line.startsWith('+++')) added++;
    else if (line.startsWith('-') && !line.startsWith('---')) removed++;
  }
  return { path, text, added, removed, isNew, isDeleted };
}

export function summarizeDiff(diff: string): { files: string[]; added: number; removed: number } {
  const chunks = splitDiffByFile(diff);
  return {
    files: chunks.map((c) => c.path),
    added: chunks.reduce((s, c) => s + c.added, 0),
    removed: chunks.reduce((s, c) => s + c.removed, 0),
  };
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
  appliedFiles?: string[];
}

export async function applyPatchInteractive(diff: string, cwd: string): Promise<ApplyOutcome> {
  if (!diff.trim()) {
    log.warn('Diff is empty — nothing to apply.');
    return { applied: false, reason: 'empty' };
  }

  console.log(colorizeDiff(diff));
  const chunks = splitDiffByFile(diff);
  const summary = summarizeDiff(diff);
  log.step(
    `\n${summary.files.length} file(s) changed, ${chalk.green(`+${summary.added}`)} ${chalk.red(`-${summary.removed}`)}`,
  );

  const wholeOk = await gitApplyCheck(diff, cwd);
  if (!wholeOk) {
    log.warn('Patch does not apply cleanly as a whole. You can still try selective per-file apply.');
  }

  const choices = [
    { title: 'Apply all changes', value: 'apply', disabled: !wholeOk },
    { title: 'Apply selected files…', value: 'selective' },
    { title: 'Save patch to .devbridge/last.patch (do not apply)', value: 'save' },
    { title: 'Reject', value: 'reject' },
  ].filter((c) => !('disabled' in c && c.disabled));

  const { action } = await prompts({
    type: 'select',
    name: 'action',
    message: 'What would you like to do?',
    choices,
    initial: 0,
  });

  if (action === 'apply') {
    await gitApply(diff, cwd);
    log.ok('Applied patch.');
    return { applied: true, appliedFiles: summary.files };
  }
  if (action === 'selective') return applySelective(chunks, cwd);
  if (action === 'save') {
    const path = await savePatch(diff, cwd);
    log.ok(`Saved patch to ${path}`);
    return { applied: false, reason: 'saved', patchPath: path };
  }
  log.info('Rejected.');
  return { applied: false, reason: 'rejected' };
}

async function applySelective(chunks: FileChunk[], cwd: string): Promise<ApplyOutcome> {
  const choices = chunks.map((c, i) => ({
    title: `${tag(c)} ${c.path} ${chalk.dim(`(+${c.added} -${c.removed})`)}`,
    value: i,
    selected: true,
  }));

  const { picks } = await prompts({
    type: 'multiselect',
    name: 'picks',
    message: 'Select files to apply (space to toggle, enter to confirm)',
    choices,
    instructions: false,
    hint: 'all selected by default',
  });

  const indexes: number[] = Array.isArray(picks) ? picks : [];
  if (indexes.length === 0) {
    log.info('Nothing selected.');
    return { applied: false, reason: 'rejected' };
  }
  const selected = indexes.map((i) => chunks[i]).filter((c): c is FileChunk => !!c);
  const partial = selected.map((c) => c.text).join('');

  const checkOk = await gitApplyCheck(partial, cwd);
  if (!checkOk) {
    log.warn('Selected files do not apply cleanly.');
    const path = await savePatch(partial, cwd);
    log.dim(`Saved partial patch → ${path}`);
    return { applied: false, reason: 'check-failed', patchPath: path };
  }
  await gitApply(partial, cwd);
  const appliedFiles = selected.map((c) => c.path);
  log.ok(`Applied ${appliedFiles.length} file(s).`);
  return { applied: true, appliedFiles };
}

function tag(c: FileChunk): string {
  if (c.isNew) return chalk.green('NEW ');
  if (c.isDeleted) return chalk.red('DEL ');
  return chalk.yellow('MOD ');
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
