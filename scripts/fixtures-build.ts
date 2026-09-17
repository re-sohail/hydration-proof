// Builds the fixture apps when their sources changed since the last build.
// Usage: node scripts/fixtures-build.ts [--force] [app...]
//
// Naming apps builds only those (plus the SSR harnesses when named), which is
// what the compatibility matrix uses after changing a framework version.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fixturesDir } from './lib/fixtures.ts';

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = new Set(args.filter((arg) => !arg.startsWith('--')));
const wanted = (app: string): boolean => only.size === 0 || only.has(app);

function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    // Build output, dependencies and tool output (.next, .hydration-proof) do not count.
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'build' || entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('hydration-proof.')) continue;
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

const shared = newestMtime(join(fixturesDir, 'next-cases'));
// App → file that exists after a build.
const APPS: [app: string, output: string, dependsOnShared: boolean][] = [
  ['next-app', '.next/BUILD_ID', true],
  ['next-pages', '.next/BUILD_ID', true],
  ['react-router', 'build/server/index.js', false],
  ['remix', 'build/server/index.js', false],
  ['vite-ssr', 'dist/server/entry-server.js', false],
  ['astro-react', 'dist/server/entry.mjs', false],
];
const unknown = [...only].filter((app) => !APPS.some(([name]) => name === app) && app !== 'ssr-react18' && app !== 'ssr-react19');
if (unknown.length > 0) {
  console.error(`Unknown fixture app: ${unknown.join(', ')}`);
  process.exit(2);
}

for (const [app, output, dependsOnShared] of APPS) {
  if (!wanted(app)) continue;
  const dir = join(fixturesDir, app);
  const marker = join(dir, output);
  const newest = Math.max(dependsOnShared ? shared : 0, newestMtime(dir));
  const stale = force || !existsSync(marker) || newest > statSync(marker).mtimeMs;
  if (!stale) {
    console.log(`${app}: up to date`);
    continue;
  }
  console.log(`${app}: building…`);
  execFileSync('pnpm', ['run', 'build'], {
    cwd: dir,
    stdio: 'inherit',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ASTRO_TELEMETRY_DISABLED: '1' },
  });
}

for (const harness of ['ssr-react18', 'ssr-react19']) {
  if (!wanted(harness)) continue;
  execFileSync(process.execPath, ['build.ts'], { cwd: join(fixturesDir, harness), stdio: 'inherit' });
}
