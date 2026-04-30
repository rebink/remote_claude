import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { applyPatchInteractive } from '../lib/patch.ts';
import { log } from '../lib/log.ts';

export async function runApply(cwd: string, patchPath?: string): Promise<void> {
  const target = patchPath ? resolve(cwd, patchPath) : join(cwd, '.devbridge', 'last.patch');
  if (!existsSync(target)) {
    log.err(`Patch file not found: ${target}`);
    process.exitCode = 1;
    return;
  }
  const diff = await readFile(target, 'utf8');
  log.step(`Reviewing patch ${target}`);
  await applyPatchInteractive(diff, cwd);
}
