import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
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

function interpolateEnv(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(ENV_INTERPOLATION, (_, name) => {
      const v = process.env[name];
      if (v === undefined) {
        throw new Error(`Environment variable ${name} is not set (referenced in remote-claude.yml)`);
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

export const DEFAULT_CONFIG_PATH = 'remote-claude.yml';

export async function loadConfig(cwd = process.cwd(), path = DEFAULT_CONFIG_PATH): Promise<Config> {
  const full = resolve(cwd, path);
  if (!existsSync(full)) {
    throw new Error(`No ${path} found in ${cwd}. Run \`remote-claude init\` first.`);
  }
  const raw = await readFile(full, 'utf8');
  const parsed = parseYaml(raw);
  const interpolated = interpolateEnv(parsed);
  const result = ConfigSchema.safeParse(interpolated);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid remote-claude.yml:\n${issues}`);
  }
  return result.data;
}
