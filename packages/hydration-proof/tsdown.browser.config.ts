import { defineConfig, type UserConfig } from 'tsdown';

// Code that runs inside a browser: the capture runtime (injected into the
// page under test), the HTML report viewer and the development overlay. Built first; the Node build
// inlines the output (see scripts/inline-browser-plugin.ts). IIFE output
// allows one entry per build.
function browserBundle(name: string, entry: string, clean: boolean): UserConfig {
  return {
    entry: { [name]: entry },
    outDir: '.browser-build',
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    dts: false,
    hash: false,
    sourcemap: false,
    exports: false,
    clean,
    tsconfig: 'tsconfig.browser.json',
    outputOptions: { entryFileNames: '[name].js' },
  };
}

export default defineConfig([
  browserBundle('runtime', 'src/runtime/index.ts', true),
  browserBundle('report-client', 'src/report/client/app.ts', false),
  browserBundle('overlay', 'src/overlay/index.ts', false),
]);
