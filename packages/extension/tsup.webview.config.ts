import { defineConfig } from 'tsup';

// Separate config for the webview bundle so it does not inherit the host
// extension config (which sets outExtension to .cjs and external: ['vscode']).
// The webview runs in a browser context and must be loaded as <script src="main.js">.
export default defineConfig({
  entry: ['src/chat/webview/main.ts'],
  format: ['iife'],
  outDir: 'dist/webview',
  target: 'chrome100',
  clean: false,
  // Explicitly produce .js (not .cjs) so the <script> tag in index.html resolves correctly.
  outExtension: () => ({ js: '.js' }),
});
