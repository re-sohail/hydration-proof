// Helpers shared by the CI reporters (github, sarif, junit, gitlab). Every
// function here tolerates incomplete data: a reporter must never make a run
// fail because a report field is missing.

import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { ResolvedConfig } from '../../config/resolve.ts';
import type { Severity } from '../../issues/registry.ts';
import type { Issue, PageResult, Report } from '../model.ts';

export const SEVERITY_RANK: Readonly<Record<Severity, number>> = { error: 2, warning: 1, info: 0 };

/** Readable tag per issue code group (used by SARIF rule tags). */
export const CODE_GROUPS: Readonly<Record<string, string>> = {
  HP1: 'dom-mismatch',
  HP2: 'react-error',
  HP3: 'invalid-html',
  HP4: 'external-change',
  HP5: 'interaction',
  HP6: 'suppression',
  HP9: 'test-run',
};

export function codeGroup(code: string): string | undefined {
  return CODE_GROUPS[String(code).slice(0, 3)];
}

export function rankOf(severity: unknown): number {
  return SEVERITY_RANK[severity as Severity] ?? 0;
}

export function severityOf(severity: unknown): Severity {
  return severity === 'error' || severity === 'warning' ? severity : 'info';
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function percent(confidence: unknown): number {
  return Math.round(Math.min(1, Math.max(0, finite(confidence))) * 100);
}

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}

/** Issues that count: everything except those an ignore rule or baseline matched. */
export function activeIssues(report: Report): Issue[] {
  return (Array.isArray(report?.issues) ? report.issues : []).filter((issue) => issue && !issue.ignored);
}

export function reportPages(report: Report): PageResult[] {
  return (Array.isArray(report?.pages) ? report.pages : []).filter(Boolean);
}

/** Path and query of a URL (the host and port change between runs). */
export function pathOf(url: unknown): string {
  if (typeof url !== 'string' || url === '') return '/';
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

export function issuePath(issue: Issue): string {
  return pathOf(issue.route?.url ?? issue.route?.pattern);
}

export function pagePath(page: PageResult): string {
  return pathOf(page.url ?? page.route?.url);
}

function pageKey(scenario: unknown, mode: unknown, url: unknown): string {
  return `${String(scenario ?? '')}\u0000${String(mode ?? '')}\u0000${String(url ?? '')}`;
}

/** Finds the issues that belong to a page (same scenario, mode and URL, listed in `page.issues`). */
export function issuesOfPage(report: Report): (page: PageResult) => Issue[] {
  const index = new Map<string, Issue[]>();
  for (const issue of Array.isArray(report?.issues) ? report.issues : []) {
    if (!issue) continue;
    const key = pageKey(issue.scenario, issue.mode, issue.route?.url);
    const list = index.get(key) ?? [];
    list.push(issue);
    index.set(key, list);
  }
  return (page) => {
    const urls = new Set([page.url, page.route?.url].filter((url): url is string => typeof url === 'string'));
    const found = new Set<Issue>();
    for (const url of urls) for (const issue of index.get(pageKey(page.scenario, page.mode, url)) ?? []) found.add(issue);
    const listed = Array.isArray(page.issues) ? new Set(page.issues) : undefined;
    return [...found].filter((issue) => !listed || listed.has(issue.fingerprint));
  };
}

/** Sorts by importance: severity, then confidence, then the order the routes were tested in. */
export function byImportance(report: Report): (a: Issue, b: Issue) => number {
  const order = new Map<string, number>();
  for (const page of reportPages(report)) {
    const pattern = page.route?.pattern;
    if (pattern !== undefined && !order.has(pattern)) order.set(pattern, order.size);
  }
  const position = (issue: Issue): number => order.get(issue.route?.pattern ?? '') ?? order.size;
  return (a, b) =>
    rankOf(b.severity) - rankOf(a.severity) || finite(b.confidence) - finite(a.confidence) || position(a) - position(b);
}

export interface IssueGroup {
  /** The most important issue of the group. */
  issue: Issue;
  issues: Issue[];
  scenarios: string[];
  modes: string[];
  paths: string[];
}

function unique(values: (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value !== ''))];
}

/** Groups issues with the same fingerprint (same problem in several scenarios, modes or URLs), most important first. */
export function groupIssues(issues: Issue[], compare: (a: Issue, b: Issue) => number): IssueGroup[] {
  const groups = new Map<string, Issue[]>();
  let anonymous = 0;
  for (const issue of [...issues].sort(compare)) {
    const key = issue.fingerprint ? `${String(issue.code)}\u0000${issue.fingerprint}` : `\u0000${anonymous++}`;
    const list = groups.get(key) ?? [];
    list.push(issue);
    groups.set(key, list);
  }
  return [...groups.values()].map((list) => ({
    issue: list[0]!,
    issues: list,
    scenarios: unique(list.map((issue) => issue.scenario)),
    modes: unique(list.map((issue) => issue.mode)),
    paths: unique(list.map(issuePath)),
  }));
}

/** Cuts text to `max` characters (never inside a surrogate pair) and marks the cut. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = Math.max(0, max - 1);
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end--;
  return `${text.slice(0, end)}…`;
}

// Characters that are invisible or reorder text: DEL and C1 controls, soft
// hyphen, zero-width and bidi controls. JSON.stringify leaves them as they are.
const INVISIBLE = /[\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]/g;
// The same plus C0 controls (except tab and newline) and lone surrogates.
const HIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff]|\p{Cs}/gu;

function escapeChar(char: string): string {
  return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
}

/** Text with hidden characters written as `\uXXXX` escapes. */
export function showHidden(text: string): string {
  return text.replace(HIDDEN, escapeChar);
}

/** Pretty JSON with invisible characters escaped (still valid JSON: they only occur inside strings). */
export function jsonText(value: unknown): string {
  return `${JSON.stringify(value, null, 2).replace(INVISIBLE, escapeChar)}\n`;
}

/** A server/client value for plain-text output: quoted, hidden characters escaped, truncated. */
export function quoteValue(value: string | null | undefined, max: number): string {
  if (value === null) return '(absent)';
  if (typeof value !== 'string') return '(not captured)';
  return JSON.stringify(truncate(value, max)).replace(INVISIBLE, escapeChar);
}

export function hasValues(issue: Issue): boolean {
  return issue.server !== undefined || issue.client !== undefined;
}

export function causeText(issue: Issue): string | undefined {
  const cause = issue.cause;
  if (!cause?.title) return undefined;
  return `${cause.title} (${percent(cause.confidence)}% confidence)`;
}

export function locationText(issue: Issue): string | undefined {
  const source = issue.source;
  if (!source?.file) return undefined;
  const line = positiveInt(source.line);
  const column = positiveInt(source.column);
  return `${source.file}${line ? `:${line}${column ? `:${column}` : ''}` : ''}`;
}

export function positiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

export function listText(values: string[], max: number): string {
  if (values.length <= max) return values.join(', ');
  return `${values.slice(0, max).join(', ')} and ${values.length - max} more`;
}

/** "scenario admin" / "scenarios guest, admin", plus the build mode(s). */
export function scopeText(group: IssueGroup): string {
  const parts: string[] = [];
  if (group.scenarios.length > 0) {
    parts.push(`${group.scenarios.length === 1 ? 'scenario' : 'scenarios'} ${listText(group.scenarios, 5)}`);
  }
  if (group.modes.length > 0) parts.push(`${group.modes.join(' and ')} ${group.modes.length === 1 ? 'build' : 'builds'}`);
  return parts.join('; ');
}

export function rootDirOf(config: ResolvedConfig | undefined): string {
  return typeof config?.rootDir === 'string' && config.rootDir !== '' ? config.rootDir : process.cwd();
}

export function outputDirOf(config: ResolvedConfig | undefined): string {
  return typeof config?.outputDir === 'string' && config.outputDir !== ''
    ? config.outputDir
    : join(rootDirOf(config), '.hydration-proof', 'report');
}

/** The repository root: the closest directory with a `.git` entry, else `rootDir`. */
export function findRepoRoot(rootDir: string): string {
  const start = resolve(rootDir);
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (dirname(dir) === dir) return start;
  }
}

/**
 * `file` (absolute, or relative to `rootDir`) relative to `base` with POSIX
 * separators. Undefined for URLs and for files outside `base`.
 */
export function relativeToBase(file: unknown, rootDir: string, base: string): string | undefined {
  if (typeof file !== 'string' || file === '') return undefined;
  // `webpack:`, `rsc:`, `node:`… are not files in the repository (`C:\` is).
  if (/^[a-z][a-z0-9+.-]+:/i.test(file)) return undefined;
  const path = relative(resolve(base), resolve(rootDir, file));
  if (path === '' || isAbsolute(path) || path === '..' || path.startsWith(`..${sep}`) || path.startsWith('../')) return undefined;
  return path.split(sep).join('/');
}

/**
 * Where to anchor findings without a source location: the config file, else
 * the app's package.json.
 */
export function fallbackPath(config: ResolvedConfig | undefined, base: string): string {
  const rootDir = rootDirOf(config);
  return (
    relativeToBase(config?.configFile, rootDir, base) ?? relativeToBase('package.json', rootDir, base) ?? 'package.json'
  );
}

export function reporterNames(config: ResolvedConfig | undefined): string[] {
  return Array.isArray(config?.reporters) ? config.reporters.map(String) : [];
}

/** Seconds with millisecond precision, for XML/JSON time fields. */
export function seconds(ms: unknown): string {
  return (Math.max(0, finite(ms)) / 1000).toFixed(3);
}

export function validDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function pascalCase(name: string): string {
  return name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');
}
