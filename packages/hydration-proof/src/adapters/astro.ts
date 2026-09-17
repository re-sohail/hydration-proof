import { discoverAstroRoutes } from '../routes/route-tree.ts';
import { execCommand, runScript } from '../util/package-manager.ts';
import { elementTag, inlineScript } from './markers.ts';
import { configFiles, hasAnyFile, hasDependency, readPackage } from './package.ts';
import type { Adapter } from './types.ts';

// Astro with React islands. Every <astro-island> is its own React root.

/** Attributes Astro sets or removes on islands while loading them. */
const ISLAND_ATTRIBUTES = [
  'ssr',
  'uid',
  'prefix',
  'props',
  'opts',
  'client',
  'component-url',
  'component-export',
  'renderer-url',
  'before-hydration-url',
  'await-children',
  'hydrate',
  'server-render-time',
  'client-render-time',
];

export const astroAdapter: Adapter = {
  name: 'astro',
  detect(rootDir) {
    return hasDependency(readPackage(rootDir), 'astro') || hasAnyFile(rootDir, configFiles('astro.config'));
  },
  commands({ rootDir, packageManager }) {
    const pkg = readPackage(rootDir);
    const node = hasDependency(pkg, '@astrojs/node');
    const build = pkg?.scripts?.['build']?.includes('astro') ? runScript(packageManager, 'build') : execCommand(packageManager, 'astro', 'build');
    return {
      build,
      // The Node adapter (standalone) runs the built server; static sites use astro preview.
      start: node ? 'node ./dist/server/entry.mjs' : execCommand(packageManager, 'astro', 'preview --port {port} --host 127.0.0.1'),
      dev: execCommand(packageManager, 'astro', 'dev --port {port} --host 127.0.0.1'),
      buildOutput: node ? 'dist/server/entry.mjs' : 'dist',
      // Astro 7 moves its servers to the background when it detects an AI agent; keep them attached.
      env: { HOST: '127.0.0.1', ASTRO_DEV_BACKGROUND: '1', ASTRO_PREVIEW_BACKGROUND: '1' },
    };
  },
  discoverRoutes({ rootDir }) {
    return discoverAstroRoutes(rootDir);
  },
  markers: [
    { id: 'astro-end-comment', match: (node) => (node.k === 8 && node.text === 'astro:end' ? 'drop' : undefined) },
    inlineScript('astro-island-loader', /customElements\.define\(\s*["']astro-island["']|astro:(?:load|idle|visible|only|media)|Astro\.\w+\s*=/),
    elementTag('astro-dev-toolbar', ['astro-dev-toolbar', 'astro-dev-overlay']),
    inlineScript('astro-dev-toolbar-script', /astro:dev-toolbar|@vite\/client/),
  ],
  elementAttributes: { 'astro-island': ISLAND_ATTRIBUTES, 'astro-slot': ['name'], 'astro-static-slot': ['name'] },
  notFound: true,
  pagesWithoutReact: true,
};
