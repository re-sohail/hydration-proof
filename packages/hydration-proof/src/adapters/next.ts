import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { MarkerRule } from '../dom/normalize.ts';
import { getAttr, isElement, isText } from '../dom/tree.ts';
import { discoverNextRoutes } from '../routes/next.ts';
import { execCommand, runScript } from '../util/package-manager.ts';
import type { Adapter } from './types.ts';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

function readPackage(rootDir: string): PackageJson | undefined {
  try {
    return JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as PackageJson;
  } catch {
    return undefined;
  }
}

const NEXT_CONFIGS = ['next.config.js', 'next.config.mjs', 'next.config.cjs', 'next.config.ts', 'next.config.mts'];

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
    const pkg = readPackage(rootDir);
    if (pkg?.dependencies?.['next'] || pkg?.devDependencies?.['next']) return true;
    return NEXT_CONFIGS.some((file) => existsSync(join(rootDir, file)));
  },
  commands({ rootDir, packageManager }) {
    const pkg = readPackage(rootDir);
    const hasBuildScript = typeof pkg?.scripts?.['build'] === 'string' && pkg.scripts['build'].includes('next build');
    return {
      build: hasBuildScript ? runScript(packageManager, 'build') : execCommand(packageManager, 'next', 'build'),
      start: execCommand(packageManager, 'next', 'start --port {port}'),
      dev: execCommand(packageManager, 'next', 'dev --port {port}'),
      buildOutput: join('.next', 'BUILD_ID'),
    };
  },
  discoverRoutes({ rootDir }) {
    return discoverNextRoutes(rootDir);
  },
  markers: nextMarkers,
  devHost: 'localhost',
};
