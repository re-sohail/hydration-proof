import { relative } from 'node:path';
import type { Issue, PageResult } from '../model.ts';
import { formatDuration, palette, symbols, type Palette } from '../../cli/style.ts';
import type { Reporter } from './types.ts';

const MAX_ISSUES_PER_PAGE = 3;

function pageLabel(page: PageResult, multipleScenarios: boolean): string {
  const path = new URL(page.url).pathname + new URL(page.url).search;
  return multipleScenarios ? `${path} [${page.scenario}]` : path;
}

function quote(value: string | null | undefined): string {
  if (value === null || value === undefined) return '(absent)';
  const flat = value.replace(/\s+/g, ' ');
  return JSON.stringify(flat.length > 100 ? `${flat.slice(0, 99)}…` : flat);
}

function issueLines(issue: Issue, c: Palette): string[] {
  const color = issue.severity === 'error' ? c.red : issue.severity === 'warning' ? c.yellow : c.cyan;
  const lines = [`    ${color(issue.code)} ${issue.title}`];
  const where = [issue.selector, issue.component ? `in ${issue.component}` : undefined].filter(Boolean).join('  ');
  if (where) lines.push(`      ${c.gray(where)}`);
  if (issue.server !== undefined || issue.client !== undefined) {
    if (issue.attribute) lines.push(`      ${c.gray('attribute:')} ${issue.attribute}`);
    lines.push(`      ${c.gray('server:')} ${quote(issue.server)}`);
    lines.push(`      ${c.gray('client:')} ${quote(issue.client)}`);
  } else {
    lines.push(`      ${issue.message}`);
  }
  if (issue.source) lines.push(`      ${c.gray(`${issue.source.file}:${issue.source.line}`)}`);
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
      rows.push(['Duration', formatDuration(Date.now() - started)]);
      const width = Math.max(...rows.map(([label]) => label.length)) + 1;
      context.write(`\n${rows.map(([label, value]) => `  ${`${label}:`.padEnd(width + 1)} ${value}`).join('\n')}\n`);
      for (const failure of context.failures) context.write(`\n  ${c.red(symbols.error)} ${failure}\n`);
      if (context.exitCode === 0) context.write(`\n  ${c.green('No hydration problems found.')}\n`);
      const reportFile = report.run.cwd ? relative(report.run.cwd, context.config.outputDir) || '.' : context.config.outputDir;
      if (context.config.reporters.some((name) => name !== 'list')) context.write(`  ${c.gray(`Reports: ${reportFile}`)}\n`);
      context.write('\n');
    },
  };
}
