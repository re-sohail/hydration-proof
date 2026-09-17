// Builds the fixture apps when their sources changed since the last build.
// Usage: node scripts/fixtures-build.ts [--force]

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fixturesDir } from './lib/fixtures.ts';

const force = process.argv.includes('--force');

function newestMtime(dir: string): number {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
    const path = join(dir, entry.name);
    newest = Math.max(newest, entry.isDirectory() ? newestMtime(path) : statSync(path).mtimeMs);
  }
  return newest;
}

const shared = newestMtime(join(fixturesDir, 'next-cases'));
for (const app of ['next-app', 'next-pages']) {
  const dir = join(fixturesDir, app);
  const marker = join(dir, '.next', 'BUILD_ID');
  const stale = force || !existsSync(marker) || Math.max(shared, newestMtime(dir)) > statSync(marker).mtimeMs;
  if (!stale) {
    console.log(`${app}: up to date`);
    continue;
  }
  console.log(`${app}: building…`);
  execFileSync('pnpm', ['exec', 'next', 'build'], {
    cwd: dir,
    stdio: 'inherit',
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
  });
}

for (const harness of ['ssr-react18', 'ssr-react19']) {
  execFileSync(process.execPath, ['build.ts'], { cwd: join(fixturesDir, harness), stdio: 'inherit' });
}
