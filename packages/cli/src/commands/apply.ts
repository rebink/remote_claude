import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { applyPatchInteractive, applyPatch, splitDiffByFile } from '../lib/patch.ts';
import { log } from '../lib/log.ts';

export interface ApplyOpts {
  yes?: boolean;
  json?: boolean;
  print?: (line: string) => void;
}

export async function runApply(cwd: string, patchPath?: string, opts: ApplyOpts = {}): Promise<void> {
  const print = opts.print ?? ((l: string) => console.log(l));
  const target = patchPath ? resolve(cwd, patchPath) : join(cwd, '.patchwire', 'last.patch');

  let diff: string;
  try {
    diff = await readFile(target, 'utf8');
  } catch (e) {
    if (opts.json) {
      print(JSON.stringify({ type: 'error', applied: false, message: String(e) }));
      return;
    }
    log.err(`Patch file not found: ${target}`);
    process.exitCode = 1;
    return;
  }

  if (!opts.yes) {
    log.step(`Reviewing patch ${target}`);
    await applyPatchInteractive(diff, cwd);
    return;
  }

  try {
    await applyPatch(diff, cwd);
    const files = splitDiffByFile(diff).map((c) => c.path);
    if (opts.json) print(JSON.stringify({ type: 'result', applied: true, files }));
  } catch (e) {
    if (opts.json) {
      print(JSON.stringify({ type: 'error', applied: false, message: String(e) }));
    } else {
      throw e;
    }
  }
}
