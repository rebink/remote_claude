import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
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
  const dir = join(cwd, '.patchwire');
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
  conflictedFiles?: string[];
}

/**
 * Extract the pre-image blob SHA from a file chunk's `index <pre>..<post>` line.
 * Returns null for new files (all-zero pre-image) or when no index line is present.
 */
export function parsePreImageSha(chunkText: string): string | null {
  for (const line of chunkText.split('\n')) {
    const m = line.match(/^index ([0-9a-f]+)\.\.[0-9a-f]+/);
    if (m) {
      const pre = m[1]!;
      return /^0+$/.test(pre) ? null : pre;
    }
  }
  return null;
}

export interface DriftedFile {
  path: string;
  /** `modified`: local content changed since the snapshot; `missing`: file gone; `exists`: a "new" file already exists locally. */
  reason: 'modified' | 'missing' | 'exists';
}
export interface DriftResult {
  drifted: DriftedFile[];
}

function gitHashObject(cwd: string, relPath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('git', ['hash-object', '--', relPath], { cwd, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout?.on('data', (b) => (out += b.toString()));
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? out.trim() : null));
  });
}

/**
 * Compare each file the diff modifies against the developer's local working tree.
 * The diff is produced on the remote against the *synced* snapshot; this reports
 * which local files have drifted from that snapshot (so apply may need a 3-way merge).
 */
export async function detectDrift(diff: string, cwd: string): Promise<DriftResult> {
  const drifted: DriftedFile[] = [];
  for (const c of splitDiffByFile(diff)) {
    if (c.isDeleted) continue;
    const abs = join(cwd, c.path);
    if (c.isNew) {
      if (existsSync(abs)) drifted.push({ path: c.path, reason: 'exists' });
      continue;
    }
    if (!existsSync(abs)) {
      drifted.push({ path: c.path, reason: 'missing' });
      continue;
    }
    const pre = parsePreImageSha(c.text);
    if (!pre) continue;
    const localSha = await gitHashObject(cwd, c.path);
    if (localSha && !localSha.startsWith(pre)) drifted.push({ path: c.path, reason: 'modified' });
  }
  return { drifted };
}

export interface Apply3wayResult {
  /** true if the patch landed (cleanly or with conflict markers); false if it could not be applied at all. */
  ok: boolean;
  /** files left with conflict markers (`<<<<<<<`) for the developer to resolve. */
  conflicted: string[];
  stderr: string;
}

function runGit(args: string[], cwd: string, stdin?: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, stdio: [stdin === undefined ? 'ignore' : 'pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (b) => (stderr += b.toString()));
    child.on('error', () => resolve({ code: -1, stderr: 'git spawn error' }));
    child.on('close', (code) => resolve({ code: code ?? -1, stderr }));
    if (stdin !== undefined) child.stdin!.end(stdin);
  });
}

/**
 * Apply a patch, reconciling local drift since the agent's snapshot.
 *
 * 1. Plain `git apply` first — its hunk-context matching already absorbs
 *    *non-overlapping* local edits without touching the index.
 * 2. If that fails, stage the patched files (giving `--3way` an index baseline)
 *    and fall back to `git apply --3way`, which performs a three-way merge using
 *    the pre-image blobs — landing the change and inserting conflict markers only
 *    where the local and AI edits overlap the same lines.
 */
export async function gitApply3way(diff: string, cwd: string): Promise<Apply3wayResult> {
  const plain = await runGit(['apply', '--whitespace=nowarn'], cwd, diff);
  if (plain.code === 0) return { ok: true, conflicted: [], stderr: plain.stderr };

  const files = splitDiffByFile(diff)
    .map((c) => c.path)
    .filter(Boolean);
  if (files.length) await runGit(['add', '--', ...files], cwd);

  const three = await runGit(['apply', '--3way', '--whitespace=nowarn'], cwd, diff);
  const conflicted = [...three.stderr.matchAll(/^U (.+)$/gm)].map((m) => m[1]!.trim());
  if (three.code === 0) return { ok: true, conflicted, stderr: three.stderr };
  if (conflicted.length > 0) return { ok: true, conflicted, stderr: three.stderr };
  // total failure: restore the index for the files we staged
  if (files.length) await runGit(['reset', '-q', '--', ...files], cwd);
  return { ok: false, conflicted: [], stderr: three.stderr };
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
    const { drifted } = await detectDrift(diff, cwd);
    if (drifted.length) {
      log.warn("Local files changed since the agent's snapshot:");
      for (const d of drifted) log.dim(`  ${d.reason.padEnd(8)} ${d.path}`);
      log.dim('A 3-way merge can reconcile non-overlapping edits automatically.');
    } else {
      log.warn('Patch does not apply cleanly as a whole. A 3-way merge or selective apply may still work.');
    }
  }

  const choices = [
    { title: 'Apply all changes (clean)', value: 'apply', show: wholeOk },
    { title: 'Apply with 3-way merge (may add conflict markers)', value: 'apply3way', show: !wholeOk },
    { title: 'Apply selected files…', value: 'selective', show: true },
    { title: 'Save patch to .patchwire/last.patch (do not apply)', value: 'save', show: true },
    { title: 'Reject', value: 'reject', show: true },
  ]
    .filter((c) => c.show)
    .map(({ title, value }) => ({ title, value }));

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
  if (action === 'apply3way') {
    const res = await gitApply3way(diff, cwd);
    if (!res.ok) {
      log.warn('3-way merge could not apply the patch. Saving it instead.');
      const path = await savePatch(diff, cwd);
      log.dim(`Saved patch → ${path}`);
      return { applied: false, reason: 'check-failed', patchPath: path };
    }
    if (res.conflicted.length) {
      log.warn(`Applied via 3-way merge with conflicts in ${res.conflicted.length} file(s) — resolve the <<<<<<< markers:`);
      for (const f of res.conflicted) log.dim(`  ${f}`);
      return { applied: true, appliedFiles: summary.files, conflictedFiles: res.conflicted };
    }
    log.ok('Applied patch via 3-way merge.');
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

/**
 * Apply a patch non-interactively (no prompts). Equivalent to the "apply all"
 * path that `applyPatchInteractive` takes when the user says yes to every file.
 * Throws if `git apply` exits non-zero.
 */
export async function applyPatch(diff: string, cwd: string): Promise<void> {
  await gitApply(diff, cwd);
}
