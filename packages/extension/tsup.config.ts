import { defineConfig } from 'tsup';

// Three build outputs from one config:
// 1. The extension host (CJS, externalizes `vscode`)
// 2. The chat webview (IIFE, browser context, copies HTML/CSS verbatim)
// 3. The setup wizard webview (same pattern as chat)
//
// `publicDir` is NOT used here because each webview source dir also contains
// .ts source files (h.ts, main.ts) which would be copied verbatim into dist.
// Instead, `onSuccess` copies only the static assets we need.
export default defineConfig([
  {
    entry: ['src/extension.ts'],
    format: ['cjs'],
    // Only `vscode` is provided by the host. Everything else (e.g. `yaml`) MUST be
    // bundled: the .vsix ships dist/ only (no node_modules), so an externalized
    // dependency throws "Cannot find module" at activation. tsup externalizes
    // package.json dependencies by default, so force-inline all non-vscode imports.
    external: ['vscode'],
    noExternal: ['yaml'],
    outDir: 'dist',
    outExtension: () => ({ js: '.cjs' }),
    banner: {},
    clean: true,
  },
  {
    entry: ['src/chat/webview/main.ts'],
    format: ['iife'],
    target: 'chrome100',
    outDir: 'dist/webview',
    outExtension: () => ({ js: '.js' }),
    onSuccess: 'cp src/chat/webview/index.html src/chat/webview/styles.css dist/webview/',
    clean: false,
  },
  {
    entry: ['src/setup/webview/main.ts'],
    format: ['iife'],
    target: 'chrome100',
    outDir: 'dist/setup-webview',
    outExtension: () => ({ js: '.js' }),
    onSuccess: 'cp src/setup/webview/index.html src/setup/webview/styles.css dist/setup-webview/',
    clean: false,
  },
]);
