import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Issue, Report } from '../../src/report/model.ts';
import { fixturesDir } from '../../../../scripts/lib/fixtures.ts';

// 0.6 with the built CLI against the App Router fixture: streaming, head,
// duplicate ids, client-side navigation and interaction checks.

const cli = new URL('../../dist/cli.js', import.meta.url).pathname;
const app = `${fixturesDir}next-app`;
const ready = existsSync(cli) && existsSync(join(app, '.next', 'BUILD_ID'));

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

const summary = (issues: Issue[]): string[] =>
  issues.filter((issue) => !issue.ignored).map((issue) => `${issue.route.pattern} ${issue.code} ${issue.severity}${issue.selector ? ` ${issue.selector}` : ''}`);

describe.skipIf(!ready)('streaming, navigation and interaction checks (built CLI)', () => {
  it('finds boundary, head, navigation and interaction problems without false alarms', () => {
    const result = runCli(['--config', 'hydration-proof.checks.config.mjs']);
    expect(result.status, result.stderr).toBe(1);
    const data = report('.hydration-proof/checks-report');
    const found = summary(data.issues);

    // A mismatch inside one streamed Suspense boundary; the rest of the page is fine.
    expect(found).toContain('/suspense-mismatch HP1001 error #suspense-mismatch');
    expect(found.filter((entry) => entry.includes('#outside'))).toEqual([]);
    // React 19 adds client <title>/<meta> next to the server ones.
    expect(found).toContain('/head-meta HP1014 warning head > title');
    expect(found).toContain('/head-meta HP1014 warning head > meta[name="description"]');
    expect(found).toContain('/duplicate-id HP3003 info #twice-used');

    // Client navigation: content that depends on the previous page, and a component that throws.
    expect(found.filter((entry) => entry === '/nav/target HP5004 warning')).toHaveLength(2);
    const broken = data.issues.filter((issue) => issue.route.pattern === '/nav/broken' && issue.code === 'HP5005');
    expect(broken).toHaveLength(2);
    expect(broken[0]!.message).toContain('Fragile only works when the page is loaded directly.');

    // Interactions: a lost click, and custom interactions (one passes, one fails).
    expect(found).toContain('/counter HP5001 warning #counter');
    expect(data.issues.filter((issue) => issue.code === 'HP5008').map((issue) => issue.message)).toEqual([
      '"find a missing button" failed: page.click: Timeout 1000ms exceeded.',
    ]);

    // No false alarms on pages that work, including parallel routes.
    const clean = ['/static', '/dashboard', '/dashboard/settings', '/gallery', '/gallery/photo/[id]', '/nav/source'];
    for (const pattern of clean) {
      expect(found.filter((entry) => entry.startsWith(`${pattern} `) && !entry.includes('HP5008'))).toEqual([]);
    }
    const target = data.pages.find((page) => page.route.pattern === '/nav/target')!;
    expect(target.timeline?.some((entry) => entry.kind === 'navigation' && entry.label.includes('from /nav/source to /nav/target'))).toBe(true);
    expect(data.pages.find((page) => page.route.pattern === '/counter')?.timeline?.some((entry) => entry.kind === 'network')).toBe(true);
    expect(result.stdout).toContain('Interaction and navigation checks');
  });

  it('treats differences of intercepting routes as expected', () => {
    const result = runCli(['--config', 'hydration-proof.intercept.config.mjs']);
    expect([0, 1]).toContain(result.status);
    const data = report('.hydration-proof/intercept-report');
    expect(data.pages.map((page) => page.id)).toEqual(['/gallery/photo/1 [default]']);
    const [issue] = data.issues;
    expect(issue).toMatchObject({ code: 'HP5004', severity: 'info' });
    expect(issue!.evidence.map((entry) => entry.message)).toContainEqual(expect.stringContaining('intercepting route'));
    expect(issue!.evidence.map((entry) => entry.message)).toContainEqual(expect.stringContaining('<dialog#photo-modal>'));
    expect(result.status).toBe(0);
  });
});
