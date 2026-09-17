import { flattenRouteTree, localBin, routeTreeFromCli } from '../routes/route-tree.ts';
import { execCommand, runScript } from '../util/package-manager.ts';
import { inlineScript, routerNavigate } from './markers.ts';
import { configFiles, hasAnyFile, hasDependency, readPackage } from './package.ts';
import type { Adapter } from './types.ts';

// Remix v2 (Vite plugin or the classic compiler).

export const remixAdapter: Adapter = {
  name: 'remix',
  detect(rootDir) {
    return hasDependency(readPackage(rootDir), '@remix-run/dev');
  },
  commands({ rootDir, packageManager }) {
    const pkg = readPackage(rootDir);
    const vite = hasAnyFile(rootDir, configFiles('vite.config'));
    const build = pkg?.scripts?.['build']?.includes('remix') ? runScript(packageManager, 'build') : undefined;
    return vite
      ? {
          build: build ?? execCommand(packageManager, 'remix', 'vite:build'),
          start: execCommand(packageManager, 'remix-serve', './build/server/index.js'),
          dev: execCommand(packageManager, 'remix', 'vite:dev --port {port} --strictPort --host 127.0.0.1'),
          buildOutput: 'build/server/index.js',
        }
      : {
          build: build ?? execCommand(packageManager, 'remix', 'build'),
          start: execCommand(packageManager, 'remix-serve', './build/index.js'),
          dev: execCommand(packageManager, 'remix', 'dev --manual -c "remix-serve ./build/index.js"'),
          buildOutput: 'build/index.js',
        };
  },
  discoverRoutes({ rootDir }) {
    const bin = localBin(rootDir, 'remix');
    const tree = bin ? routeTreeFromCli(bin, ['routes', '--json'], rootDir) : undefined;
    return tree ? flattenRouteTree(tree, 'app') : [];
  },
  markers: [inlineScript('remix-context', /__remix(?:Context|Manifest|RouteModules)|window\.__remix/)],
  navigation: { navigate: routerNavigate('__remixRouter') },
  notFound: true,
};
