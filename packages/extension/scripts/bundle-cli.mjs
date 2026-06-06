// Build the CLI fully-bundled (all deps inlined) and copy it into the extension's
// dist/cli/ so the .vsix ships a runnable CLI (no system Node/PATH needed).
//
// We use tsup to produce a self-contained CJS bundle with all third-party deps
// inlined. The `shims: true` option makes tsup inject an `import.meta.url`
// shim so that source files using import.meta.url work correctly in CJS output.
import { build } from 'tsup';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const extRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const cliPkg = join(extRoot, '..', 'cli');
const outDir = join(extRoot, 'dist', 'cli');
const bundledJs = join(outDir, 'cli.js');

mkdirSync(outDir, { recursive: true });

// Build from the CLI package root so dependency resolution works correctly.
// noExternal bundles ALL third-party deps into the output file.
// shims: true injects createRequire + import.meta.url shims for CJS output.
await build({
  entry: { cli: join(cliPkg, 'src', 'cli.ts') },
  format: ['cjs'],
  target: 'node20',
  platform: 'node',
  outDir,
  bundle: true,
  clean: false,
  splitting: false,
  sourcemap: false,
  noExternal: [/.*/],
  shims: true,
  banner: { js: '#!/usr/bin/env node' },
  tsconfig: join(cliPkg, 'tsconfig.json'),
  cwd: cliPkg,
  // Output as .js (not .cjs) so the resolver path `dist/cli/cli.js` is correct.
  outExtension: () => ({ js: '.js' }),
  silent: true,
});

if (!existsSync(bundledJs)) throw new Error(`CLI build did not produce ${bundledJs}`);
console.log('bundled cli.js → dist/cli/cli.js');
