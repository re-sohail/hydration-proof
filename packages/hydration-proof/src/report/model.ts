// The report format. `schemaVersion` changes only on breaking changes; new
// optional fields may be added at any time.

import type { IssueCode, Severity } from '../issues/registry.ts';

export const REPORT_SCHEMA_VERSION = 1;

export type Stage =
  | 'raw'
  | 'parsed'
  | 'pre-hydration'
  | 'hydration'
  | 'post-effect'
  | 'stable'
  | 'runtime';

export interface RouteRef {
  /** The URL that was loaded. */
  url: string;
  /** The route pattern it belongs to (e.g. /products/[id]); equals the path for static routes. */
  pattern: string;
}

export interface Evidence {
  kind:
    | 'react-error'
    | 'react-warning'
    | 'console'
    | 'page-error'
    | 'dom-change'
    | 'mutation'
    | 'http'
    | 'markup'
    | 'note';
  message: string;
  detail?: string;
}

export interface SourceLocation {
  file: string;
  line: number;
  column?: number;
  /** A few lines around the location. */
  frame?: string;
}

export interface Cause {
  id: string;
  title: string;
  confidence: number;
  docsUrl?: string;
  /** A probe run confirmed the cause (the value changed when only this factor changed). */
  proven?: boolean;
}

export interface ProbeResult {
  /** What the probe changed: time, random, locale, timezone, theme, viewport, storage, or `repeat` (an identical reload). */
  factor: string;
  /** `changes`: the finding changed with this factor; `stable`: it did not; `inconclusive`: the page changes between identical loads. */
  result: 'changes' | 'stable' | 'inconclusive';
  detail?: string;
}

/** An environment axis whose values separate the pages with and without the finding. */
export interface EnvironmentSplit {
  /** Axis: locale, timezone, colorScheme, reducedMotion, viewport, browser, network, cpu, cache, mode, or a custom axis. */
  axis: string;
  /** The values the finding was seen with. */
  values: string[];
}

export interface TimelineEntry {
  /** Milliseconds since navigation start. */
  time: number;
  kind: 'renderer' | 'commit' | 'error' | 'mutation' | 'stream' | 'effects' | 'snapshot' | 'network' | 'navigation' | 'interaction';
  label: string;
  detail?: string;
}

export interface Screenshots {
  /** Paths relative to the report directory. */
  hydrated?: string;
  server?: string;
  width: number;
  height: number;
  boxes: { fingerprint: string; x: number; y: number; width: number; height: number }[];
}

export interface Issue {
  /** Stable across runs: same problem, same fingerprint. */
  fingerprint: string;
  code: IssueCode;
  title: string;
  severity: Severity;
  /** 0–1: how sure the tool is that this is a real problem with this cause. */
  confidence: number;
  message: string;
  route: RouteRef;
  scenario: string;
  stage: Stage;
  selector?: string;
  domPath?: string[];
  attribute?: string;
  /** Value in the server HTML. `null` = absent. */
  server?: string | null;
  /** Value React rendered on the client. `null` = absent. */
  client?: string | null;
  component?: string;
  componentStack?: string;
  source?: SourceLocation;
  sourceUnavailableReason?: string;
  cause?: Cause;
  evidence: Evidence[];
  suggestions: string[];
  docsUrl: string;
  /** Present when a config rule or baseline ignored the issue. */
  ignored?: { reason: string; rule: string };
  /** The element carried suppressHydrationWarning. */
  suppressed?: boolean;
  /** Short HTML of the element on each side. */
  excerpt?: { server?: string; client?: string };
  /** Build mode the issue was found in (runs with --mode both). */
  mode?: 'production' | 'development';
  /** With `repeat`: in how many of the page's runs the finding appeared. */
  occurrences?: { seen: number; runs: number };
  /** Seen in some runs of the page but not all. */
  flaky?: boolean;
  /** The finding only appears with these environment values (matrix or --mode both). */
  onlyIn?: EnvironmentSplit[];
  /** Results of the probe runs. */
  probes?: ProbeResult[];
  /** The finding is recorded in the baseline. */
  baseline?: { firstSeen: string; reason?: string; expires?: string };
  /** A baseline is in use and this finding is not in it. */
  new?: boolean;
  /** Teams or people responsible (route owners from the config, or CODEOWNERS of the source file). */
  owners?: string[];
  /** Monorepo project the finding belongs to. */
  project?: string;
}

export type PageStatus = 'passed' | 'warning' | 'failed' | 'error';

export interface ReactInfo {
  version: string;
  build: 'production' | 'development' | 'unknown';
  roots: { selector: string; mode: 'hydrate' | 'client' }[];
}

export interface PageResult {
  id: string;
  route: RouteRef;
  scenario: string;
  url: string;
  finalUrl: string;
  status: PageStatus;
  outcome: string;
  http?: { status: number; redirects: { url: string; status: number }[] };
  react?: ReactInfo;
  timings: { navigation: number; hydration?: number; total: number };
  /** Fingerprints of the issues found on this page. */
  issues: string[];
  counts: Record<Severity, number>;
  mode?: 'production' | 'development';
  timeline?: TimelineEntry[];
  screenshots?: Screenshots;
  /** Error and warning lines the app server printed while this page loaded. */
  serverLogs?: string[];
  /** How the route was found. */
  source?: 'config' | 'discovered' | 'manifest' | 'sitemap' | 'crawl' | 'not-found';
  /** The configured scenario this environment was derived from (with a matrix). */
  baseScenario?: string;
  /** The environment the page was tested in: browser plus the matrix axis values. */
  environment?: Record<string, string>;
  /** With `repeat`: how many times the page was loaded. */
  runs?: number;
  /** With `repeat`: share of runs whose findings differ from the most common result (0 = consistent). */
  flakiness?: number;
  /** Monorepo project the page belongs to. */
  project?: string;
}

export interface RunInfo {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  cwd: string;
  node: string;
  platform: string;
  playwright: string;
  browsers: string[];
  mode: string;
  baseUrl?: string;
  ci?: string;
  /** Git commit and branch, when available. */
  commit?: string;
  branch?: string;
  /** Shards merged into this report. */
  shards?: string[];
}

export interface Summary {
  pages: number;
  routes: number;
  passed: number;
  warnings: number;
  failed: number;
  errored: number;
  issues: Record<Severity, number>;
  ignored: number;
  /** Findings that appeared in only some runs of a page (with `repeat`). */
  flaky?: number;
  /** With a baseline: findings that are not in it. */
  new?: number;
  /** With a baseline: findings that are in it. */
  known?: number;
  /** Values removed from the report by redaction, by kind. */
  redacted?: Record<string, number>;
}

/** One line of the history file (`ci.history`). */
export interface HistoryEntry {
  date: string;
  commit?: string;
  branch?: string;
  durationMs: number;
  pages: number;
  failed: number;
  issues: Record<Severity, number>;
  /** Non-ignored findings per issue code. */
  codes: Record<string, number>;
  /** Fingerprints of the non-ignored findings. */
  fingerprints: string[];
}

export interface Report {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  tool: { name: 'hydration-proof'; version: string };
  run: RunInfo;
  summary: Summary;
  pages: PageResult[];
  issues: Issue[];
  /** Earlier runs from the history file, oldest first (for trends). */
  history?: HistoryEntry[];
}
