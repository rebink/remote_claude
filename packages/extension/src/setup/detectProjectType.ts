import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProjectType } from './syncTemplates.ts';

const FRONTEND_DEPS = ['next', 'nuxt', 'react', 'react-dom', 'vue', '@angular/core', 'svelte', 'vite', 'astro'];

/** Best-effort project-type detection from a directory's root files. Never throws. */
export function detectProjectType(projectDir: string): ProjectType {
  try {
    if (existsSync(join(projectDir, 'pubspec.yaml'))) return 'flutter';
    const pkgPath = join(projectDir, 'package.json');
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (FRONTEND_DEPS.some((d) => d in deps)) return 'node-frontend';
      } catch { /* malformed package.json → treat as backend below */ }
      return 'node-backend';
    }
    if (['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'].some((f) => existsSync(join(projectDir, f)))) {
      return 'python';
    }
  } catch { /* fall through to common */ }
  return 'common';
}
