import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ExpiredRule } from '../analyze/ignore.ts';
import type { Adapter } from '../adapters/index.ts';
import type { ResolvedConfig } from '../config/resolve.ts';
import type { BuildMode } from '../config/types.ts';
import type { DiagnosisContext } from '../diagnose/index.ts';
import { DEFAULT_NORMALIZE, genericMarkers, reactMarkers, type NormalizeOptions } from '../dom/normalize.ts';
import type { PageRun, PageScreenshots } from '../engine/run.ts';
import type { LogLine } from '../engine/server.ts';
import type { Severity } from '../issues/registry.ts';
import type { Issue, PageResult, Report, Screenshots, Summary } from '../report/model.ts';
import type { PlannedRoute } from './plan.ts';

const RANK: Record<Severity, number> = { error: 3, warning: 2, info: 1 };
const LOG_PROBLEM = /\b(?:error|warn(?:ing)?|exception|failed|unhandled)\b|⨯|✖/i;
const MAX_LOG_LINES = 20;

export function serverEnvironment(config: ResolvedConfig): DiagnosisContext['server'] {
  if (config.server.url !== undefined) return {};
  const local = new Intl.DateTimeFormat().resolvedOptions();
  const env = { ...process.env, ...config.server.env };
  const lang = env['LC_ALL'] || env['LANG'];
  const locale = lang && lang !== 'C' && lang !== 'POSIX' ? (lang.split('.')[0] ?? lang).replace('_', '-') : local.locale;
  return { locale, timezoneId: env['TZ'] || local.timeZone };
}

export function normalizeOptions(config: ResolvedConfig, adapter: Adapter): NormalizeOptions {
  return {
    ...DEFAULT_NORMALIZE,
    markers: [...reactMarkers, ...genericMarkers, ...adapter.markers],
    ignoreAttributes: config.ignore.attributes.map((pattern) => (typeof pattern === 'string' ? pattern.toLowerCase() : pattern)),
  };
}

export function filterChecks(config: ResolvedConfig, issues: Issue[]): Issue[] {
  const { checks } = config;
  return issues.filter((issue) => {
    if (!checks.reactErrors && issue.code.startsWith('HP2')) return false;
    if (!checks.invalidHtml && issue.code.startsWith('HP3')) return false;
    if (!checks.externalChanges && issue.code.startsWith('HP4')) return false;
    if (checks.suppressedWarnings === 'off' && issue.code.startsWith('HP6')) return false;
    if (!checks.domDiff && issue.stage === 'hydration' && !issue.suppressed) return false;
    return true;
  });
}

function slug(text: string): string {
  return text.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'page';
}

export function writeScreenshots(outputDir: string, run: PageRun, shots: PageScreenshots): Screenshots {
  const dir = join(outputDir, 'screenshots');
  mkdirSync(dir, { recursive: true });
  const base = `${slug(new URL(run.job.url).pathname)}-${createHash('sha1').update(run.job.id).digest('hex').slice(0, 8)}`;
  const out: Screenshots = { width: shots.width, height: shots.height, boxes: shots.boxes };
  if (shots.hydrated) {
    writeFileSync(join(dir, `${base}-hydrated.jpg`), shots.hydrated);
    out.hydrated = `screenshots/${base}-hydrated.jpg`;
  }
  if (shots.server) {
    writeFileSync(join(dir, `${base}-server.jpg`), shots.server);
    out.server = `screenshots/${base}-server.jpg`;
  }
  return out;
}

export function serverLogsFor(run: PageRun, logs: readonly LogLine[]): string[] {
  const start = run.capture.startedAt;
  const end = start + run.capture.timings.total;
  return logs
    .filter((line) => line.time >= start && line.time <= end && LOG_PROBLEM.test(line.text))
    .slice(0, MAX_LOG_LINES)
    .map((line) => line.text.slice(0, 500));
}

export function toPageResult(run: PageRun, issues: Issue[], route: PlannedRoute | undefined, mode?: BuildMode): PageResult {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) if (!issue.ignored) counts[issue.severity]++;
  const status = run.capture.outcome === 'navigation-failed' ? 'error' : counts.error > 0 ? 'failed' : counts.warning > 0 ? 'warning' : 'passed';
  const page: PageResult = {
    id: run.job.id,
    route: run.job.route,
    scenario: run.job.scenario.name,
    url: run.job.url,
    finalUrl: run.capture.finalUrl,
    status,
    outcome: run.capture.outcome,
    timings: run.capture.timings,
    issues: issues.map((issue) => issue.fingerprint),
    counts,
  };
  if (run.capture.document) {
    page.http = {
      status: run.capture.document.status,
      redirects: run.capture.document.redirects.map((redirect) => ({ url: redirect.url, status: redirect.status })),
    };
  }
  if (run.analysis.react) page.react = run.analysis.react;
  if (mode) page.mode = mode;
  if (route) page.source = route.source;
  if (run.analysis.timeline.length > 0) page.timeline = run.analysis.timeline;
  return page;
}

/** With --mode both: note issues that appear in only one build. */
export function compareModes(issues: Issue[]): void {
  const modes = new Map<string, Set<string>>();
  for (const issue of issues) {
    if (!issue.mode) continue;
    const key = `${issue.fingerprint}|${issue.scenario}`;
    const set = modes.get(key) ?? new Set<string>();
    set.add(issue.mode);
    modes.set(key, set);
  }
  for (const issue of issues) {
    const set = issue.mode ? modes.get(`${issue.fingerprint}|${issue.scenario}`) : undefined;
    if (!set || set.size !== 1) continue;
    issue.evidence.push({
      kind: 'note',
      message: issue.mode === 'production' ? 'Only found in the production build.' : 'Only found in development (React development builds check more).',
    });
  }
}

export function summarize(pages: PageResult[], issues: Issue[]): Summary {
  const summary: Summary = {
    pages: pages.length,
    routes: new Set(pages.map((page) => page.route.pattern)).size,
    passed: pages.filter((page) => page.status === 'passed').length,
    warnings: pages.filter((page) => page.status === 'warning').length,
    failed: pages.filter((page) => page.status === 'failed').length,
    errored: pages.filter((page) => page.status === 'error').length,
    issues: { error: 0, warning: 0, info: 0 },
    ignored: 0,
  };
  for (const issue of issues) {
    if (issue.ignored) summary.ignored++;
    else summary.issues[issue.severity]++;
  }
  return summary;
}

export function policy(config: ResolvedConfig, report: Report, expired: ExpiredRule[]): string[] {
  const failures: string[] = [];
  const { failOn, maxWarnings } = config.ci;
  const active = report.issues.filter((issue) => !issue.ignored);
  if (failOn !== 'never') {
    const failing = active.filter((issue) => RANK[issue.severity] >= RANK[failOn]);
    if (failing.length > 0) {
      failures.push(`${failing.length} issue${failing.length === 1 ? '' : 's'} at or above "${failOn}" severity.`);
    }
  }
  if (maxWarnings !== undefined && report.summary.issues.warning > maxWarnings) {
    failures.push(`${report.summary.issues.warning} warnings exceed ci.maxWarnings (${maxWarnings}).`);
  }
  const seen = new Set<string>();
  for (const { rule } of expired) {
    const key = `${rule.fingerprint ?? ''}|${rule.code ?? ''}|${rule.route ?? ''}|${rule.expires}`;
    if (seen.has(key)) continue;
    seen.add(key);
    failures.push(`Ignore rule "${rule.reason}" expired on ${rule.expires}.`);
  }
  return failures;
}
