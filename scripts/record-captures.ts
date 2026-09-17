// Records the browser capture of every page that must stay clean, so the
// analysis can be replayed without a browser. The recordings are the corpus of
// the false-positive gate (tests/unit/regression/false-positives.test.ts).
//
// Usage:
//   node scripts/record-captures.ts                       # every control page
//   node scripts/record-captures.ts /theme-script,/counter # only these routes
//
// Run it after fixing a false positive, so the page that caused it is checked on
// every pull request from then on. It refuses to record a page that is not clean.
// The fixtures must be built (pnpm fixtures:build).

import { spawnSync } from 'node:child_process';

const routes = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));

// The engine inlines its browser bundle through a Vite virtual module, so the
// recording runs inside vitest rather than as a plain script.
const result = spawnSync('pnpm', ['--filter', 'hydration-proof', 'exec', 'vitest', 'run', '--project', 'e2e', 'tests/e2e/record.test.ts'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, HP_RECORD: routes.length > 0 ? routes.join(',') : 'all' },
});
process.exitCode = result.status ?? 1;
