import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nextMarkers } from '../../src/adapters/next.ts';
import { DEFAULT_NORMALIZE } from '../../src/dom/normalize.ts';
import { createResolver } from '../../src/engine/enrich.ts';
import { DEFAULT_ENGINE, runJobs, type PageRun } from '../../src/engine/run.ts';
import { fixturesDir, startFixture, type FixtureMode, type RunningFixture } from '../../../../scripts/lib/fixtures.ts';
import { CASES, caseId, jobFor, judge, type JudgeOptions } from '../helpers/cases.ts';
import { DEFAULT_CONTEXT, SERVER_ENV } from '../../../../fixtures/cases.ts';

// The exit checks of 0.1 and 0.2, for both routers:
//  - production builds: every broken fixture is detected with the right
//    cause, and no control page fails;
//  - development servers: additionally, every finding points at the right
//    file and line.

const apps = ['next-app', 'next-pages'] as const;
const built = apps.every((app) => existsSync(`${fixturesDir}${app}/.next/BUILD_ID`));
const withDev = process.env['HP_E2E_DEV'] !== '0';

void SERVER_ENV;

function readLine(app: string) {
  return (file: string, line: number): string | undefined => {
    try {
      return readFileSync(resolve(fixturesDir, app, file), 'utf8').split(/\r?\n/)[line - 1];
    } catch {
      return undefined;
    }
  };
}

function suite(mode: FixtureMode, options: Omit<JudgeOptions, 'readLine'>): void {
  const fixtures = new Map<string, RunningFixture>();
  let browser: Browser;
  const runs = new Map<string, PageRun>();

  beforeAll(async () => {
    browser = await chromium.launch();
    for (const app of apps) fixtures.set(app, await startFixture(app, mode));
    for (const app of apps) {
      const fixture = fixtures.get(app)!;
      const cases = CASES.filter((entry) => entry.app === app);
      // Development servers compile routes on first request.
      if (mode === 'dev') for (const entry of cases) await fetch(fixture.url + entry.route).catch(() => {});
      const rootDir = `${fixturesDir}${app}`;
      const results = await runJobs(
        browser,
        cases.map((entry) => jobFor(entry, fixture)),
        {
          ...DEFAULT_ENGINE,
          workers: mode === 'dev' ? 4 : 6,
          rootDir,
          resolver: createResolver(rootDir),
          serverEnvironment: { locale: DEFAULT_CONTEXT.locale, timezoneId: DEFAULT_CONTEXT.timezoneId },
          normalize: { ...DEFAULT_NORMALIZE, markers: [...DEFAULT_NORMALIZE.markers, ...nextMarkers] },
        },
      );
      for (const run of results) runs.set(run.job.id, run);
    }

    const rows = CASES.map((entry) => {
      const verdict = judge(entry, runs.get(caseId(entry))!.analysis.issues, { ...options, readLine: readLine(entry.app) });
      return `${verdict.ok ? 'ok  ' : 'FAIL'}  ${caseId(entry).padEnd(42)} ${verdict.detail}`;
    });
    const verdicts = CASES.map((entry) => ({ entry, ok: judge(entry, runs.get(caseId(entry))!.analysis.issues, { ...options, readLine: readLine(entry.app) }).ok }));
    const broken = verdicts.filter(({ entry }) => entry.kind === 'broken');
    const controls = verdicts.filter(({ entry }) => entry.kind === 'control');
    const table =
      `Mode: ${mode}\n${rows.join('\n')}\n\n` +
      `Detected ${broken.filter((v) => v.ok).length}/${broken.length} broken cases; ` +
      `${controls.filter((v) => !v.ok).length}/${controls.length} controls failed.\n`;
    mkdirSync('test-results', { recursive: true });
    writeFileSync(`test-results/fixtures-${mode}.txt`, table);
    if (mode === 'prod') writeFileSync('test-results/fixtures.txt', table);
    console.log(table);
  });

  afterAll(async () => {
    await browser?.close();
    for (const fixture of fixtures.values()) await fixture.stop();
  });

  it.each(CASES.map((entry) => [caseId(entry), entry] as const))('%s', (_id, entry) => {
    const run = runs.get(caseId(entry))!;
    const verdict = judge(entry, run.analysis.issues, { ...options, readLine: readLine(entry.app) });
    expect(verdict.ok, verdict.detail).toBe(true);
  });
}

describe.skipIf(!built)('Next.js fixtures, production builds', () => {
  suite('prod', { cause: true });
});

describe.skipIf(!withDev)('Next.js fixtures, development servers', () => {
  suite('dev', { cause: true, source: true });
});
