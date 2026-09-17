import { defineConfig } from 'tsdown';

// Code that runs inside the page under test. Built first; the Node build
// inlines the output (see scripts/inline-browser-plugin.ts).
export default defineConfig({
  entry: { runtime: 'src/runtime/index.ts' },
  outDir: '.browser-build',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  dts: false,
  hash: false,
  sourcemap: false,
  exports: false,
  clean: true,
  tsconfig: 'tsconfig.browser.json',
  outputOptions: { entryFileNames: '[name].js' },
});
