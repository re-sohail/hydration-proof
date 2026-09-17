// GitHub Actions: workflow-command annotations on stdout and a Markdown job
// summary appended to $GITHUB_STEP_SUMMARY.

import { appendFileSync, statSync } from 'node:fs';
import { relative, sep } from 'node:path';
import type { ResolvedConfig } from '../../config/resolve.ts';
import type { Issue, PageResult, Report } from '../model.ts';
import {
  activeIssues,
  byImportance,
  causeText,
  groupIssues,
  hasValues,
  listText,
  locationText,
  outputDirOf,
  pagePath,
  percent,
  plural,
  positiveInt,
  quoteValue,
  relativeToBase,
  reporterNames,
  reportPages,
  rootDirOf,
  scopeText,
  showHidden,
  truncate,
  type IssueGroup,
} from './ci-shared.ts';
import type { Reporter } from './types.ts';

/** GitHub shows at most this many annotations of each level per step. */
export const ANNOTATIONS_PER_LEVEL = 10;
/** GitHub rejects step summaries larger than 1 MiB. */
export const STEP_SUMMARY_LIMIT: number = 1024 * 1024;

const VALUE_LIMIT = 200;
const SUMMARY_VALUE_LIMIT = 2000;
const SUMMARY_PAGE_ROWS = 100;
const SUMMARY_MARGIN = 1024;

export function detectGithubActions(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['GITHUB_ACTIONS'] === 'true';
}

// ---------------------------------------------------------------------------
// Workflow commands (same escaping as @actions/core)

function commandValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export function escapeData(value: unknown): string {
  return commandValue(value).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
}

export function escapeProperty(value: unknown): string {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C');
}

export type AnnotationLevel = 'error' | 'warning' | 'notice';

export interface AnnotationProperties {
  file?: string;
  line?: number;
  col?: number;
  title?: string;
}

/** `::level file=…,line=…::message`, one line whatever the input. */
export function workflowCommand(command: string, properties: AnnotationProperties, message: string): string {
  const pairs = Object.entries(properties)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}=${escapeProperty(value)}`);
  return `::${command}${pairs.length > 0 ? ` ${pairs.join(',')}` : ''}::${escapeData(message)}`;
}

function levelOf(issue: Issue): AnnotationLevel {
  return issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'notice';
}

interface Paths {
  rootDir: string;
  /** Directory annotation and summary paths are relative to. */
  base: string;
}

function pathsFor(config: ResolvedConfig | undefined, env: NodeJS.ProcessEnv): Paths {
  const rootDir = rootDirOf(config);
  const workspace = env['GITHUB_WORKSPACE'];
  return { rootDir, base: workspace ? workspace : rootDir };
}

function annotationMessage(group: IssueGroup, file: string | undefined): string {
  const { issue } = group;
  const scope = scopeText(group);
  const lines = [`Page: ${listText(group.paths, 3)}${scope ? ` (${scope})` : ''}`];
  if (issue.selector) lines.push(`Element: ${truncate(issue.selector, VALUE_LIMIT)}${issue.attribute ? ` [${issue.attribute}]` : ''}`);
  if (hasValues(issue)) {
    lines.push(`Server: ${quoteValue(issue.server, VALUE_LIMIT)}`, `Client: ${quoteValue(issue.client, VALUE_LIMIT)}`);
  } else if (issue.message) {
    lines.push(truncate(issue.message, 2 * VALUE_LIMIT));
  }
  const cause = causeText(issue);
  if (cause) lines.push(`Likely cause: ${cause}`);
  const location = locationText(issue);
  if (location && !file) lines.push(`Source: ${location}`);
  else if (!location && issue.sourceUnavailableReason) lines.push(`No source location: ${issue.sourceUnavailableReason}`);
  if (issue.suggestions?.[0]) lines.push(`Fix: ${issue.suggestions[0]}`);
  if (issue.docsUrl) lines.push(`Docs: ${issue.docsUrl}`);
  return lines.join('\n');
}

function annotation(group: IssueGroup, paths: Paths): string {
  const { issue } = group;
  const file = relativeToBase(issue.source?.file, paths.rootDir, paths.base);
  const properties: AnnotationProperties = {};
  if (file) {
    properties.file = file;
    const line = positiveInt(issue.source?.line);
    if (line) {
      properties.line = line;
      const col = positiveInt(issue.source?.column);
      if (col) properties.col = col;
    }
  }
  properties.title = `${issue.code} ${issue.title ?? ''}`.trim();
  return workflowCommand(levelOf(issue), properties, annotationMessage(group, file));
}

/** The annotation commands for a report: the most important first, within GitHub's per-level limits. */
export function githubAnnotations(report: Report, config: ResolvedConfig | undefined, env: NodeJS.ProcessEnv = process.env): string[] {
  const paths = pathsFor(config, env);
  const groups = groupIssues(activeIssues(report), byImportance(report));
  const byLevel: Record<AnnotationLevel, IssueGroup[]> = { error: [], warning: [], notice: [] };
  for (const group of groups) byLevel[levelOf(group.issue)].push(group);
  const overflows = Object.values(byLevel).some((list) => list.length > ANNOTATIONS_PER_LEVEL);
  // The overflow note is a notice too, so it takes the last notice slot.
  const limits: Record<AnnotationLevel, number> = {
    error: ANNOTATIONS_PER_LEVEL,
    warning: ANNOTATIONS_PER_LEVEL,
    notice: overflows ? ANNOTATIONS_PER_LEVEL - 1 : ANNOTATIONS_PER_LEVEL,
  };
  const lines: string[] = [];
  const hidden: Record<AnnotationLevel, number> = { error: 0, warning: 0, notice: 0 };
  for (const level of ['error', 'warning', 'notice'] as const) {
    const list = byLevel[level];
    for (const group of list.slice(0, limits[level])) lines.push(annotation(group, paths));
    hidden[level] = Math.max(0, list.length - limits[level]);
  }
  const total = hidden.error + hidden.warning + hidden.notice;
  if (total > 0) {
    const parts = [
      hidden.error ? plural(hidden.error, 'error') : '',
      hidden.warning ? plural(hidden.warning, 'warning') : '',
      hidden.notice ? plural(hidden.notice, 'notice') : '',
    ].filter(Boolean);
    const where = relativeToBase(outputDirOf(config), paths.rootDir, paths.base) ?? 'the report directory';
    lines.push(
      workflowCommand(
        'notice',
        { title: 'hydration-proof: more issues' },
        `${plural(total, 'more issue')} (${parts.join(', ')}) than GitHub shows as annotations. See the job summary and the report in ${where}.`,
      ),
    );
  }
  return lines;
}

// ---------------------------------------------------------------------------
// Job summary (GitHub-flavoured Markdown)

function flat(text: unknown): string {
  return showHidden(commandValue(text).replace(/\s+/g, ' ').trim());
}

/** Text that cannot open or close an HTML tag or entity. */
function htmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Plain text that renders literally in Markdown, including inside a table cell. */
export function mdText(text: unknown): string {
  return htmlText(flat(text)).replace(/[\\`*_{}[\]()#+!|~]/g, '\\$&');
}

function longestRun(text: string, char: string): number {
  let longest = 0;
  let current = 0;
  for (const c of text) {
    current = c === char ? current + 1 : 0;
    if (current > longest) longest = current;
  }
  return longest;
}

/** An inline code span that survives backticks and table pipes. */
export function mdCode(text: unknown): string {
  const value = flat(text);
  if (value === '') return '';
  const fence = '`'.repeat(longestRun(value, '`') + 1);
  const padded = value.startsWith('`') || value.endsWith('`') ? ` ${value} ` : value;
  return `${fence}${padded.replace(/\|/g, '\\|')}${fence}`;
}

/** A fenced code block whose fence no line of the content can close. */
export function mdCodeBlock(text: string, language = 'text'): string {
  const value = showHidden(text);
  const fence = '`'.repeat(Math.max(3, longestRun(value, '`') + 1));
  return `${fence}${language}\n${value}\n${fence}`;
}

function safeUrl(url: unknown): string | undefined {
  return typeof url === 'string' && /^https?:\/\/[^\s<>()[\]"'`]+$/.test(url) ? url : undefined;
}

function mdLink(label: string, url: unknown): string {
  const href = safeUrl(url);
  return href ? `[${label}](${href})` : label;
}

function blobUrl(env: NodeJS.ProcessEnv, file: string, line: number | undefined): string | undefined {
  const server = env['GITHUB_SERVER_URL'];
  const repository = env['GITHUB_REPOSITORY'];
  const sha = env['GITHUB_SHA'];
  if (!server || !repository || !sha) return undefined;
  const path = file.split('/').map(encodeURIComponent).join('/');
  return safeUrl(`${server}/${repository}/blob/${sha}/${path}${line ? `#L${line}` : ''}`);
}

function runUrl(env: NodeJS.ProcessEnv): string | undefined {
  const server = env['GITHUB_SERVER_URL'];
  const repository = env['GITHUB_REPOSITORY'];
  const runId = env['GITHUB_RUN_ID'];
  if (!server || !repository || !runId) return undefined;
  return safeUrl(`${server}/${repository}/actions/runs/${runId}`);
}

const STATUS_LABEL: Record<string, string> = { failed: 'Failed', error: 'Not tested', warning: 'Warnings', passed: 'Passed' };

function durationText(ms: unknown): string {
  const value = typeof ms === 'number' && Number.isFinite(ms) ? Math.max(0, ms) : 0;
  if (value < 1000) return `${Math.round(value)}ms`;
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`;
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1000)}s`;
}

function headline(report: Report | undefined, exitCode: number): string {
  const s = report?.summary;
  const failed = (Number(s?.failed) || 0) + (Number(s?.errored) || 0);
  const warnings = Number(s?.warnings) || 0;
  if (exitCode === 0) {
    if (failed > 0) return `## ✅ Hydration Proof passed (${plural(failed, 'page')} with problems allowed by the policy)`;
    return warnings > 0
      ? `## ✅ Hydration Proof passed with ${plural(warnings, 'page')} with warnings`
      : '## ✅ Hydration Proof: no hydration problems';
  }
  return failed > 0 ? `## ❌ Hydration Proof: ${plural(failed, 'page')} failed` : '## ❌ Hydration Proof failed';
}

function totalsTable(report: Report | undefined): string {
  const s = report?.summary;
  const rows: [string, number | undefined][] = [
    ['Pages tested', s?.pages],
    ['Passed', s?.passed],
    ['Passed with warnings', s?.warnings],
    ['Failed', s?.failed],
    ['Could not be tested', s?.errored],
    ['Error issues', s?.issues?.error],
    ['Warning issues', s?.issues?.warning],
    ['Info issues', s?.issues?.info],
    ['Ignored issues', s?.ignored],
  ];
  return ['| Result | Count |', '| --- | ---: |', ...rows.map(([label, value]) => `| ${label} | ${Number(value) || 0} |`)].join('\n');
}

function pagesTable(pages: PageResult[], maxRows: number): string {
  const withModes = pages.some((page) => page.mode);
  const header = withModes
    ? ['| Status | Route | Scenario | Mode | Errors | Warnings |', '| --- | --- | --- | --- | ---: | ---: |']
    : ['| Status | Route | Scenario | Errors | Warnings |', '| --- | --- | --- | ---: | ---: |'];
  const rows = pages.slice(0, maxRows).map((page) => {
    const cells = [
      STATUS_LABEL[page.status] ?? mdText(page.status),
      mdCode(pagePath(page)),
      mdCode(page.scenario),
      ...(withModes ? [mdText(page.mode ?? '')] : []),
      String(Number(page.counts?.error) || 0),
      String(Number(page.counts?.warning) || 0),
    ];
    return `| ${cells.join(' | ')} |`;
  });
  const more = pages.length > maxRows ? `\n\n…and ${plural(pages.length - maxRows, 'more page')}.` : '';
  return `${[...header, ...rows].join('\n')}${more}`;
}

function issueDetails(group: IssueGroup, paths: Paths, env: NodeJS.ProcessEnv): string {
  const { issue } = group;
  const summary = [
    `<strong>${htmlText(flat(issue.code))}</strong> ${htmlText(flat(issue.title))}`,
    `<code>${htmlText(flat(listText(group.paths, 3)))}</code>`,
    group.scenarios.length > 0 ? htmlText(flat(listText(group.scenarios, 5))) : '',
    group.modes.length > 0 ? htmlText(flat(group.modes.join(', '))) : '',
  ].filter(Boolean);
  const facts: string[] = [];
  facts.push(`- **Severity:** ${mdText(issue.severity)} (${percent(issue.confidence)}% confidence)`);
  const pages = group.paths.slice(0, 10).map(mdCode).join(', ');
  facts.push(`- **Pages:** ${pages}${group.paths.length > 10 ? ` and ${group.paths.length - 10} more` : ''}`);
  if (group.scenarios.length > 0) facts.push(`- **Scenarios:** ${group.scenarios.slice(0, 10).map(mdCode).join(', ')}`);
  if (group.modes.length > 0) facts.push(`- **Builds:** ${group.modes.map(mdText).join(', ')}`);
  if (issue.selector) {
    facts.push(`- **Element:** ${mdCode(truncate(issue.selector, 500))}${issue.attribute ? ` attribute ${mdCode(issue.attribute)}` : ''}`);
  }
  if (issue.component) facts.push(`- **Component:** ${mdCode(issue.component)}`);
  if (issue.cause?.title) {
    facts.push(`- **Likely cause:** ${mdLink(mdText(issue.cause.title), issue.cause.docsUrl)} (${percent(issue.cause.confidence)}% confidence)`);
  }
  const location = locationText(issue);
  const file = relativeToBase(issue.source?.file, paths.rootDir, paths.base);
  if (location) {
    const line = positiveInt(issue.source?.line);
    const column = line ? positiveInt(issue.source?.column) : undefined;
    const shown = file ? `${file}${line ? `:${line}` : ''}${column ? `:${column}` : ''}` : location;
    const url = file ? blobUrl(env, file, line) : undefined;
    facts.push(`- **Source:** ${url ? `[${mdCode(shown)}](${url})` : mdCode(shown)}`);
  } else if (issue.sourceUnavailableReason) {
    facts.push(`- **Source:** not found. ${mdText(issue.sourceUnavailableReason)}`);
  }
  for (const suggestion of (issue.suggestions ?? []).slice(0, 3)) facts.push(`- **Fix:** ${mdText(suggestion)}`);
  if (issue.docsUrl) facts.push(`- **Docs:** ${mdLink(mdText(issue.code), issue.docsUrl)}`);

  const blocks: string[] = [facts.join('\n')];
  if (hasValues(issue)) {
    for (const [label, value] of [['Server', issue.server], ['Client', issue.client]] as const) {
      blocks.push(
        typeof value === 'string'
          ? `**${label}:**\n\n${mdCodeBlock(truncate(value, SUMMARY_VALUE_LIMIT))}`
          : `**${label}:** ${value === null ? '(absent)' : '(not captured)'}`,
      );
    }
  } else if (issue.message) {
    blocks.push(mdText(truncate(issue.message, SUMMARY_VALUE_LIMIT)));
  }
  if (typeof issue.source?.frame === 'string') blocks.push(mdCodeBlock(truncate(issue.source.frame, SUMMARY_VALUE_LIMIT)));
  return `<details>\n<summary>${summary.join(' · ')}</summary>\n\n${blocks.join('\n\n')}\n\n</details>`;
}

function footer(config: ResolvedConfig | undefined, paths: Paths, env: NodeJS.ProcessEnv): string {
  const output = outputDirOf(config);
  const dir = relativeToBase(output, paths.rootDir, paths.base) ?? relative(paths.base, output).split(sep).join('/');
  const names = reporterNames(config);
  const main = names.includes('html') ? `${dir}/report.html` : names.includes('json') ? `${dir}/report.json` : dir;
  const run = runUrl(env);
  const artifacts = run ? `[run artifacts](${run}#artifacts)` : 'run artifacts';
  return `---\n\nFull report: ${mdCode(main)}. Upload ${mdCode(dir)} with ${mdCode('actions/upload-artifact')} to find it in the ${artifacts}.`;
}

export interface JobSummaryOptions {
  env?: NodeJS.ProcessEnv;
  /** Maximum size in bytes (default: GitHub's 1 MiB minus a small margin). */
  limit?: number;
}

function bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

/**
 * The Markdown job summary, at most `limit` bytes: the page table and issue
 * details are shortened (with a note) when they do not fit.
 */
export function renderJobSummary(
  report: Report,
  context: { config: ResolvedConfig | undefined; exitCode: number; failures?: string[] },
  options: JobSummaryOptions = {},
): string {
  const env = options.env ?? process.env;
  const limit = options.limit ?? STEP_SUMMARY_LIMIT - SUMMARY_MARGIN;
  const paths = pathsFor(context.config, env);
  const tool = report?.tool?.version ? `hydration-proof ${flat(report.tool.version)}` : 'hydration-proof';
  const s = report?.summary;
  const browsers = Array.isArray(report?.run?.browsers) ? report.run.browsers : [];
  const details = [
    `Tested ${plural(Number(s?.pages) || 0, 'page')} (${plural(Number(s?.routes) || 0, 'route')}) in ${durationText(report?.run?.durationMs)} with ${mdText(tool)}`,
    browsers.length > 0 ? mdText(browsers.join(', ')) : '',
    report?.run?.mode === 'both' ? 'production and development builds' : report?.run?.mode ? `${mdText(report.run.mode)} build` : '',
  ].filter(Boolean);
  const head = [headline(report, context.exitCode), `${details.join(' · ')}.`];
  for (const failure of context.failures ?? []) head.push(`- ${mdText(failure)}`);

  const end = footer(context.config, paths, env);
  let text = `${head.join('\n\n')}\n\n${totalsTable(report)}\n\n`;
  if (bytes(text) + bytes(end) + 1 > limit) {
    const short = `${head[0]}\n\n_The summary was too large; see the full report._\n`;
    return bytes(short) <= limit ? short : '';
  }
  const fits = (section: string, reserve = 0): boolean => bytes(text) + bytes(section) + bytes(end) + reserve + 1 <= limit;

  const pages = reportPages(report)
    .filter((page) => page.status !== 'passed')
    .sort((a, b) => (a.status === 'warning' ? 1 : 0) - (b.status === 'warning' ? 1 : 0));
  // As many table rows as fit, up to SUMMARY_PAGE_ROWS.
  for (let rows = Math.min(pages.length, SUMMARY_PAGE_ROWS); pages.length > 0; rows = Math.floor(rows / 2)) {
    const section =
      rows > 0
        ? `### Pages with problems\n\n${pagesTable(pages, rows)}\n\n`
        : `### Pages with problems\n\n_${plural(pages.length, 'page')} with problems; see the full report._\n\n`;
    if (fits(section)) {
      text += section;
      break;
    }
    if (rows === 0) break;
  }

  const groups = groupIssues(activeIssues(report), byImportance(report));
  const note = (count: number): string =>
    `_${plural(count, 'more issue')} left out to stay within GitHub's summary size limit; see the full report._\n\n`;
  const title = '### Issues\n\n';
  const reserve = bytes(note(groups.length));
  if (groups.length > 0 && fits(title, reserve)) {
    text += title;
    let shown = 0;
    for (const group of groups) {
      const block = `${issueDetails(group, paths, env)}\n\n`;
      if (!fits(block, reserve)) break;
      text += block;
      shown++;
    }
    if (shown < groups.length) text += note(groups.length - shown);
  }
  return `${text}${end}\n`;
}

export function githubReporter(env: NodeJS.ProcessEnv = process.env): Reporter {
  return {
    name: 'github',
    onEnd(report, context) {
      const lines = githubAnnotations(report, context.config, env);
      if (lines.length > 0) context.write(`${lines.join('\n')}\n`);

      const file = env['GITHUB_STEP_SUMMARY'];
      if (!file) return;
      try {
        let existing = 0;
        try {
          existing = statSync(file).size;
        } catch {
          existing = 0;
        }
        const markdown = renderJobSummary(report, context, { env, limit: STEP_SUMMARY_LIMIT - SUMMARY_MARGIN - existing });
        if (markdown) appendFileSync(file, existing > 0 ? `\n${markdown}` : markdown);
      } catch (error) {
        context.write(`  Could not write the GitHub job summary: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    },
  };
}
