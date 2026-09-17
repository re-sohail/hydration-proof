import type { Issue } from '../../src/report/model.ts';
import type { PageJob } from '../../src/engine/run.ts';
import { CASES, caseId, DEFAULT_CONTEXT, type FixtureCase } from '../../../../fixtures/cases.ts';
import type { RunningFixture } from '../../../../scripts/lib/fixtures.ts';

export { CASES, caseId };

export function jobFor(entry: FixtureCase, fixture: RunningFixture): PageJob {
  const base = entry.via === 'cdn-proxy' ? fixture.proxyUrl : fixture.url;
  return {
    id: caseId(entry),
    url: base + entry.route,
    route: { url: base + entry.route, pattern: entry.route },
    scenario: {
      name: entry.via === 'cdn-proxy' ? 'cdn' : 'default',
      context: {
        locale: entry.context?.locale ?? DEFAULT_CONTEXT.locale,
        timezoneId: entry.context?.timezoneId ?? DEFAULT_CONTEXT.timezoneId,
        colorScheme: entry.context?.colorScheme ?? DEFAULT_CONTEXT.colorScheme,
        ...(entry.context?.viewport ? { viewport: entry.context.viewport } : {}),
      },
      ...(entry.storage ? { localStorage: entry.storage } : {}),
      ...(entry.initScripts ? { initScripts: entry.initScripts } : {}),
    },
  };
}

export interface Verdict {
  ok: boolean;
  detail: string;
}

function matchesSelector(issue: Issue, selector: string): boolean {
  if (issue.selector === undefined) return false;
  return issue.selector === selector || issue.selector.startsWith(`${selector} `);
}

export function judge(entry: FixtureCase, issues: Issue[]): Verdict {
  const active = issues.filter((issue) => !issue.ignored);
  const summary = active.map((issue) => `${issue.code}${issue.selector ? `@${issue.selector}` : ''}`).join(', ') || 'none';
  if (entry.kind === 'control') {
    const bad = active.filter((issue) => issue.severity !== 'info');
    return { ok: bad.length === 0, detail: bad.length === 0 ? `clean (${summary})` : `false positive: ${summary}` };
  }
  const expect = entry.expect!;
  const hit = active.find(
    (issue) =>
      issue.severity !== 'info' &&
      expect.anyOfCodes.includes(issue.code) &&
      (expect.selector === undefined || matchesSelector(issue, expect.selector)),
  );
  return { ok: hit !== undefined, detail: hit ? `found ${hit.code}@${hit.selector ?? '-'} (${summary})` : `missed; got ${summary}` };
}
