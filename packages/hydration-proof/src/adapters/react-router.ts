import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { flattenRouteTree, localBin, routeTreeFromCli } from '../routes/route-tree.ts';
import { execCommand, runScript } from '../util/package-manager.ts';
import { inlineScript, routerNavigate } from './markers.ts';
import { configFiles, hasAnyFile, hasDependency, readPackage } from './package.ts';
import type { Adapter } from './types.ts';

// React Router in framework mode (v7 and later).

export const reactRouterAdapter: Adapter = {
  name: 'react-router',
  detect(rootDir) {
    const pkg = readPackage(rootDir);
    return hasDependency(pkg, '@react-router/dev') || hasAnyFile(rootDir, configFiles('react-router.config'));
  },
  commands({ rootDir, packageManager }) {
    const pkg = readPackage(rootDir);
    const script = (name: string, marker: string): string | undefined =>
      pkg?.scripts?.[name]?.includes(marker) ? runScript(packageManager, name) : undefined;
    return {
      build: script('build', 'react-router build') ?? execCommand(packageManager, 'react-router', 'build'),
      start: execCommand(packageManager, 'react-router-serve', './build/server/index.js'),
      dev: execCommand(packageManager, 'react-router', 'dev --port {port} --strictPort --host 127.0.0.1'),
      buildOutput: 'build/server/index.js',
    };
  },
  discoverRoutes({ rootDir }) {
    const bin = localBin(rootDir, 'react-router');
    const tree = bin ? routeTreeFromCli(bin, ['routes', '--json'], rootDir) : undefined;
    const appDirectory = existsSync(join(rootDir, 'src', 'app')) && !existsSync(join(rootDir, 'app')) ? 'src/app' : 'app';
    return tree ? flattenRouteTree(tree, appDirectory) : [];
  },
  markers: [inlineScript('react-router-context', /__reactRouter(?:Context|Manifest|RouteModules)|window\.__reactRouter/)],
  navigation: { navigate: routerNavigate('__reactRouterDataRouter') },
  notFound: true,
};
