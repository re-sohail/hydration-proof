import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseTestArgs } from '../../../src/cli/commands/test.ts';
import { main } from '../../../src/cli/main.ts';
import { detectPackageManager, execCommand, selfCommand } from '../../../src/util/package-manager.ts';

describe('parseTestArgs', () => {
  it('maps flags to overrides', () => {
    const parsed = parseTestArgs([
      '--url', 'http://localhost:3000',
      '-r', 'about', '-r', '/blog',
      '--scenario', 'dark',
      '--mode', 'dev',
      '--reporter', 'list,json',
      '--workers', '2',
      '--retries', '0',
      '--no-build',
      '--fail-on', 'warning',
      '--headed',
      '-c', 'custom.config.ts',
    ]);
    expect(parsed.config).toBe('custom.config.ts');
    expect(parsed.overrides).toEqual({
      url: 'http://localhost:3000',
      routes: ['/about', '/blog'],
      scenarios: ['dark'],
      mode: 'development',
      reporters: ['list', 'json'],
      workers: 2,
      retries: 0,
      build: false,
      failOn: 'warning',
      headed: true,
    });
  });

  it('rejects bad values', () => {
    expect(() => parseTestArgs(['--workers', '0'])).toThrow(/--workers/);
    expect(() => parseTestArgs(['--browser', 'ie'])).toThrow(/--browser/);
    expect(() => parseTestArgs(['--reporter', 'xml'])).toThrow(/Unknown reporter/);
    expect(() => parseTestArgs(['--nope'])).toThrow();
  });
});

describe('main', () => {
  const capture = () => {
    let out = '';
    let err = '';
    return {
      io: { out: (text: string) => void (out += text), err: (text: string) => void (err += text) },
      get out() {
        return out;
      },
      get err() {
        return err;
      },
    };
  };

  it('prints version and help', async () => {
    const io = capture();
    expect(await main(['--version'], io.io)).toBe(0);
    expect(io.out).toMatch(/^\d+\.\d+\.\d+/);
    expect(await main(['--help'], io.io)).toBe(0);
    expect(io.out).toContain('Usage: hydration-proof <command>');
    expect(await main(['help', 'test'], io.io)).toBe(0);
    expect(io.out).toContain('--url <url>');
  });

  it('exits 2 on usage errors', async () => {
    const io = capture();
    expect(await main(['frobnicate'], io.io)).toBe(2);
    expect(io.err).toContain('Unknown command');
    expect(await main(['test', '--workers', 'x'], io.io)).toBe(2);
    expect(io.err).toContain('--workers');
  });

  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('init writes a config for a Next.js project and updates .gitignore', async () => {
    dir = mkdtempSync(join(tmpdir(), 'hp-init-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { next: '16.3.5' } }));
    writeFileSync(join(dir, 'tsconfig.json'), '{}');
    writeFileSync(join(dir, 'pnpm-lock.yaml'), '');
    writeFileSync(join(dir, '.gitignore'), 'node_modules');
    mkdirSync(join(dir, 'app', 'products', '[id]'), { recursive: true });
    writeFileSync(join(dir, 'app', 'page.tsx'), '');
    writeFileSync(join(dir, 'app', 'products', '[id]', 'page.tsx'), '');
    const io = capture();
    expect(await main(['init'], { ...io.io, cwd: dir })).toBe(0);
    const config = readFileSync(join(dir, 'hydration-proof.config.ts'), 'utf8');
    expect(config).toContain("import { defineConfig } from 'hydration-proof';");
    expect(config).toContain('"/products/[id]"');
    expect(readFileSync(join(dir, '.gitignore'), 'utf8')).toContain('.hydration-proof/report/');
    expect(io.out).toContain('pnpm exec hydration-proof test');
    expect(await main(['init'], { ...io.io, cwd: dir })).toBe(2);
    expect(existsSync(join(dir, 'hydration-proof.config.ts'))).toBe(true);
  });
});

describe('package managers', () => {
  let dir: string | undefined;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('detects from lockfiles, packageManager and the user agent', () => {
    dir = mkdtempSync(join(tmpdir(), 'hp-pm-'));
    expect(detectPackageManager(dir, { npm_config_user_agent: 'bun/1.3.0' })).toBe('bun');
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ packageManager: 'yarn@4.5.0' }));
    expect(detectPackageManager(dir, {})).toBe('yarn');
    writeFileSync(join(dir, 'package-lock.json'), '{}');
    expect(detectPackageManager(dir, {})).toBe('npm');
  });

  it('builds commands for each manager', () => {
    expect(execCommand('pnpm', 'next', 'build')).toBe('pnpm exec next build');
    expect(execCommand('yarn', 'next')).toBe('yarn next');
    expect(execCommand('bun', 'next', 'start')).toBe('bunx next start');
    expect(execCommand('npm', 'next', 'dev')).toBe('npx --no-install next dev');
    expect(selfCommand('npm', 'test')).toBe('npx hydration-proof test');
  });
});
