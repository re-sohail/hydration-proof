// Post-build checks: package metadata (publint), type resolution (attw),
// no runtime imports, and the size budget.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
// The output is not minified, so stack traces from a failing rule stay
// readable in bug reports (about 22 KB gzipped).
const BUDGET_BYTES = 100 * 1024;

function run(bin: string, args: string[]): void {
  execFileSync(join(root, 'node_modules', '.bin', bin), args, { cwd: root, stdio: 'inherit' });
}

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

run('publint', ['--strict']);
run('attw', ['--pack', '.', '--profile', 'esm-only', '--exclude-entrypoints', 'package.json']);

// The plugin has no runtime dependencies, so the JavaScript must not import anything.
for (const file of files(join(root, 'dist')).filter((name) => name.endsWith('.js'))) {
  const source = readFileSync(file, 'utf8');
  const imports = [...source.matchAll(/^\s*import\b[^;]*?from\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/gm)]
    .map((match) => match[1] ?? match[2])
    .filter((specifier) => specifier !== undefined && !specifier.startsWith('.'));
  if (imports.length > 0) {
    console.error(`${file} imports ${imports.join(', ')}; the plugin must not have runtime dependencies.`);
    process.exit(1);
  }
}

const bytes = files(join(root, 'dist')).reduce((total, file) => total + statSync(file).size, 0);
const kb = (bytes / 1024).toFixed(1);
if (bytes > BUDGET_BYTES) {
  console.error(`dist is ${kb} KB, over the ${BUDGET_BYTES / 1024} KB budget.`);
  process.exit(1);
}
console.log(`dist size: ${kb} KB (budget ${BUDGET_BYTES / 1024} KB)`);
