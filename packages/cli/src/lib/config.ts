import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export const ConfigSchema = z.object({
  project: z.string().min(1),
  remote: z.object({
    host: z.string().min(1),
    user: z.string().min(1),
    path: z.string().min(1),
    agentUrl: z.string().url(),
    token: z.string().min(1),
    sshPort: z.number().int().positive().optional(),
  }),
  sync: z
    .object({
      exclude: z.array(z.string()).default([]),
    })
    .default({ exclude: [] }),
  ai: z
    .object({
      command: z.string().default('claude'),
      args: z.array(z.string()).default(['--print']),
      timeoutSec: z.number().int().positive().default(600),
    })
    .default({ command: 'claude', args: ['--print'], timeoutSec: 600 }),
});

export type Config = z.infer<typeof ConfigSchema>;

const ENV_INTERPOLATION = /\$\{([A-Z0-9_]+)\}/g;

/**
 * Load `~/.patchwire/env` (KEY=VALUE lines, optional `export` prefix) into
 * process.env for keys not already set. Idempotent. Lets GUI-launched callers
 * like the VS Code extension pick up PW_TOKEN even when their PATH-stripped
 * environment doesn't have it set.
 */
let rcEnvLoaded = false;
function ensureRcEnvLoaded(): void {
  if (rcEnvLoaded) return;
  rcEnvLoaded = true;
  const envPath = join(homedir(), '.patchwire', 'env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, name, value] = m;
    if (process.env[name!] === undefined) process.env[name!] = value!;
  }
}

function interpolateEnv(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(ENV_INTERPOLATION, (_, name) => {
      const v = process.env[name];
      if (v === undefined) {
        throw new Error(`Environment variable ${name} is not set (referenced in patchwire.yml)`);
      }
      return v;
    });
  }
  if (Array.isArray(value)) return value.map(interpolateEnv);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolateEnv(v);
    return out;
  }
  return value;
}

export const DEFAULT_CONFIG_PATH = 'patchwire.yml';

export async function loadConfig(cwd = process.cwd(), path = DEFAULT_CONFIG_PATH): Promise<Config> {
  const full = resolve(cwd, path);
  if (!existsSync(full)) {
    throw new Error(`No ${path} found in ${cwd}. Run \`remote-claude init\` first.`);
  }
  const raw = await readFile(full, 'utf8');
  const parsed = parseYaml(raw);
  ensureRcEnvLoaded();
  const interpolated = interpolateEnv(parsed);
  const result = ConfigSchema.safeParse(interpolated);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid patchwire.yml:\n${issues}`);
  }
  return result.data;
}
