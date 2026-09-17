import type { MarkerRule } from '../dom/normalize.ts';
import { getAttr, isElement, isText } from '../dom/tree.ts';
import { discoverNextRoutes } from '../routes/next.ts';
import { execCommand, runScript } from '../util/package-manager.ts';
import type { Adapter } from './types.ts';

import { configFiles, hasAnyFile, hasDependency, readPackage } from './package.ts';

export const nextMarkers: MarkerRule[] = [
  {
    id: 'next-route-announcer',
    match: (node) => (isElement(node) && node.tag === 'next-route-announcer' ? 'drop' : undefined),
  },
  {
    id: 'next-dev-overlay',
    match: (node) =>
      isElement(node) && (node.tag === 'nextjs-portal' || getAttr(node, 'data-nextjs-dev-overlay') !== null || getAttr(node, 'data-next-hide-fouc') !== null)
        ? 'drop'
        : undefined,
  },
  {
    id: 'next-flight-script',
    match: (node) => {
      if (!isElement(node) || node.tag !== 'script') return undefined;
      const first = node.children[0];
      return isText(first) && /^\s*\(?self\.__next_f/.test(first.text) ? 'drop' : undefined;
    },
  },
];

export const nextAdapter: Adapter = {
  name: 'next',
  detect(rootDir) {
    return hasDependency(readPackage(rootDir), 'next') || hasAnyFile(rootDir, configFiles('next.config'));
  },
  commands({ rootDir, packageManager }) {
    const pkg = readPackage(rootDir);
    const hasBuildScript = typeof pkg?.scripts?.['build'] === 'string' && pkg.scripts['build'].includes('next build');
    return {
      build: hasBuildScript ? runScript(packageManager, 'build') : execCommand(packageManager, 'next', 'build'),
      start: execCommand(packageManager, 'next', 'start --port {port}'),
      dev: execCommand(packageManager, 'next', 'dev --port {port}'),
      buildOutput: '.next/BUILD_ID',
    };
  },
  discoverRoutes({ rootDir }) {
    return discoverNextRoutes(rootDir);
  },
  markers: nextMarkers,
  devHost: 'localhost',
  notFound: true,
  navigation: {
    // App Router and Pages Router both expose their router as window.next.router.
    navigate: `(url) => { const router = window.next && window.next.router; if (!router || typeof router.push !== 'function') return false; void Promise.resolve(router.push(url)).catch(() => {}); return true; }`,
    prefetch: `(url) => { const router = window.next && window.next.router; if (!router || typeof router.prefetch !== 'function') return false; void Promise.resolve(router.prefetch(url)).catch(() => {}); return true; }`,
  },
};
