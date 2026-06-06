import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock the `vscode` module's getConfiguration so we can drive the override setting.
let override = '';
vi.mock('vscode', () => ({
  workspace: { getConfiguration: () => ({ get: (_k: string) => override }) },
}));
import { resolveCli } from './resolveCli.ts';

describe('resolveCli', () => {
  beforeEach(() => { override = ''; });

  it('uses the patchwire.cliPath override when set', () => {
    override = '/custom/patchwire';
    const inv = resolveCli('/ext');
    expect(inv).toEqual({ command: '/custom/patchwire', baseArgs: [], env: process.env });
  });

  it('runs the bundled cli.js via the Extension Host Node when present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pw-ext-'));
    mkdirSync(join(dir, 'dist', 'cli'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'cli', 'cli.js'), '// bundled');
    const inv = resolveCli(dir);
    expect(inv.command).toBe(process.execPath);
    expect(inv.baseArgs).toEqual([join(dir, 'dist', 'cli', 'cli.js')]);
    expect(inv.env.ELECTRON_RUN_AS_NODE).toBe('1');
    rmSync(dir, { recursive: true, force: true });
  });

  it('falls back to bare `patchwire` when nothing bundled and no override', () => {
    const inv = resolveCli('/nonexistent-ext-path');
    expect(inv).toEqual({ command: 'patchwire', baseArgs: [], env: process.env });
  });
});
