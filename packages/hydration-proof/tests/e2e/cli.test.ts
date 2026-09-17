import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Report } from '../../src/report/model.ts';
import { fixturesDir } from '../../../../scripts/lib/fixtures.ts';

// The built CLI against the App Router fixture (a small SaaS app: public
// pages, a customer area behind a login form, an admin area behind a cookie).

const cli = new URL('../../dist/cli.js', import.meta.url).pathname;
const app = `${fixturesDir}next-app`;
const ready = existsSync(cli) && existsSync(join(app, '.next', 'BUILD_ID'));

function runCli(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: app, encoding: 'utf8', env: { ...process.env, CI: '', FORCE_COLOR: '0' }, timeout: 300_000 });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function report(dir = '.hydration-proof/report'): Report {
  return JSON.parse(readFileSync(join(app, dir, 'report.json'), 'utf8')) as Report;
}

describe.skipIf(!ready)('hydration-proof test (built CLI)', () => {
  it('tests public, customer and admin pages in one run', () => {
    const result = runCli(['test', '--crawl', '--no-cache']);
    expect(result.status, result.stderr).toBe(1);
    const data = report();
    const page = (id: string) => data.pages.find((entry) => entry.id === id);

    // Signed-in areas were reached (no redirect to /login) in the right scenarios only.
    expect(page('/customer [customer]')).toMatchObject({ status: 'passed', finalUrl: expect.stringMatching(/\/customer$/) });
    expect(page('/customer/orders [customer]')?.status).toBe('passed');
    expect(page('/admin [admin]')).toMatchObject({ status: 'failed', finalUrl: expect.stringMatching(/\/admin$/) });
    expect(page('/admin [guest]')).toBeUndefined();
    expect(page('/customer [admin]')).toBeUndefined();
    const admin = data.issues.find((issue) => issue.route.pattern === '/admin');
    expect(admin).toMatchObject({ code: 'HP1001', selector: '#admin-stats', scenario: 'admin', cause: expect.objectContaining({ id: 'random' }) });
    expect(data.issues.filter((issue) => issue.code === 'HP9010')).toEqual([]);

    // Discovery sources: file system, sitemap (rebased from example.com), crawl, not-found probe.
    expect(page('/static [guest]')?.source).toBe('discovered');
    expect(page('/search?q=sitemap [guest]')?.source).toBe('sitemap');
    expect(page('/search?q=hydration [guest]')?.source).toBe('crawl');
    expect(page('/hydration-proof-not-found [guest]')).toMatchObject({ status: 'passed', source: 'not-found', http: { status: 404 } });

    // Terminal output and HTML report.
    expect(result.stdout).toContain('Report: .hydration-proof/report/report.html');
    expect(existsSync(join(app, '.hydration-proof/report/report.html'))).toBe(true);
  });

  it('runs setup and teardown hooks and answers browser requests from mocks', () => {
    rmSync(join(app, '.hydration-proof', 'hooks'), { recursive: true, force: true });
    const result = runCli(['test', '--config', 'hydration-proof.hooks.config.mjs']);
    expect(result.status, result.stderr).toBe(1);
    expect(readFileSync(join(app, '.hydration-proof/hooks/setup.txt'), 'utf8')).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(existsSync(join(app, '.hydration-proof/hooks/returned-teardown.txt'))).toBe(true);
    expect(existsSync(join(app, '.hydration-proof/hooks/teardown.txt'))).toBe(true);
    const data = report('.hydration-proof/hooks-report');
    expect(data.issues.find((issue) => issue.route.pattern === '/api-data')).toMatchObject({ code: 'HP1001', client: 'Visits: 42' });
  });

  it('splits pages across shards without overlap', () => {
    const ids: string[][] = [];
    for (const shard of ['1/2', '2/2']) {
      const result = runCli(['test', '--shard', shard, '--reporter', 'json', '--output', `.hydration-proof/shard-${shard[0]}`]);
      expect([0, 1]).toContain(result.status);
      ids.push(report(`.hydration-proof/shard-${shard[0]}`).pages.map((page) => page.id));
    }
    const all = runCli(['test', '--reporter', 'json', '--output', '.hydration-proof/shard-all']);
    expect([0, 1]).toContain(all.status);
    const full = report('.hydration-proof/shard-all').pages.map((page) => page.id).sort();
    expect([...ids[0]!, ...ids[1]!].sort()).toEqual(full);
    expect(ids[0]!.some((id) => ids[1]!.includes(id))).toBe(false);
    expect(ids[0]!.length).toBeGreaterThan(0);
    expect(ids[1]!.length).toBeGreaterThan(0);
  });

  it('reports usage errors with exit code 2', () => {
    expect(runCli(['test', '--shard', '3/2']).status).toBe(2);
    expect(runCli(['test', '--config', 'missing.config.ts']).status).toBe(2);
  });

  it('stops with exit code 2 when the setup hook fails, and still runs teardown', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hp-hooks-'));
    const server = createServer((_request, response) => response.end('<!doctype html><p>static</p>'));
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    try {
      const { port } = server.address() as AddressInfo;
      writeFileSync(
        join(dir, 'hydration-proof.config.mjs'),
        [
          "import { writeFileSync } from 'node:fs';",
          'export default {',
          "  adapter: 'none',",
          "  reporters: ['json'],",
          '  hooks: {',
          "    setup: () => { throw new Error('database is down'); },",
          "    teardown: () => writeFileSync(new URL('./teardown.txt', import.meta.url), 'done'),",
          '  },',
          '};',
        ].join('\n'),
      );
      const result = spawnSync(process.execPath, [cli, 'test', '--url', `http://127.0.0.1:${port}`], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, CI: '', FORCE_COLOR: '0' },
        timeout: 120_000,
      });
      expect(result.status, result.stderr).toBe(2);
      expect(result.stderr).toContain('The setup hook failed: database is down');
      expect(existsSync(join(dir, 'teardown.txt'))).toBe(true);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
