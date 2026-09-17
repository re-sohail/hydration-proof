import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

// Checks the built package the way a user receives it. Skipped until
// `pnpm build` has run.
const root = new URL('../../', import.meta.url).pathname;
const dist = (file: string): string => join(root, 'dist', file);
const built = existsSync(dist('cli.js')) && existsSync(dist('index.js'));

describe.skipIf(!built)('the built package', () => {
  it('has an executable CLI with a node shebang', () => {
    const cli = readFileSync(dist('cli.js'), 'utf8');
    expect(cli.startsWith('#!/usr/bin/env node\n')).toBe(true);
    if (process.platform !== 'win32') expect(statSync(dist('cli.js')).mode & 0o111).not.toBe(0);
  });

  it('runs the CLI', () => {
    const result = spawnSync(process.execPath, [dist('cli.js'), '--version'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version);
  });

  it('inlines the browser runtime instead of reading files at run time', () => {
    const files = readdirSync(dist('.'));
    expect(files.filter((file) => file.endsWith('.js')).some((file) => readFileSync(dist(file), 'utf8').includes('__HYDRATION_PROOF__'))).toBe(true);
    expect(files.some((file) => file.includes('runtime') && file !== 'run.js')).toBe(false);
    for (const file of files.filter((name) => name.endsWith('.js'))) {
      expect(readFileSync(dist(file), 'utf8')).not.toContain('virtual:hydration-proof');
    }
  });

  it('only imports playwright-core and Node built-ins', () => {
    const specifiers = new Set<string>();
    for (const file of readdirSync(dist('.')).filter((name) => name.endsWith('.js'))) {
      const source = readFileSync(dist(file), 'utf8');
      for (const match of source.matchAll(/^import[^;]*?from\s*["']([^"']+)["']/gm)) specifiers.add(match[1]!);
      // Dynamic imports in code (not inside the config template's JSDoc).
      for (const match of source.matchAll(/\bawait import\(\s*["']([^"']+)["']\s*\)/g)) specifiers.add(match[1]!);
    }
    const external = [...specifiers].filter((spec) => !spec.startsWith('.') && !spec.startsWith('node:'));
    expect(external.sort()).toEqual(['playwright-core']);
  });

  it('declares exactly one runtime dependency and no install scripts', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, Record<string, string> | undefined>;
    expect(Object.keys(pkg['dependencies'] ?? {})).toEqual(['playwright-core']);
    for (const script of ['preinstall', 'install', 'postinstall', 'prepare']) expect(pkg['scripts']?.[script]).toBeUndefined();
  });

  it('exports typed public API', () => {
    const types = readFileSync(dist('index.d.ts'), 'utf8');
    for (const name of ['defineConfig', 'HydrationProofConfig', 'run', 'Report', 'Issue', 'ExitCode']) {
      expect(types).toContain(name);
    }
    expect(types).not.toMatch(/from ['"]\.\.?\/src/);
  });
});
