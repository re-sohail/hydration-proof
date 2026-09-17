// Post-build checks: package metadata (publint), type resolution (attw),
// what npm would publish, and the size budget.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const BUDGET_BYTES = 400 * 1024;

function run(bin: string, args: string[]): void {
  execFileSync(join(root, 'node_modules', '.bin', bin), args, { cwd: root, stdio: 'inherit' });
}

function size(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? size(path) : statSync(path).size;
  }
  return total;
}

run('publint', ['--strict']);
run('attw', ['--pack', '.', '--profile', 'esm-only', '--exclude-entrypoints', 'package.json']);

const bytes = size(join(root, 'dist'));
const kb = (bytes / 1024).toFixed(1);
if (bytes > BUDGET_BYTES) {
  console.error(`dist is ${kb} KB, over the ${BUDGET_BYTES / 1024} KB budget.`);
  process.exit(1);
}
console.log(`dist size: ${kb} KB (budget ${BUDGET_BYTES / 1024} KB)`);
