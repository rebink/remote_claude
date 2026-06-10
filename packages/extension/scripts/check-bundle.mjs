// Guard against the "Cannot find module 'yaml'" class of bug: the published .vsix
// ships dist/ only (no node_modules), so the extension host bundle must not
// `require()` any package.json dependency. tsup externalizes dependencies by
// default; if one leaks through, this fails the build (and the CI release) instead
// of shipping an extension that throws at activation.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
const bundle = readFileSync(join(here, '..', 'dist', 'extension.cjs'), 'utf8');

const deps = Object.keys(pkg.dependencies ?? {});
const leaked = deps.filter(
  (d) => bundle.includes(`require("${d}")`) || bundle.includes(`require('${d}')`),
);

if (leaked.length) {
  console.error(
    `✗ extension bundle externalizes dependencies that are NOT shipped in the .vsix: ${leaked.join(', ')}`,
  );
  console.error('  They will throw "Cannot find module" at activation on a clean install.');
  console.error('  Fix: ensure tsup inlines them (noExternal) in packages/extension/tsup.config.ts');
  process.exit(1);
}

console.log('✓ extension bundle is self-contained (no externalized dependencies).');
