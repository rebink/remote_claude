import * as vscode from 'vscode';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface CliInvocation {
  command: string;
  baseArgs: string[];
  env: NodeJS.ProcessEnv;
}

/**
 * Decide how to invoke the patchwire CLI:
 *  1. `patchwire.cliPath` setting, if set (devs / custom installs).
 *  2. The CLI bundled in the extension, run with the Extension Host's own Node
 *     (`process.execPath` + ELECTRON_RUN_AS_NODE) — no system Node or PATH needed.
 *  3. Bare `patchwire` on PATH (source/dev fallback when nothing is bundled).
 */
export function resolveCli(extensionFsPath: string): CliInvocation {
  const override = vscode.workspace.getConfiguration('patchwire').get<string>('cliPath')?.trim();
  if (override) {
    return { command: override, baseArgs: [], env: process.env };
  }
  const bundled = join(extensionFsPath, 'dist', 'cli', 'cli.js');
  if (existsSync(bundled)) {
    return {
      command: process.execPath,
      baseArgs: [bundled],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    };
  }
  return { command: 'patchwire', baseArgs: [], env: process.env };
}
