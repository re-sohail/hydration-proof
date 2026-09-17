import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Report } from '../../src/report/model.ts';
import { fixturesDir } from '../../../../scripts/lib/fixtures.ts';

// 0.8: the built CLI against apps of every supported framework. Each app has
// the same pages: two with mismatches (/date-now, /math-random) and several
// that must stay clean.

const cli = new URL('../../dist/cli.js', import.meta.url).pathname;

function runCli(app: string, args: string[] = []): { status: number | null; stdout: string; stderr: string; report: Report } {
  const cwd = join(fixturesDir, app);
  const result = spawnSync(process.execPath, [cli, 'test', ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CI: '', FORCE_COLOR: '0', ASTRO_TELEMETRY_DISABLED: '1' },
    timeout: 300_000,
  });
  const report = JSON.parse(readFileSync(join(cwd, '.hydration-proof', 'report', 'report.json'), 'utf8')) as Report;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, report };
}

const findings = (report: Report): string[] =>
  report.issues
    .filter((issue) => !issue.ignored && issue.severity !== 'info')
    .map((issue) => `${issue.route.pattern} ${issue.code}${issue.selector ? ` ${issue.selector}` : ''}`)
    .sort();

const built = (app: string, output: string): boolean => existsSync(cli) && existsSync(join(fixturesDir, app, output));

const FRAMEWORKS: [app: string, output: string, adapter: string, extra: string[]][] = [
  ['react-router', 'build/server/index.js', 'react-router', ['/nav-target HP5004']],
  ['remix', 'build/server/index.js', 'remix', ['/nav-target HP5004']],
  ['vite-ssr', 'dist/server/entry-server.js', 'vite', []],
  ['astro-react', 'dist/server/entry.mjs', 'astro', ['/islands HP1001 #island-random']],
];

describe.each(FRAMEWORKS)('%s', (app, output, adapter, extra) => {
  it.skipIf(!built(app, output))(`finds the mismatches with the ${adapter} adapter and nothing else`, () => {
    const { status, stdout, stderr, report } = runCli(app);
    expect(status, stderr).toBe(1);
    expect(findings(report)).toEqual(['/date-now HP1001 #date-now', '/math-random HP1001 #math-random', ...extra].sort());
    const patterns = report.pages.map((page) => page.route.pattern);
    expect(patterns).toEqual(expect.arrayContaining(['/static', '/counter', '/date-now', '/math-random']));
    if (adapter !== 'vite') {
      // Discovered routes, including the dynamic one with its example value.
      // The dynamic route found by the adapter, tested with its example value.
      expect(report.pages.find((page) => page.route.pattern === '/products/[id]')).toMatchObject({ status: 'passed', url: expect.stringMatching(/\/products\/1$/) });
      expect(report.pages.find((page) => page.route.pattern === '/static')?.source).toBe('discovered');
      expect(report.pages.some((page) => page.source === 'not-found' && page.status === 'passed')).toBe(true);
    }
    const dateNow = report.issues.find((issue) => issue.route.pattern === '/date-now')!;
    expect(dateNow.cause?.id).toBe('time');
    expect(stdout).not.toContain('HP9');
    expect(report.summary.redacted).toBeUndefined();
  });
});

describe.skipIf(!existsSync(cli) || !existsSync(join(fixturesDir, 'ssr-react19', 'dist')))('custom node server (node adapter)', () => {
  it('tests a streaming React server started from package.json scripts', () => {
    const { status, stderr, report } = runCli('ssr-react19');
    expect(status, stderr).toBe(1);
    expect(findings(report)).toEqual(['/text-mismatch HP1001 #env', '/two-roots HP3004 #_R_0_']);
    expect(report.pages.find((page) => page.route.pattern === '/suspense')).toMatchObject({ status: 'passed' });
    expect(report.pages.find((page) => page.route.pattern === '/two-roots-prefixed')?.status).toBe('passed');
  });
});
