import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runConfigShow } from '../src/commands/config-show.ts';

const YML = `project: api-server
remote:
  host: studio-mini
  user: rebin
  path: ~/workspace/api-server
  agentUrl: http://100.100.100.100:7878
  token: SECRET_TOKEN
  sshPort: 22
`;

describe('runConfigShow --json', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pw-cfg-'));
    await writeFile(join(dir, 'patchwire.yml'), YML, 'utf8');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('prints a safe config subset (no token/agentUrl)', async () => {
    const lines: string[] = [];
    await runConfigShow(dir, { json: true, print: (s) => lines.push(s) });
    const out = JSON.parse(lines.at(-1)!);
    expect(out).toEqual({
      type: 'config',
      project: 'api-server',
      host: 'studio-mini',
      user: 'rebin',
      remotePath: '~/workspace/api-server',
      sshPort: 22,
    });
    expect(lines.at(-1)).not.toContain('SECRET_TOKEN');
    expect(lines.at(-1)).not.toContain('agentUrl');
  });

  it('emits a JSON error line when no patchwire.yml', async () => {
    await rm(join(dir, 'patchwire.yml'));
    const lines: string[] = [];
    await runConfigShow(dir, { json: true, print: (s) => lines.push(s) });
    expect(JSON.parse(lines.at(-1)!).type).toBe('error');
  });
});
