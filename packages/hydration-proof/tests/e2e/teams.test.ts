import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BaselineFile } from '../../src/ci/baseline.ts';
import type { Report } from '../../src/report/model.ts';
import { fixturesDir } from '../../../../scripts/lib/fixtures.ts';

// 0.7 with the built CLI: baselines, --new-only, owners, redaction, history,
// GitHub output, merged shard reports, monorepo projects and init --ci.

const cli = new URL('../../dist/cli.js', import.meta.url).pathname;
const app = `${fixturesDir}next-app`;
const ready = existsSync(cli) && existsSync(join(app, '.next', 'BUILD_ID'));
const ci = join(app, '.hydration-proof', 'ci');

function runCli(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: options.cwd ?? app,
    encoding: 'utf8',
    env: { ...process.env, CI: '', GITHUB_ACTIONS: '', FORCE_COLOR: '0', ...options.env },
    timeout: 300_000,
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, 'utf8')) as T;
const config = ['--config', 'hydration-proof.ci.config.mjs'];

describe.skipIf(!ready)('team workflows (built CLI)', () => {
  it('records a baseline, then fails only on new or expired findings', () => {
    rmSync(ci, { recursive: true, force: true });

    const recorded = runCli(['baseline', ...config]);
    expect(recorded.status, recorded.stderr).toBe(0);
    expect(recorded.stdout).toMatch(/Baseline written to \.hydration-proof\/ci\/baseline\.json: 2 findings\./);
    const baseline = readJson<BaselineFile>(join(ci, 'baseline.json'));
    expect(baseline.entries.map((entry) => entry.route).sort()).toEqual(['/api-data', '/date-now']);
    expect(baseline.$schema).toBe('../../node_modules/hydration-proof/schema/baseline.json');

    const known = runCli(['test', ...config, '--new-only']);
    expect(known.status, known.stdout).toBe(0);
    expect(known.stdout).toContain('No new hydration problems found.');
    const report = readJson<Report>(join(ci, 'report', 'report.json'));
    expect(report.summary).toMatchObject({ new: 0, known: 2, failed: 0 });
    expect(report.issues.every((issue) => issue.ignored?.rule === 'baseline')).toBe(true);

    // Owners and redaction.
    const dateNow = report.issues.find((issue) => issue.route.pattern === '/date-now')!;
    expect(dateNow.owners).toEqual(['@acme/time']);
    const apiData = report.issues.find((issue) => issue.route.pattern === '/api-data')!;
    expect(apiData.server).toMatch(/^\[redacted\]: \d+$/);
    expect(report.summary.redacted).toMatchObject({ custom: expect.any(Number) });
    expect(readFileSync(join(ci, 'report', 'report.html'), 'utf8')).not.toContain('Visits:');

    // History: one line per run; the second run's report shows the first.
    const history = readFileSync(join(ci, 'history.ndjson'), 'utf8').trim().split('\n');
    expect(history).toHaveLength(2);
    expect(report.history).toHaveLength(1);

    // A new finding fails the run.
    const fresh = runCli(['test', ...config, '--new-only', '--route', '/math-random', '--route', '/date-now']);
    expect(fresh.status).toBe(1);
    expect(fresh.stdout).toContain('1 new issue at or above "error" severity.');
    const freshReport = readJson<Report>(join(ci, 'report', 'report.json'));
    expect(freshReport.summary).toMatchObject({ new: 1, known: 1 });
    expect(freshReport.issues.find((issue) => issue.route.pattern === '/math-random')).toMatchObject({ new: true });

    // An expired baseline entry fails the run.
    const expired = { ...baseline, entries: baseline.entries.map((entry) => (entry.route === '/date-now' ? { ...entry, expires: '2020-01-01', reason: 'Fix by 2020' } : entry)) };
    writeFileSync(join(ci, 'baseline.json'), JSON.stringify(expired));
    const late = runCli(['test', ...config, '--new-only']);
    expect(late.status).toBe(1);
    expect(late.stdout).toMatch(/The baseline entry for HP1001 on \/date-now.* expired on 2020-01-01\./);

    // Updating keeps reasons and expiry dates written by hand.
    const updated = runCli(['test', ...config, '--update-baseline']);
    expect([0, 1]).toContain(updated.status);
    expect(readJson<BaselineFile>(join(ci, 'baseline.json')).entries.find((entry) => entry.route === '/date-now')).toMatchObject({
      reason: 'Fix by 2020',
      expires: '2020-01-01',
      firstSeen: baseline.entries[0]!.firstSeen,
    });

    // --new-only without a baseline is a usage error.
    rmSync(join(ci, 'baseline.json'));
    const missing = runCli(['test', ...config, '--new-only']);
    expect(missing.status).toBe(2);
    expect(missing.stderr).toContain('--new-only compares with a baseline');
  });

  it('writes GitHub annotations and a job summary on GitHub Actions', () => {
    const summary = join(mkdtempSync(join(tmpdir(), 'hp-gh-')), 'summary.md');
    const result = runCli(['test', ...config, '--route', '/date-now'], { env: { GITHUB_ACTIONS: 'true', GITHUB_STEP_SUMMARY: summary } });
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/^::error .*title=HP1001/m);
    expect(readFileSync(summary, 'utf8')).toContain('/date-now');
  });

  it('merges shard reports into one', () => {
    const out = join(app, '.hydration-proof', 'merge');
    rmSync(out, { recursive: true, force: true });
    for (const shard of ['1/2', '2/2']) {
      const result = runCli(['test', ...config, '--shard', shard, '--output', `.hydration-proof/merge/shard-${shard[0]}`, '--reporter', 'json,html']);
      expect([0, 1]).toContain(result.status);
    }
    const parts = ['1', '2'].map((index) => readJson<Report>(join(out, `shard-${index}`, 'report.json')));
    const merged = runCli(['merge-reports', '.hydration-proof/merge/shard-1', '.hydration-proof/merge/shard-2', ...config, '--output', '.hydration-proof/merge/all', '--reporter', 'list,json,html,junit']);
    expect(merged.status).toBe(1);
    expect(merged.stdout).toContain('merged 2 reports: shard-1, shard-2');
    const report = readJson<Report>(join(out, 'all', 'report.json'));
    expect(report.pages.map((page) => page.id).sort()).toEqual([...parts[0]!.pages, ...parts[1]!.pages].map((page) => page.id).sort());
    expect(report.pages).toHaveLength(3);
    expect(report.run.shards).toEqual(['shard-1', 'shard-2']);
    expect(existsSync(join(out, 'all', 'junit.xml'))).toBe(true);
    const bad = runCli(['merge-reports', '.hydration-proof/merge/nope']);
    expect(bad.status).toBe(2);
  });

  it('tests the projects of a monorepo and writes one report', () => {
    const root = mkdtempSync(join(tmpdir(), 'hp-mono-'));
    try {
      writeFileSync(
        join(root, 'hydration-proof.config.mjs'),
        `export default { projects: [{ path: ${JSON.stringify(app)}, name: 'shop', config: 'hydration-proof.ci.config.mjs' }], reporters: ['list', 'json'] };\n`,
      );
      const result = runCli(['test', '--route', '/static'], { cwd: root });
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain('▸ shop');
      expect(result.stdout).toContain('All projects');
      const report = readJson<Report>(join(root, '.hydration-proof', 'report', 'report.json'));
      expect(report.pages.map((page) => [page.project, page.route.pattern])).toEqual([['shop', '/static']]);
      expect(report.run.shards).toEqual(['shop']);
      const unknown = runCli(['test', '--project', 'nope'], { cwd: root });
      expect(unknown.status).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes a CI workflow with init --ci', () => {
    const root = mkdtempSync(join(tmpdir(), 'hp-init-'));
    try {
      writeFileSync(join(root, 'package.json'), '{"name":"x","dependencies":{"next":"16.3.5"}}');
      writeFileSync(join(root, 'pnpm-lock.yaml'), '');
      mkdirSync(join(root, 'app'));
      writeFileSync(join(root, 'app', 'page.jsx'), 'export default () => null;');
      const github = runCli(['init', '--ci', 'github'], { cwd: root });
      expect(github.status, github.stderr).toBe(0);
      expect(readFileSync(join(root, '.github', 'workflows', 'hydration.yml'), 'utf8')).toContain('pnpm exec hydration-proof test');
      const again = runCli(['init', '--ci', 'github'], { cwd: root });
      expect(again.status).toBe(2);
      const gitlab = runCli(['init', '--ci', 'gitlab'], { cwd: root });
      expect(gitlab.status).toBe(0);
      expect(gitlab.stdout).toContain('Kept hydration-proof.config.mjs');
      expect(existsSync(join(root, '.gitlab', 'hydration-proof.yml'))).toBe(true);
      expect(runCli(['init', '--ci', 'circle'], { cwd: root }).status).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
