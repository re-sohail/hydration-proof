import { runScript } from '../util/package-manager.ts';
import { hasDependency, readPackage } from './package.ts';
import type { Adapter } from './types.ts';

// Custom React servers (Express, Fastify, node:http, streaming or not):
// started with the package's own scripts. Routes come from the config.

export const nodeAdapter: Adapter = {
  name: 'node',
  detect(rootDir) {
    const pkg = readPackage(rootDir);
    return hasDependency(pkg, 'react-dom') && typeof pkg?.scripts?.['start'] === 'string';
  },
  commands({ rootDir, packageManager }) {
    const scripts = readPackage(rootDir)?.scripts ?? {};
    return {
      ...(scripts['build'] ? { build: runScript(packageManager, 'build') } : {}),
      start: scripts['start'] ? runScript(packageManager, 'start') : '',
      dev: scripts['dev'] ? runScript(packageManager, 'dev') : '',
    };
  },
  markers: [],
};
