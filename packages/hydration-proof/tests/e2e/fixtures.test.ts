import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_ENGINE, runJobs, type PageRun } from '../../src/engine/run.ts';
import { fixturesDir, startFixture, type RunningFixture } from '../../../../scripts/lib/fixtures.ts';
import { CASES, caseId, jobFor, judge } from '../helpers/cases.ts';

// The 0.0/0.1 exit check: every broken fixture is detected and no control
// page fails, against production builds of both routers.

const apps = ['next-app', 'next-pages'] as const;
const built = apps.every((app) => existsSync(`${fixturesDir}${app}/.next/BUILD_ID`));

describe.skipIf(!built)('Next.js fixtures (production builds)', () => {
  const fixtures = new Map<string, RunningFixture>();
  let browser: Browser;
  const runs = new Map<string, PageRun>();

  beforeAll(async () => {
    browser = await chromium.launch();
    for (const app of apps) fixtures.set(app, await startFixture(app, 'prod'));
    const jobs = CASES.map((entry) => jobFor(entry, fixtures.get(entry.app)!));
    const results = await runJobs(browser, jobs, { ...DEFAULT_ENGINE, workers: 6 });
    for (const run of results) runs.set(run.job.id, run);

    const rows = CASES.map((entry) => {
      const run = runs.get(caseId(entry))!;
      const verdict = judge(entry, run.analysis.issues);
      return `${verdict.ok ? 'ok  ' : 'FAIL'}  ${caseId(entry).padEnd(42)} ${verdict.detail}`;
    });
    const detected = CASES.filter((entry) => entry.kind === 'broken' && judge(entry, runs.get(caseId(entry))!.analysis.issues).ok).length;
    const broken = CASES.filter((entry) => entry.kind === 'broken').length;
    const falsePositives = CASES.filter((entry) => entry.kind === 'control' && !judge(entry, runs.get(caseId(entry))!.analysis.issues).ok).length;
    const controls = CASES.filter((entry) => entry.kind === 'control').length;
    const table = `${rows.join('\n')}\n\nDetected ${detected}/${broken} broken cases; ${falsePositives}/${controls} controls failed.\n`;
    mkdirSync('test-results', { recursive: true });
    writeFileSync('test-results/fixtures.txt', table);
    console.log(table);
  });

  afterAll(async () => {
    await browser?.close();
    for (const fixture of fixtures.values()) await fixture.stop();
  });

  it.each(CASES.map((entry) => [caseId(entry), entry] as const))('%s', (_id, entry) => {
    const run = runs.get(caseId(entry))!;
    const verdict = judge(entry, run.analysis.issues);
    expect(verdict.ok, verdict.detail).toBe(true);
  });
});
