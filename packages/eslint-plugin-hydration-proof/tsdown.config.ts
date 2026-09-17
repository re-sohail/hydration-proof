import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'neutral',
  target: 'node22.18',
  dts: true,
  sourcemap: false,
  exports: false,
  treeshake: true,
  clean: true,
  fixedExtension: false,
  hash: false,
  deps: {
    // Types only: the plugin never imports ESLint at run time.
    neverBundle: ['eslint', 'estree'],
  },
});
