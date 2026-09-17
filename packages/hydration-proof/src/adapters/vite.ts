import { runScript } from '../util/package-manager.ts';
import { inlineScript, scriptSource } from './markers.ts';
import { hasAnyFile, hasDependency, readPackage } from './package.ts';
import type { Adapter } from './types.ts';

// Vite SSR apps without a framework (a custom server renders with Vite's
// SSR build). Commands come from package.json scripts; routes from the config.

const SERVER_ENTRIES = ['server.js', 'server.mjs', 'server.ts', 'src/entry-server.tsx', 'src/entry-server.jsx', 'src/entry-server.ts', 'src/entry-server.js'];

export const viteAdapter: Adapter = {
  name: 'vite',
  detect(rootDir) {
    const pkg = readPackage(rootDir);
    return hasDependency(pkg, 'vite') && hasDependency(pkg, 'react-dom') && hasAnyFile(rootDir, SERVER_ENTRIES);
  },
  commands({ rootDir, packageManager }) {
    const scripts = readPackage(rootDir)?.scripts ?? {};
    const start = scripts['start'] ? 'start' : scripts['serve'] ? 'serve' : scripts['preview'] ? 'preview' : undefined;
    return {
      ...(scripts['build'] ? { build: runScript(packageManager, 'build') } : {}),
      start: start ? runScript(packageManager, start) : '',
      dev: scripts['dev'] ? runScript(packageManager, 'dev') : '',
      buildOutput: 'dist',
    };
  },
  markers: [
    scriptSource('vite-client', /\/@vite\/client|\/@id\/__x00__|\/@react-refresh/),
    inlineScript('vite-react-refresh', /\/@react-refresh|__vite_plugin_react_preamble_installed__/),
  ],
};
