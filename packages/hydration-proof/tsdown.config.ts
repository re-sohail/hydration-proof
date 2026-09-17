import { defineConfig } from 'tsdown';
import { inlineBrowserBundles } from './scripts/inline-browser-plugin.ts';

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22.18',
  dts: true,
  sourcemap: false,
  exports: false,
  treeshake: true,
  clean: true,
  fixedExtension: false,
  plugins: [inlineBrowserBundles()],
  deps: {
    neverBundle: ['playwright-core', /^playwright-core\//],
  },
});
