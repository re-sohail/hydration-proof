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

export interface JudgeOptions {
  /** Also require the expected cause. */
  cause?: boolean;
  /** Also require the expected source file and line. */
  source?: boolean;
  /** Reads a source file for line checks. */
  readLine?: (file: string, line: number) => string | undefined;
}

export function judge(entry: FixtureCase, issues: Issue[], options: JudgeOptions = {}): Verdict {
  const active = issues.filter((issue) => !issue.ignored);
  const summary = active.map((issue) => `${issue.code}${issue.selector ? `@${issue.selector}` : ''}`).join(', ') || 'none';
  if (entry.kind === 'control') {
    const bad = active.filter((issue) => issue.severity !== 'info');
    return {
      ok: bad.length === 0,
      detail: bad.length === 0 ? `clean (${summary})` : `false positive: ${summary} — ${bad.map((issue) => issue.message).join(' | ')}`,
    };
  }
  const expect = entry.expect!;
  const hit = active.find(
    (issue) =>
      issue.severity !== 'info' &&
      expect.anyOfCodes.includes(issue.code) &&
      (expect.selector === undefined || matchesSelector(issue, expect.selector)),
  );
  if (!hit) return { ok: false, detail: `missed; got ${summary}` };
  const parts = [`found ${hit.code}@${hit.selector ?? '-'}`];
  if (options.cause && expect.cause) {
    // Some causes are only visible in the code, not in the values. Those are
    // required exactly when the file that computes the value was resolved: a
    // production build without usable component source cannot know them, and
    // saying so is more honest than guessing.
    const needsSource = expect.causeNeedsSource === true && expect.source !== undefined;
    const resolvedTheRightFile = hit.source?.file.endsWith(expect.source?.file ?? '\u0000') === true;
    if (!needsSource || resolvedTheRightFile) {
      if (!hit.cause || !expect.cause.includes(hit.cause.id)) {
        return { ok: false, detail: `wrong cause ${hit.cause?.id ?? 'none'} (expected ${expect.cause.join('/')})` };
      }
      parts.push(`cause ${hit.cause.id} ${Math.round(hit.cause.confidence * 100)}%`);
    } else {
      parts.push(`cause only in the code (${hit.sourceUnavailableReason ?? hit.source?.file ?? 'no source'})`);
    }
  }
  if (options.source && expect.source) {
    const source = hit.source;
    if (!source || !source.file.endsWith(expect.source.file)) {
      return { ok: false, detail: `wrong source ${source ? `${source.file}:${source.line}` : `none (${hit.sourceUnavailableReason})`}` };
    }
    const line = options.readLine?.(source.file, source.line) ?? '';
    if (!line.includes(expect.source.contains)) {
      return { ok: false, detail: `source ${source.file}:${source.line} is "${line.trim()}", expected it to contain ${expect.source.contains}` };
    }
    parts.push(`${source.file}:${source.line}`);
  }
  return { ok: true, detail: `${parts.join(', ')} (${summary})` };
}
