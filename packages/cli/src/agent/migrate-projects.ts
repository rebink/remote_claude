import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_NAME_RE = /^[a-zA-Z0-9_.-]+$/;
const DEFAULT_USER = 'default';

export interface MigrateProjectsInput {
  projectsRoot: string;
}

export interface MigrateProjectsResult {
  moved: string[];
}

/**
 * One-shot v0.1 → v0.2 project layout migration.
 *
 * Walks PROJECTS_ROOT/* and moves each child directory that looks like a
 * git project (valid name + has a .git subdir) into PROJECTS_ROOT/default/.
 * Existing user namespace dirs (e.g. PROJECTS_ROOT/default/ itself, or
 * PROJECTS_ROOT/alice/) are left untouched — they look like containers,
 * not v0.1 leftovers, because their .git would live deeper.
 *
 * Refuses to overwrite an existing PROJECTS_ROOT/default/<name>/ — that
 * means a manual setup already exists at the target; the operator must
 * resolve the conflict by hand.
 */
export function migrateProjectsToDefault(input: MigrateProjectsInput): MigrateProjectsResult {
  const root = input.projectsRoot;
  if (!existsSync(root)) {
    return { moved: [] };
  }
  const defaultRoot = join(root, DEFAULT_USER);

  const moved: string[] = [];
  for (const name of readdirSync(root)) {
    if (name === DEFAULT_USER) continue;
    if (!PROJECT_NAME_RE.test(name)) continue;
    const src = join(root, name);
    if (!statSync(src).isDirectory()) continue;
    if (!existsSync(join(src, '.git'))) continue;

    const dst = join(defaultRoot, name);
    if (existsSync(dst)) {
      throw new Error(
        `migrate-projects: ${dst} already exists; refusing to overwrite (move ${src} manually)`,
      );
    }
    mkdirSync(defaultRoot, { recursive: true });
    renameSync(src, dst);
    moved.push(name);
  }
  return { moved };
}
