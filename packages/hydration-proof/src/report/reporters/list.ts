import { relative } from 'node:path';
import type { Issue, PageResult } from '../model.ts';
import { formatDuration, palette, symbols, type Palette } from '../../cli/style.ts';
import { describeSplit } from '../../matrix/classify.ts';
import type { Reporter } from './types.ts';

const MAX_ISSUES_PER_PAGE = 3;
const MAX_END_LINES = 10;

function causeText(issue: Issue): string {
  if (!issue.cause) return '';
  const certainty = issue.cause.proven ? 'proven' : `${Math.round(issue.cause.confidence * 100)}%`;
  return `${issue.cause.title.toLowerCase()}, ${certainty}`;
}

function pageLabel(page: PageResult, multipleScenarios: boolean): string {
  const path = new URL(page.url).pathname + new URL(page.url).search;
  const tags = [multipleScenarios ? page.scenario : '', page.mode ?? ''].filter(Boolean);
  return tags.length > 0 ? `${path} [${tags.join(', ')}]` : path;
}

function quote(value: string | null | undefined): string {
  if (value === null || value === undefined) return '(absent)';
  const flat = value.replace(/\s+/g, ' ');
  return JSON.stringify(flat.length > 100 ? `${flat.slice(0, 99)}…` : flat);
}

/** Terminal lines for one finding. */
export function issueLines(issue: Issue, c: Palette): string[] {
  const color = issue.severity === 'error' ? c.red : issue.severity === 'warning' ? c.yellow : c.cyan;
  const cause = issue.cause ? c.gray(`  (${causeText(issue)})`) : '';
  const flaky = issue.flaky && issue.occurrences ? c.yellow(`  flaky ${issue.occurrences.seen}/${issue.occurrences.runs}`) : '';
  const status = issue.new ? c.red('  new') : issue.baseline ? c.gray('  in baseline') : '';
  const lines = [`    ${color(issue.code)} ${issue.title}${cause}${flaky}${status}`];
  const where = [issue.selector, issue.component ? `in ${issue.component}` : undefined].filter(Boolean).join('  ');
  if (where) lines.push(`      ${c.gray(where)}`);
  if (issue.server !== undefined || issue.client !== undefined) {
    if (issue.attribute) lines.push(`      ${c.gray('attribute:')} ${issue.attribute}`);
    lines.push(`      ${c.gray('server:')} ${quote(issue.server)}`);
    lines.push(`      ${c.gray('client:')} ${quote(issue.client)}`);
  } else {
    lines.push(`      ${issue.message}`);
  }
  if (issue.source) lines.push(`      ${c.cyan(`${issue.source.file}:${issue.source.line}${issue.source.column ? `:${issue.source.column}` : ''}`)}`);
  if (issue.owners?.length) lines.push(`      ${c.gray(`owners: ${issue.owners.join(', ')}`)}`);
  if (issue.suggestions[0]) lines.push(`      ${c.gray(`→ ${issue.suggestions[0]}`)}`);
  return lines;
}

export function listReporter(stream: NodeJS.WriteStream = process.stdout): Reporter {
  const c = palette(stream);
  let multipleScenarios = false;
  const started = Date.now();
  return {
    name: 'list',
    onBegin(context) {
      multipleScenarios = context.config.scenarios.length > 1;
      context.write(`\n${c.bold('Hydration Proof')} ${c.gray(`— ${context.totalPages} page${context.totalPages === 1 ? '' : 's'} on ${context.baseUrl}`)}\n\n`);
    },
    onPage(page, issues, context) {
      const active = issues.filter((issue) => !issue.ignored);
      const icon =
        page.status === 'passed' ? c.green(symbols.pass) : page.status === 'warning' ? c.yellow(symbols.warn) : c.red(symbols.fail);
      const counts: string[] = [];
      if (page.counts.error) counts.push(c.red(`${page.counts.error} error${page.counts.error === 1 ? '' : 's'}`));
      if (page.counts.warning) counts.push(c.yellow(`${page.counts.warning} warning${page.counts.warning === 1 ? '' : 's'}`));
      if (page.status === 'error') counts.push(c.red(page.outcome));
      if (page.flakiness) counts.push(c.yellow(`flaky ${Math.round(page.flakiness * 100)}%`));
      context.write(`  ${icon} ${pageLabel(page, multipleScenarios)} ${c.gray(formatDuration(page.timings.total))}${counts.length ? `  ${counts.join(', ')}` : ''}\n`);
      if (page.status === 'failed' || page.status === 'error' || page.status === 'warning') {
        const shown = active.filter((issue) => issue.severity !== 'info');
        for (const issue of shown.slice(0, MAX_ISSUES_PER_PAGE)) context.write(`${issueLines(issue, c).join('\n')}\n`);
        if (shown.length > MAX_ISSUES_PER_PAGE) {
          context.write(`    ${c.gray(`… and ${shown.length - MAX_ISSUES_PER_PAGE} more`)}\n`);
        }
      }
    },
    onEnd(report, context) {
      const s = report.summary;
      const rows: [string, string][] = [
        ['Pages tested', String(s.pages)],
        ['Passed', c.green(String(s.passed))],
        ['Warnings', s.warnings ? c.yellow(String(s.warnings)) : '0'],
        ['Failed', s.failed + s.errored ? c.red(String(s.failed + s.errored)) : '0'],
      ];
      if (s.ignored) rows.push(['Ignored issues', c.gray(String(s.ignored))]);
      if (s.flaky) rows.push(['Flaky findings', c.yellow(String(s.flaky))]);
      if (s.new !== undefined) {
        rows.push(['New findings', s.new ? c.red(String(s.new)) : c.green('0')]);
        rows.push(['In the baseline', c.gray(String(s.known ?? 0))]);
      }
      rows.push(['Duration', formatDuration(report.run.durationMs || Date.now() - started)]);
      const unique = (issues: Issue[]): Issue[] => {
        const seen = new Set<string>();
        return issues.filter((issue) => !seen.has(issue.fingerprint) && seen.add(issue.fingerprint));
      };
      const active = report.issues.filter((issue) => !issue.ignored);
      const split = unique(active.filter((issue) => issue.onlyIn?.length));
      if (split.length > 0) {
        context.write(`\n  ${c.bold('Only in some environments')}\n`);
        for (const issue of split.slice(0, MAX_END_LINES)) {
          context.write(`    ${issue.code} ${issue.route.pattern} ${c.gray(issue.selector ?? '')}  ${describeSplit(issue.onlyIn!)}\n`);
        }
        if (split.length > MAX_END_LINES) context.write(`    ${c.gray(`… and ${split.length - MAX_END_LINES} more`)}\n`);
      }
      // Interaction and navigation checks run after the pages were listed.
      const late = active.filter((issue) => issue.code.startsWith('HP5'));
      if (late.length > 0) {
        context.write(`\n  ${c.bold('Interaction and navigation checks')}\n`);
        for (const issue of late.slice(0, MAX_END_LINES)) {
          const page = pageLabel({ url: issue.route.url, scenario: issue.scenario, ...(issue.mode ? { mode: issue.mode } : {}) } as PageResult, multipleScenarios);
          context.write(`${issueLines(issue, c).join('\n').replace(/^ {4}/, `    ${page}  `)}\n`);
        }
        if (late.length > MAX_END_LINES) context.write(`    ${c.gray(`… and ${late.length - MAX_END_LINES} more`)}\n`);
      }
      const probed = active.filter((issue) => issue.probes?.length);
      if (probed.length > 0) {
        context.write(`\n  ${c.bold('Probes')}\n`);
        for (const issue of probed.slice(0, MAX_END_LINES)) {
          const verdict = issue.cause?.proven ? c.green(`proven: ${issue.cause.title.toLowerCase()}`) : c.gray(issue.cause ? `not proven (${causeText(issue)})` : 'no cause found');
          context.write(`    ${issue.code} ${pageLabel({ url: issue.route.url, scenario: issue.scenario, ...(issue.mode ? { mode: issue.mode } : {}) } as PageResult, multipleScenarios)} ${c.gray(issue.selector ?? '')}  ${verdict}\n`);
        }
        if (probed.length > MAX_END_LINES) context.write(`    ${c.gray(`… and ${probed.length - MAX_END_LINES} more`)}\n`);
      }
      const width = Math.max(...rows.map(([label]) => label.length)) + 1;
      context.write(`\n${rows.map(([label, value]) => `  ${`${label}:`.padEnd(width + 1)} ${value}`).join('\n')}\n`);
      for (const failure of context.failures) context.write(`\n  ${c.red(symbols.error)} ${failure}\n`);
      if (context.exitCode === 0) {
        context.write(`\n  ${c.green(s.new !== undefined && s.known ? 'No new hydration problems found.' : 'No hydration problems found.')}\n`);
      }
      const redacted = Object.values(s.redacted ?? {}).reduce((total, count) => total + count, 0);
      if (redacted > 0) context.write(`  ${c.gray(`${redacted} value${redacted === 1 ? '' : 's'} (emails, tokens, ...) were removed from the report.`)}\n`);
      const reportFile = report.run.cwd ? relative(report.run.cwd, context.config.outputDir) || '.' : context.config.outputDir;
      const html = context.config.reporters.includes('html') ? `${reportFile}/report.html` : undefined;
      if (html) context.write(`  ${c.gray('Report:')} ${html}\n`);
      else if (context.config.reporters.some((name) => name !== 'list')) context.write(`  ${c.gray(`Reports: ${reportFile}`)}\n`);
      context.write('\n');
    },
  };
}
