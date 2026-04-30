import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    cli: 'src/cli.ts',
    agent: 'src/agent.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: false,
  splitting: false,
  shims: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
