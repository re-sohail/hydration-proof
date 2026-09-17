// JUnit XML: one test suite per scenario (and build mode), one test case per
// page. The result mirrors the page status, whatever --fail-on says: failed
// pages are failures, pages that could not be tested are errors, pages with
// only warnings pass (their warnings are in <system-out>).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Issue, PageResult, Report } from '../model.ts';
import {
  byImportance,
  causeText,
  hasValues,
  issuesOfPage,
  locationText,
  outputDirOf,
  pagePath,
  percent,
  plural,
  quoteValue,
  reportPages,
  seconds,
  truncate,
  validDate,
} from './ci-shared.ts';
import type { Reporter } from './types.ts';

const VALUE_LIMIT = 500;
const MESSAGE_LIMIT = 300;

// Characters XML 1.0 does not allow (C0 controls other than tab, newline and
// carriage return; U+FFFE/U+FFFF; lone surrogates), plus the C1 controls and
// DEL, which are legal but break many CI parsers.
const INVALID_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\ufffe\uffff]|\p{Cs}/gu;

export function stripInvalidXml(text: string): string {
  return text.replace(INVALID_XML, '');
}

export function xmlText(value: unknown): string {
  return stripInvalidXml(String(value ?? ''))
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;');
}

export function xmlAttr(value: unknown): string {
  return xmlText(value).replace(/"/g, '&quot;').replace(/'/g, '&apos;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;');
}

function attrs(values: Record<string, string | number | undefined>): string {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ` ${key}="${xmlAttr(value)}"`)
    .join('');
}

function issueText(issue: Issue): string {
  const lines = [`${issue.code} ${issue.title ?? ''} [${issue.severity}, ${percent(issue.confidence)}% confidence]`.trim()];
  if (issue.selector) lines.push(`  Element: ${truncate(issue.selector, VALUE_LIMIT)}${issue.attribute ? ` (attribute ${issue.attribute})` : ''}`);
  if (hasValues(issue)) {
    lines.push(`  Server: ${quoteValue(issue.server, VALUE_LIMIT)}`, `  Client: ${quoteValue(issue.client, VALUE_LIMIT)}`);
  } else if (issue.message) {
    lines.push(`  ${truncate(issue.message, 2 * VALUE_LIMIT).replace(/\s*\n\s*/g, ' ')}`);
  }
  if (issue.component) lines.push(`  Component: ${issue.component}`);
  const cause = causeText(issue);
  if (cause) lines.push(`  Likely cause: ${cause}`);
  const location = locationText(issue);
  if (location) lines.push(`  Source: ${location}`);
  else if (issue.sourceUnavailableReason) lines.push(`  Source: not found (${issue.sourceUnavailableReason})`);
  if (issue.suggestions?.[0]) lines.push(`  Fix: ${issue.suggestions[0]}`);
  if (issue.docsUrl) lines.push(`  Docs: ${issue.docsUrl}`);
  if (issue.ignored) lines.push(`  Ignored: ${issue.ignored.reason ?? ''}${issue.ignored.rule ? ` (${issue.ignored.rule})` : ''}`);
  return lines.join('\n');
}

function pageInfo(page: PageResult): string {
  const lines = [`URL: ${page.url ?? ''}`];
  if (page.finalUrl && page.finalUrl !== page.url) lines.push(`Final URL: ${page.finalUrl}`);
  const outcome = [page.outcome, page.http?.status !== undefined ? `HTTP ${page.http.status}` : ''].filter(Boolean).join(', ');
  if (outcome) lines.push(`Outcome: ${outcome}`);
  if (page.react?.version) lines.push(`React: ${page.react.version} (${page.react.build ?? 'unknown'} build)`);
  return lines.join('\n');
}

function section(title: string, issues: Issue[]): string {
  return issues.length > 0 ? `${title}:\n\n${issues.map(issueText).join('\n\n')}` : '';
}

function testCase(page: PageResult, issues: Issue[], classname: string, name: string, compare: (a: Issue, b: Issue) => number): string {
  const sorted = [...issues].sort(compare);
  const active = sorted.filter((issue) => !issue.ignored);
  const errors = active.filter((issue) => issue.severity === 'error');
  const others = active.filter((issue) => issue.severity !== 'error');
  const ignored = sorted.filter((issue) => issue.ignored);
  const errorCount = Math.max(errors.length, Number(page.counts?.error) || 0);
  const summaryOf = (list: Issue[]): string =>
    truncate(list.slice(0, 3).map((issue) => `${issue.code} ${issue.title ?? ''}`.trim()).join('; ') + (list.length > 3 ? '; …' : ''), MESSAGE_LIMIT);

  const body: string[] = [];
  let out: string[];
  if (page.status === 'failed') {
    const message = `${plural(errorCount, 'hydration error')}${errors.length > 0 ? `: ${summaryOf(errors)}` : ''}`;
    const text = section('Errors', errors) || `The page has ${plural(errorCount, 'error')}.`;
    body.push(`      <failure${attrs({ message, type: errors[0]?.code ?? 'hydration-error' })}>${xmlText(text)}</failure>`);
    out = [pageInfo(page), section('Other issues', others)];
  } else if (page.status === 'error') {
    const first = active[0];
    const message = truncate(`${page.outcome ?? 'error'}${first ? `: ${first.message ?? first.title ?? first.code}` : ''}`, MESSAGE_LIMIT);
    body.push(`      <error${attrs({ message, type: page.outcome || 'error' })}>${xmlText([pageInfo(page), section('Issues', active)].filter(Boolean).join('\n\n'))}</error>`);
    out = [];
  } else {
    out = active.length > 0 || ignored.length > 0 ? [pageInfo(page), section(page.status === 'warning' ? 'Warnings' : 'Issues', others)] : [];
  }
  const ignoredText = section('Ignored issues', ignored);
  if (ignoredText) out.push(ignoredText);
  const stdout = out.filter(Boolean).join('\n\n');
  if (stdout) body.push(`      <system-out>${xmlText(stdout)}</system-out>`);
  const logs = Array.isArray(page.serverLogs) ? page.serverLogs : [];
  if (logs.length > 0) body.push(`      <system-err>${xmlText(`Server log:\n${logs.join('\n')}`)}</system-err>`);

  const open = `    <testcase${attrs({ classname, name, time: seconds(page.timings?.total) })}`;
  return body.length > 0 ? `${open}>\n${body.join('\n')}\n    </testcase>` : `${open}/>`;
}

interface Suite {
  scenario: string;
  mode: string | undefined;
  pages: PageResult[];
}

/** XML timestamp without a time zone (UTC), as the JUnit schema expects. */
function timestamp(value: unknown): string | undefined {
  return validDate(value)?.toISOString().slice(0, 19);
}

export function renderJunit(report: Report): string {
  const pages = reportPages(report);
  const suites = new Map<string, Suite>();
  for (const page of pages) {
    const scenario = String(page.scenario ?? 'default');
    const key = `${scenario}\u0000${page.mode ?? ''}`;
    let suite = suites.get(key);
    if (!suite) {
      suite = { scenario, mode: page.mode, pages: [] };
      suites.set(key, suite);
    }
    suite.pages.push(page);
  }
  const issuesOf = issuesOfPage(report);
  const compare = byImportance(report);
  const started = timestamp(report?.run?.startedAt);
  const seen = new Set<string>();
  const count = (list: PageResult[], status: string): number => list.filter((page) => page.status === status).length;

  const blocks: string[] = [];
  for (const suite of suites.values()) {
    const classname = `hydration-proof.${suite.scenario}${suite.mode ? `.${suite.mode}` : ''}`;
    const cases = suite.pages.map((page) => {
      // classname + name must be unique in the file (CI systems merge duplicates).
      const path = pagePath(page);
      let name = path;
      for (let n = 2; seen.has(JSON.stringify([classname, name])); n++) name = `${path} (${n})`;
      seen.add(JSON.stringify([classname, name]));
      return testCase(page, issuesOf(page), classname, name, compare);
    });
    const time = suite.pages.reduce((sum, page) => sum + (Number(page.timings?.total) || 0), 0);
    const properties = [
      `      <property${attrs({ name: 'scenario', value: suite.scenario })}/>`,
      ...(suite.mode ? [`      <property${attrs({ name: 'mode', value: suite.mode })}/>`] : []),
    ];
    blocks.push(
      `  <testsuite${attrs({
        name: suite.mode ? `${suite.scenario} (${suite.mode})` : suite.scenario,
        tests: suite.pages.length,
        failures: count(suite.pages, 'failed'),
        errors: count(suite.pages, 'error'),
        skipped: 0,
        time: seconds(time),
        timestamp: started,
      })}>\n    <properties>\n${properties.join('\n')}\n    </properties>\n${cases.join('\n')}\n  </testsuite>`,
    );
  }

  const totalTime = typeof report?.run?.durationMs === 'number'
    ? report.run.durationMs
    : pages.reduce((sum, page) => sum + (Number(page.timings?.total) || 0), 0);
  const root = `<testsuites${attrs({
    name: 'hydration-proof',
    tests: pages.length,
    failures: count(pages, 'failed'),
    errors: count(pages, 'error'),
    skipped: 0,
    time: seconds(totalTime),
    timestamp: started,
  })}`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n${blocks.length > 0 ? `${root}>\n${blocks.join('\n')}\n</testsuites>` : `${root}/>`}\n`;
}

export function junitReporter(fileName = 'junit.xml'): Reporter {
  return {
    name: 'junit',
    onEnd(report, context) {
      const dir = outputDirOf(context.config);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, fileName);
      writeFileSync(file, renderJunit(report));
      return [file];
    },
  };
}
