import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { summarize } from '../run/results.ts';
import { REPORT_SCHEMA_VERSION, type Issue, type PageResult, type Report } from './model.ts';

// Combine the reports of CI shards (or monorepo projects) into one.

export class MergeError extends Error {
  override name = 'MergeError';
}

export interface MergeInput {
  report: Report;
  /** Folder the report was read from (for screenshots). */
  dir?: string;
  /** Shard or project label. */
  label: string;
  /** Monorepo project name to put on pages and findings. */
  project?: string;
}

/** Read `report.json` from a folder or a file path. */
export function readReport(path: string): MergeInput {
  const absolute = resolve(path);
  const file = existsSync(absolute) && statSync(absolute).isDirectory() ? join(absolute, 'report.json') : absolute;
  if (!existsSync(file)) throw new MergeError(`No report found at ${path} (expected a report.json or a folder with one).`);
  let report: Report;
  try {
    report = JSON.parse(readFileSync(file, 'utf8')) as Report;
  } catch (error) {
    throw new MergeError(`${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (report.schemaVersion !== REPORT_SCHEMA_VERSION || !Array.isArray(report.pages) || !Array.isArray(report.issues)) {
    throw new MergeError(`${file} is not a hydration-proof report with schemaVersion ${REPORT_SCHEMA_VERSION}.`);
  }
  return { report, dir: dirname(file), label: basename(dirname(file)) };
}

function safeName(name: string): string {
  return name.replace(/[^a-z0-9._-]+/gi, '-');
}

const issueKey = (issue: Issue): string => `${issue.project ?? ''}|${issue.fingerprint}|${issue.route.url}|${issue.scenario}|${issue.mode ?? ''}`;
const pageKey = (page: PageResult): string => `${page.project ?? ''}|${page.id}|${page.mode ?? ''}`;

export function mergeReports(inputs: readonly MergeInput[]): Report {
  if (inputs.length === 0) throw new MergeError('Nothing to merge.');
  const pages = new Map<string, PageResult>();
  const issues = new Map<string, Issue>();
  for (const { report, project } of inputs) {
    for (const page of report.pages) {
      const tagged: PageResult = project ? { ...page, project } : page;
      if (project && page.screenshots) {
        const moved = (path: string | undefined): string | undefined => path?.replace(/^screenshots\//, `screenshots/${safeName(project)}/`);
        tagged.screenshots = { ...page.screenshots };
        const hydrated = moved(page.screenshots.hydrated);
        const server = moved(page.screenshots.server);
        if (hydrated) tagged.screenshots.hydrated = hydrated;
        if (server) tagged.screenshots.server = server;
      }
      if (!pages.has(pageKey(tagged))) pages.set(pageKey(tagged), tagged);
    }
    for (const issue of report.issues) {
      const tagged = project ? { ...issue, project } : issue;
      if (!issues.has(issueKey(tagged))) issues.set(issueKey(tagged), tagged);
    }
  }
  const runs = inputs.map((input) => input.report.run);
  const started = Math.min(...runs.map((run) => Date.parse(run.startedAt)));
  const finished = Math.max(...runs.map((run) => Date.parse(run.finishedAt)));
  const first = inputs[0]!.report;
  const pageList = [...pages.values()];
  const issueList = [...issues.values()];
  const baseUrls = [...new Set(runs.flatMap((run) => (run.baseUrl ? run.baseUrl.split(', ') : [])))];
  const merged: Report = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    tool: first.tool,
    run: {
      ...first.run,
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date(finished).toISOString(),
      durationMs: finished - started,
      browsers: [...new Set(runs.flatMap((run) => run.browsers))],
      mode: [...new Set(runs.map((run) => run.mode))].join(', '),
      shards: inputs.map((input) => input.label),
      ...(baseUrls.length > 0 ? { baseUrl: baseUrls.join(', ') } : {}),
    },
    summary: summarize(pageList, issueList),
    pages: pageList,
    issues: issueList,
  };
  const redacted: Record<string, number> = {};
  for (const { report } of inputs) {
    for (const [kind, count] of Object.entries(report.summary.redacted ?? {})) redacted[kind] = (redacted[kind] ?? 0) + count;
  }
  if (Object.keys(redacted).length > 0) merged.summary.redacted = redacted;
  const history = inputs.find((input) => input.report.history)?.report.history;
  if (history) merged.history = history;
  return merged;
}

/** Copy the screenshots of the merged reports next to the merged report. */
export function copyScreenshots(inputs: readonly MergeInput[], outputDir: string): number {
  let copied = 0;
  for (const input of inputs) {
    if (!input.dir) continue;
    const from = join(input.dir, 'screenshots');
    if (!existsSync(from) || resolve(from) === resolve(outputDir, 'screenshots')) continue;
    const to = input.project ? join(outputDir, 'screenshots', safeName(input.project)) : join(outputDir, 'screenshots');
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      copyFileSync(join(from, entry.name), join(to, entry.name));
      copied++;
    }
  }
  return copied;
}
