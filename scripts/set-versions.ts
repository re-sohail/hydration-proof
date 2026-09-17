// Pins the framework versions of the fixture apps, for the compatibility
// matrix and for reproducing a version-specific report locally.
//
// Usage:
//   node scripts/set-versions.ts --next 16.2.5
//   node scripts/set-versions.ts --react 19.0.0 --apps next-pages,ssr-react19
//   node scripts/set-versions.ts --reset
//
// Afterwards: pnpm install --no-frozen-lockfile && node scripts/fixtures-build.ts --force <apps>

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fixturesDir } from './lib/fixtures.ts';

/** Apps each dependency is pinned in when `--apps` is not given. */
const TARGETS = {
  next: ['next-app', 'next-pages'],
  react: ['next-pages', 'ssr-react18', 'ssr-react19'],
} as const;

const { values } = parseArgs({
  options: {
    next: { type: 'string' },
    react: { type: 'string' },
    apps: { type: 'string' },
    reset: { type: 'boolean' },
  },
});

if (values.reset) {
  execFileSync('git', ['checkout', '--', 'fixtures'], { cwd: new URL('..', import.meta.url).pathname, stdio: 'inherit' });
  console.log('Fixture manifests restored.');
  process.exit(0);
}
if (!values.next && !values.react) {
  console.error('Nothing to do. Pass --next <version>, --react <version> or --reset.');
  process.exit(2);
}

const chosen = values.apps?.split(',').map((app) => app.trim()).filter(Boolean);

function pin(app: string, versions: Record<string, string>): void {
  const file = join(fixturesDir, app, 'package.json');
  const manifest = JSON.parse(readFileSync(file, 'utf8')) as { dependencies?: Record<string, string> };
  const deps = manifest.dependencies;
  if (!deps) return;
  const changed: string[] = [];
  for (const [name, version] of Object.entries(versions)) {
    if (deps[name] === undefined || deps[name] === version) continue;
    deps[name] = version;
    changed.push(`${name}@${version}`);
  }
  if (changed.length === 0) {
    console.log(`${app}: unchanged`);
    return;
  }
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`${app}: ${changed.join(', ')}`);
}

if (values.next) {
  for (const app of chosen ?? TARGETS.next) pin(app, { next: values.next });
}
if (values.react) {
  // react-dom always matches react; React 18 has no separate server package to pin.
  for (const app of chosen ?? TARGETS.react) pin(app, { react: values.react, 'react-dom': values.react });
}
