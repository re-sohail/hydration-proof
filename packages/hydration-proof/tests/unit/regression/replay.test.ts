import { describe, expect, it } from 'vitest';
import { nextMarkers } from '../../../src/adapters/next.ts';
import { analyzePage } from '../../../src/analyze/index.ts';
import { DEFAULT_NORMALIZE } from '../../../src/dom/normalize.ts';
import { findingsOf, readRecordings } from '../../helpers/recordings.ts';

// The regression gate. Every recording is a real browser capture of a fixture
// page, taken by `pnpm record:captures` only when the page agreed with the
// ground truth in fixtures/cases.ts. Replaying one needs no browser, so this
// runs on every pull request and on every Node and OS in the matrix:
//
//  - a control page that starts reporting something is a false positive;
//  - a broken page that stops reporting, or reports a different code or
//    element, is a lost or changed detection.
//
// When a false positive turns up in the wild: add the page to the fixtures as a
// control, fix the analysis, then record it.

const recordings = readRecordings();
const normalize = { ...DEFAULT_NORMALIZE, markers: [...DEFAULT_NORMALIZE.markers, ...nextMarkers] };

describe('recorded fixture pages analyse the same without a browser', () => {
  it('has a corpus of both kinds', () => {
    expect(recordings.length, 'No recordings. Run `pnpm fixtures:build && pnpm record:captures`.').toBeGreaterThan(0);
    expect(recordings.filter((recording) => recording.kind === 'control').length).toBeGreaterThan(0);
    expect(recordings.filter((recording) => recording.kind === 'broken').length).toBeGreaterThan(0);
  });

  it.each(recordings.map((recording) => [recording.id, recording] as const))('%s', (_id, recording) => {
    const analysis = analyzePage(recording.capture, recording.parsed, {
      route: { url: recording.capture.requestedUrl, pattern: recording.route },
      scenario: recording.via === 'cdn-proxy' ? 'cdn' : 'default',
      normalize,
    });
    const findings = findingsOf(analysis.issues);
    if (recording.kind === 'control') {
      const messages = analysis.issues.filter((issue) => !issue.ignored && issue.severity !== 'info').map((issue) => `${issue.code}: ${issue.message}`);
      expect(findings, `False positive on a correct page: ${messages.join(' | ')}`).toEqual([]);
    }
    expect(findings).toEqual(recording.findings);
    expect(analysis.status).toBe(recording.status);
    expect(recording.capture.outcome).toBe(recording.outcome);
  });
});
