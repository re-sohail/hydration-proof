import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, firefox } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import type { Issue, Report } from '../../src/report/model.ts';
import { fixturesDir } from '../../../../scripts/lib/fixtures.ts';

// 0.4 with the built CLI against the App Router fixture: environment matrix,
// probes and repeated runs.

const cli = new URL('../../dist/cli.js', import.meta.url).pathname;
const app = `${fixturesDir}next-app`;
const ready = existsSync(cli) && existsSync(join(app, '.next', 'BUILD_ID')) && existsSync(chromium.executablePath());

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cli, 'test', ...args], {
    cwd: app,
    encoding: 'utf8',
    env: { ...process.env, CI: '', FORCE_COLOR: '0' },
    timeout: 420_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function report(dir: string): Report {
  return JSON.parse(readFileSync(join(app, dir, 'report.json'), 'utf8')) as Report;
}

const byRoute = (issues: Issue[], pattern: string): Issue[] => issues.filter((issue) => issue.route.pattern === pattern && !issue.ignored);

describe.skipIf(!ready)('environments (built CLI)', () => {
  it.skipIf(!existsSync(firefox.executablePath()))('tests a matrix of locales, timezones and browsers and names the environment that fails', () => {
    const result = runCli(['--config', 'hydration-proof.matrix.config.mjs']);
    expect(result.status, result.stderr).toBe(1);
    const data = report('.hydration-proof/matrix-report');

    // Pairwise coverage of 3 two-valued axes: 4 environments per route.
    expect(data.pages).toHaveLength(12);
    expect(new Set(data.pages.map((page) => page.scenario)).size).toBe(4);
    expect(data.run.browsers.map((name) => name.split(' ')[0]).sort()).toEqual(['chromium', 'firefox']);
    for (const page of data.pages) {
      expect(page.baseScenario).toBe('visitor');
      expect(Object.keys(page.environment ?? {}).sort()).toEqual(['browser', 'locale', 'timezone']);
    }
    expect(data.pages.filter((page) => page.route.pattern === '/static').map((page) => page.status)).toEqual(['passed', 'passed', 'passed', 'passed']);

    const locale = byRoute(data.issues, '/locale');
    expect(locale.length).toBeGreaterThan(0);
    for (const issue of locale) {
      expect(issue.onlyIn).toEqual([{ axis: 'locale', values: ['de-DE'] }]);
      expect(issue.scenario).toContain('de-DE');
    }
    const timezone = byRoute(data.issues, '/timezone');
    expect(timezone.length).toBeGreaterThan(0);
    for (const issue of timezone) expect(issue.onlyIn).toEqual([{ axis: 'timezone', values: ['Asia/Karachi'] }]);

    expect(result.stdout).toContain('Only in some environments');
    expect(result.stdout).toMatch(/\/locale .*Only found with locale de-DE\./);
    expect(readFileSync(join(app, '.hydration-proof/matrix-report/report.html'), 'utf8')).toContain('onlyIn');
  });

  it('proves causes with probes', () => {
    const result = runCli(['--config', 'hydration-proof.probes.config.mjs']);
    expect(result.status, result.stderr).toBe(1);
    const data = report('.hydration-proof/probes-report');
    const cause = (pattern: string) => {
      const issue = byRoute(data.issues, pattern).find((entry) => entry.code === 'HP1001');
      return issue?.cause && { id: issue.cause.id, proven: issue.cause.proven ?? false };
    };
    expect(cause('/date-now')).toEqual({ id: 'time', proven: true });
    expect(cause('/math-random')).toEqual({ id: 'random', proven: true });
    expect(cause('/timezone')).toEqual({ id: 'timezone', proven: true });
    expect(cause('/local-storage')).toEqual({ id: 'storage', proven: true });
    // The API counter changes between identical loads: data, not provable by the browser.
    expect(cause('/api-data')).toEqual({ id: 'data', proven: false });
    const apiData = byRoute(data.issues, '/api-data')[0]!;
    expect(apiData.probes?.find((probe) => probe.factor === 'repeat')?.result).toBe('changes');
    expect(result.stdout).toMatch(/Probes: \d+ extra page loads for 5 pages\./);
    expect(result.stdout).toContain('proven: time-dependent value');
  });

  it('marks findings that appear in only some runs as flaky', () => {
    const result = runCli(['--route', '/flaky', '--route', '/static', '--repeat', '4', '--workers', '1', '--reporter', 'json', '--output', '.hydration-proof/repeat-report']);
    expect(result.status, result.stderr).toBe(1);
    const data = report('.hydration-proof/repeat-report');
    const flaky = data.pages.find((page) => page.route.pattern === '/flaky')!;
    const clean = data.pages.find((page) => page.route.pattern === '/static')!;
    expect(flaky).toMatchObject({ status: 'failed', runs: 4, flakiness: 0.5 });
    expect(clean).toMatchObject({ status: 'passed', runs: 4, flakiness: 0 });
    const coin = byRoute(data.issues, '/flaky').find((issue) => issue.selector === '#coin');
    expect(coin).toMatchObject({ code: 'HP1001', flaky: true, occurrences: { seen: 2, runs: 4 } });
    expect(data.summary.flaky).toBeGreaterThanOrEqual(1);
    expect(data.pages).toHaveLength(2);
  });
});
