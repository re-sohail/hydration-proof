// Post-build checks: package metadata (publint), type resolution (attw),
// what npm would publish, and the size budget.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = new URL('..', import.meta.url).pathname;
// The Node code ships unminified (readable stack traces; minifying it saves
// little after compression); the browser bundles inside it are minified.
// The gzipped size is roughly what users download.
const BUDGET_BYTES = 800 * 1024;
const GZIP_BUDGET_BYTES = 250 * 1024;

function run(bin: string, args: string[]): void {
  execFileSync(join(root, 'node_modules', '.bin', bin), args, { cwd: root, stdio: 'inherit' });
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

function size(dir: string): number {
  return files(dir).reduce((total, file) => total + statSync(file).size, 0);
}

function gzipSize(dir: string): number {
  return files(dir).reduce((total, file) => total + gzipSync(readFileSync(file), { level: 9 }).length, 0);
}

run('publint', ['--strict']);
run('attw', ['--pack', '.', '--profile', 'esm-only', '--exclude-entrypoints', 'package.json']);

const bytes = size(join(root, 'dist'));
const gzipped = gzipSize(join(root, 'dist'));
const kb = (bytes / 1024).toFixed(1);
const gzKb = (gzipped / 1024).toFixed(1);
if (bytes > BUDGET_BYTES || gzipped > GZIP_BUDGET_BYTES) {
  console.error(`dist is ${kb} KB (${gzKb} KB gzipped), over the ${BUDGET_BYTES / 1024} KB / ${GZIP_BUDGET_BYTES / 1024} KB budget.`);
  process.exit(1);
}
console.log(`dist size: ${kb} KB, ${gzKb} KB gzipped (budget ${BUDGET_BYTES / 1024} KB / ${GZIP_BUDGET_BYTES / 1024} KB)`);
