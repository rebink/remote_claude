import { afterEach, describe, expect, it, beforeEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/lib/config.ts';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'devbridge-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  delete process.env.TEST_DEVBRIDGE_TOKEN;
});

const baseYaml = (token = '${TEST_DEVBRIDGE_TOKEN}') => `project: my_app
remote:
  host: 10.0.0.1
  user: rebin
  path: ~/workspace/my_app
  agentUrl: http://10.0.0.1:7878
  token: ${token}
sync:
  exclude:
    - build/
    - node_modules/
ai:
  command: claude
  args:
    - --print
  timeoutSec: 600
`;

describe('loadConfig', () => {
  it('loads and validates a complete config', async () => {
    process.env.TEST_DEVBRIDGE_TOKEN = 'secret';
    await writeFile(join(dir, 'devbridge.yml'), baseYaml(), 'utf8');
    const cfg = await loadConfig(dir);
    expect(cfg.project).toBe('my_app');
    expect(cfg.remote.token).toBe('secret');
    expect(cfg.remote.agentUrl).toBe('http://10.0.0.1:7878');
    expect(cfg.sync.exclude).toContain('build/');
    expect(cfg.ai.timeoutSec).toBe(600);
  });

  it('throws a clear error when the env var is missing', async () => {
    await writeFile(join(dir, 'devbridge.yml'), baseYaml(), 'utf8');
    await expect(loadConfig(dir)).rejects.toThrow(/TEST_DEVBRIDGE_TOKEN/);
  });

  it('throws when the file is missing', async () => {
    await expect(loadConfig(dir)).rejects.toThrow(/devbridge init/);
  });

  it('reports zod validation issues with paths', async () => {
    await writeFile(
      join(dir, 'devbridge.yml'),
      `project: ""
remote:
  host: ""
  user: r
  path: /a
  agentUrl: not-a-url
  token: t
`,
      'utf8',
    );
    await expect(loadConfig(dir)).rejects.toThrow(/agentUrl/);
  });
});
