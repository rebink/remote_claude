import { defineConfig } from 'tsup';

// Separate config for the setup wizard webview bundle, mirroring the chat webview config.
// The wizard webview runs in a browser context and must be loaded as <script src="main.js">.
export default defineConfig({
  entry: ['src/setup/webview/main.ts'],
  format: ['iife'],
  target: 'chrome100',
  outDir: 'dist/setup-webview',
  outExtension: () => ({ js: '.js' }),
  banner: {},
  clean: false,
});
