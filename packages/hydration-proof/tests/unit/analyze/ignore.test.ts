import { describe, expect, it } from 'vitest';
import { applyIgnores } from '../../../src/analyze/ignore.ts';
import type { Issue } from '../../../src/report/model.ts';

function issue(overrides: Partial<Issue>): Issue {
  return {
    fingerprint: 'f1',
    code: 'HP1001',
    title: 't',
    severity: 'error',
    confidence: 1,
    message: 'm',
    route: { url: 'http://x.test/blog/1', pattern: '/blog/[id]' },
    scenario: 'default',
    stage: 'hydration',
    evidence: [],
    suggestions: [],
    docsUrl: '',
    ...overrides,
  };
}

describe('applyIgnores', () => {
  it('ignores text differences covered by textPatterns', () => {
    const issues = [issue({ server: 'Updated 10:01:02', client: 'Updated 10:01:05' })];
    applyIgnores(issues, { textPatterns: [/\d{2}:\d{2}:\d{2}/], rules: [] });
    expect(issues[0]?.ignored?.rule).toBe('ignore.textPatterns');
  });

  it('matches rules by code, route, selector and fingerprint', () => {
    const issues = [issue({ selector: '#card > p' }), issue({ fingerprint: 'f2', code: 'HP1004' })];
    applyIgnores(issues, {
      textPatterns: [],
      rules: [
        { code: 'HP1001', route: '/blog/**', selector: '#card', reason: 'Known' },
        { fingerprint: 'f2', reason: 'Accepted' },
      ],
    });
    expect(issues.map((entry) => entry.ignored?.reason)).toEqual(['Known', 'Accepted']);
  });

  it('does not ignore with expired rules and reports them', () => {
    const issues = [issue({})];
    const expired = applyIgnores(issues, {
      textPatterns: [],
      rules: [{ code: 'HP1001', reason: 'Temporary', expires: '2020-01-01' }],
      today: new Date('2026-09-17'),
    });
    expect(issues[0]?.ignored).toBeUndefined();
    expect(expired).toHaveLength(1);
  });

  it('never matches a rule without criteria', () => {
    const issues = [issue({})];
    applyIgnores(issues, { textPatterns: [], rules: [{ reason: 'everything' }] });
    expect(issues[0]?.ignored).toBeUndefined();
  });
});

import { analyzeOutcome } from '../../../src/analyze/outcome.ts';
import type { PageCapture } from '../../../src/engine/capture.ts';

function capture(requestedUrl: string, finalUrl: string): PageCapture {
  return {
    startedAt: 0,
    requestedUrl,
    finalUrl,
    outcome: 'hydrated',
    runtime: { renderers: [], roots: [], commits: [], errors: [], batches: [], snapshots: [], dropped: {}, navigations: 0 },
    pageErrors: [],
    consoleMessages: [],
    timings: { navigation: 0, total: 0 },
  };
}

describe('redirect checks', () => {
  it('warns about unexpected redirects and accepts expected ones', () => {
    expect(analyzeOutcome(capture('http://h.test/admin', 'http://h.test/admin/'), [])).toEqual([]);
    const unexpected = analyzeOutcome(capture('http://h.test/admin', 'http://h.test/login'), []);
    expect(unexpected).toEqual([expect.objectContaining({ code: 'HP9010', severity: 'warning' })]);
    expect(analyzeOutcome(capture('http://h.test/old', 'http://h.test/new'), [], '/new')).toEqual([]);
    expect(analyzeOutcome(capture('http://h.test/old', 'http://h.test/other'), [], '/new')).toEqual([
      expect.objectContaining({ code: 'HP9010', severity: 'error' }),
    ]);
  });
});
