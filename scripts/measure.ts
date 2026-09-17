// Runs every fixture case against production builds and prints the
// detection / false-positive table (the 0.0 exit check).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const table = new URL('../packages/hydration-proof/test-results/fixtures.txt', import.meta.url);
const result = spawnSync('pnpm', ['--filter', 'hydration-proof', 'exec', 'vitest', 'run', '--project', 'e2e'], {
  stdio: ['ignore', 'ignore', 'inherit'],
  shell: process.platform === 'win32',
});
if (existsSync(table)) process.stdout.write(readFileSync(table, 'utf8'));
process.exitCode = result.status ?? 1;
