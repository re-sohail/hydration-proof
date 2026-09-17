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
}

export interface Report {
  schemaVersion: typeof REPORT_SCHEMA_VERSION;
  tool: { name: 'hydration-proof'; version: string };
  run: RunInfo;
  summary: Summary;
  pages: PageResult[];
  issues: Issue[];
}
