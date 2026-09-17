import { gunzipSync } from 'node:zlib';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { PageCapture } from '../../src/engine/capture.ts';
import type { ParsedDocument } from '../../src/engine/parse-stage.ts';
import type { Issue, PageStatus } from '../../src/report/model.ts';
import type { FixtureCase } from '../../../../fixtures/cases.ts';

// Recorded browser captures of the fixture pages. `record.test.ts` writes them;
// `tests/unit/regression/replay.test.ts` replays them without a browser.

export const capturesDir: string = new URL('../../../../fixtures/captures/', import.meta.url).pathname;

export interface Recording {
  id: string;
  app: string;
  route: string;
  kind: 'broken' | 'control';
  via?: 'direct' | 'cdn-proxy';
  outcome: PageCapture['outcome'];
  react?: string;
  status: PageStatus;
  /** What the analysis reported, as `CODE@selector` (info and ignored left out). */
  findings: string[];
  /** The day it was recorded, so a stale corpus is visible. */
  recorded: string;
  capture: PageCapture;
  parsed?: ParsedDocument;
}

/** The findings of an analysis, in the compact form the corpus compares. */
export function findingsOf(issues: readonly Issue[]): string[] {
  return issues
    .filter((issue) => !issue.ignored && issue.severity !== 'info')
    .map((issue) => `${issue.code}${issue.selector ? `@${issue.selector}` : ''}`)
    .sort();
}

/** A stable file name for a case. */
export function recordingName(entry: Pick<FixtureCase, 'app' | 'route' | 'via'>): string {
  return `${entry.app}${entry.route.replace(/\//g, '--')}${entry.via === 'cdn-proxy' ? '--via-cdn' : ''}.json.gz`;
}

export function readRecordings(): Recording[] {
  if (!existsSync(capturesDir)) return [];
  return readdirSync(capturesDir)
    .filter((file) => file.endsWith('.json.gz'))
    .sort()
    .map((file) => JSON.parse(gunzipSync(readFileSync(join(capturesDir, file))).toString('utf8')) as Recording);
}
