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
  // Bundle the private workspace package into dist so the published CLI has no
  // dependency on the unpublished @patchwire/protocol@0.0.0 (which 404s on npm
  // install). All other deps are real npm packages and stay external.
  noExternal: ['@patchwire/protocol'],
  clean: true,
  sourcemap: false,
  splitting: false,
  shims: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
});
