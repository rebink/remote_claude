import { existsSync } from 'node:fs';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import prompts from 'prompts';
import { log } from '../lib/log.ts';

export async function runInit(cwd: string, opts: { force?: boolean } = {}): Promise<void> {
  const target = join(cwd, 'devbridge.yml');
  if (existsSync(target) && !opts.force) {
    log.warn(`devbridge.yml already exists at ${target}. Use --force to overwrite.`);
    return;
  }

  log.step('Configuring DevBridge for this project');
  const answers = await prompts([
    { type: 'text', name: 'project', message: 'Project name (folder name on remote)', initial: basename(cwd) },
    { type: 'text', name: 'host', message: 'Mac Mini host (IP or hostname)', initial: '192.168.1.10' },
    { type: 'text', name: 'user', message: 'Remote user', initial: process.env.USER ?? 'rebin' },
    { type: 'text', name: 'path', message: 'Remote project path', initial: '~/workspace/${project}' },
    { type: 'number', name: 'sshPort', message: 'SSH port', initial: 22 },
    { type: 'text', name: 'agentUrl', message: 'Agent URL', initial: 'http://${host}:7878' },
    { type: 'text', name: 'tokenEnv', message: 'Env var holding bearer token', initial: 'DEVBRIDGE_TOKEN' },
  ], { onCancel: () => process.exit(1) });

  const remotePath = String(answers.path).replace('${project}', String(answers.project));
  const agentUrl = String(answers.agentUrl).replace('${host}', String(answers.host));

  const yaml = `project: ${answers.project}
remote:
  host: ${answers.host}
  user: ${answers.user}
  path: ${remotePath}
  sshPort: ${answers.sshPort}
  agentUrl: ${agentUrl}
  token: \${${answers.tokenEnv}}
sync:
  exclude:
    - build/
    - .dart_tool/
    - ios/Pods/
    - node_modules/
    - .git/
ai:
  command: claude
  args:
    - --print
  timeoutSec: 600
`;

  await writeFile(target, yaml, 'utf8');
  log.ok(`Wrote ${target}`);

  await mkdir(join(cwd, '.devbridge'), { recursive: true });
  await ensureGitignoreEntry(cwd, ['.devbridge/']);
  log.dim('Set DEVBRIDGE_TOKEN in your shell before running `devbridge ask`.');
}

async function ensureGitignoreEntry(cwd: string, entries: string[]): Promise<void> {
  const path = join(cwd, '.gitignore');
  let current = '';
  if (existsSync(path)) {
    current = await readFile(path, 'utf8');
  }
  const lines = new Set(current.split('\n').map((l) => l.trim()).filter(Boolean));
  let changed = false;
  for (const e of entries) {
    if (!lines.has(e)) {
      lines.add(e);
      changed = true;
    }
  }
  if (changed) {
    await writeFile(path, Array.from(lines).join('\n') + '\n', 'utf8');
  }
}
