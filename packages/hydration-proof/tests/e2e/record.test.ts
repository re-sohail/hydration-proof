import { gzipSync } from 'node:zlib';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { describe, expect, it } from 'vitest';
import { nextMarkers } from '../../src/adapters/next.ts';
import { DEFAULT_NORMALIZE } from '../../src/dom/normalize.ts';
import { DEFAULT_ENGINE, runJobs } from '../../src/engine/run.ts';
import { capturesDir, findingsOf, recordingName, type Recording } from '../helpers/recordings.ts';
import { fixturesDir, startFixture, type RunningFixture } from '../../../../scripts/lib/fixtures.ts';
import { CASES, caseId, jobFor, judge } from '../helpers/cases.ts';
import { DEFAULT_CONTEXT } from '../../../../fixtures/cases.ts';

// Records every fixture page so its analysis can be replayed without a
// browser; the recordings are the corpus of the regression gate. Run with
// `pnpm record:captures` (which sets HP_RECORD), not as part of the suite.
//
// A page is only recorded when it agrees with the ground truth in
// fixtures/cases.ts, so a recording can never freeze a wrong result.

const record = process.env['HP_RECORD'];
const only = record && record !== 'all' ? record.split(',') : [];

describe.skipIf(!record)('record captures', () => {
  it('captures every fixture page and writes a recording', async () => {
    const wanted = CASES.filter((entry) => only.length === 0 || only.includes(entry.route));
    expect(wanted.length, `No page matches ${only.join(', ')}`).toBeGreaterThan(0);

    mkdirSync(capturesDir, { recursive: true });
    if (only.length === 0) {
      for (const file of readdirSync(capturesDir)) if (file.endsWith('.json.gz')) rmSync(join(capturesDir, file));
    }

    const browser = await chromium.launch();
    const fixtures = new Map<string, RunningFixture>();
    const written: string[] = [];
    const wrong: string[] = [];
    try {
      for (const app of new Set(wanted.map((entry) => entry.app))) {
        const fixture = await startFixture(app, 'prod');
        fixtures.set(app, fixture);
        const cases = wanted.filter((entry) => entry.app === app);
        const runs = await runJobs(
          browser,
          cases.map((entry) => jobFor(entry, fixture)),
          {
            ...DEFAULT_ENGINE,
            workers: 4,
            rootDir: `${fixturesDir}${app}`,
            serverEnvironment: { locale: DEFAULT_CONTEXT.locale, timezoneId: DEFAULT_CONTEXT.timezoneId },
            normalize: { ...DEFAULT_NORMALIZE, markers: [...DEFAULT_NORMALIZE.markers, ...nextMarkers] },
          },
        );
        for (const entry of cases) {
          const run = runs.find((candidate) => candidate.job.id === caseId(entry))!;
          // Only record what the ground truth agrees with.
          const verdict = judge(entry, run.analysis.issues, { cause: true });
          if (!verdict.ok) {
            wrong.push(`${caseId(entry)}: ${verdict.detail}`);
            continue;
          }
          const recording: Recording = {
            id: caseId(entry),
            app: entry.app,
            route: entry.route,
            kind: entry.kind,
            ...(entry.via ? { via: entry.via } : {}),
            outcome: run.capture.outcome,
            ...(run.analysis.react ? { react: run.analysis.react.version } : {}),
            status: run.analysis.status,
            findings: findingsOf(run.analysis.issues),
            recorded: new Date().toISOString().slice(0, 10),
            capture: run.capture,
            ...(run.parsed ? { parsed: run.parsed } : {}),
          };
          const gz = gzipSync(Buffer.from(JSON.stringify(recording)), { level: 9 });
          writeFileSync(join(capturesDir, recordingName(entry)), gz);
          written.push(`${caseId(entry).padEnd(46)} ${(gz.length / 1024).toFixed(0).padStart(4)} KB  ${recording.findings.join(', ') || 'clean'}`);
        }
      }
    } finally {
      await browser.close();
      for (const fixture of fixtures.values()) await fixture.stop();
    }
    console.log(`${written.length} recordings\n${written.join('\n')}`);
    expect(wrong, 'These pages disagree with fixtures/cases.ts; fix that before recording them').toEqual([]);
  });
});
