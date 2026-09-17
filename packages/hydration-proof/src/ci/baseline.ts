import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import type { Issue } from '../report/model.ts';
import { FINGERPRINT_VERSION } from '../issues/fingerprint.ts';

// Baselines let a team adopt hydration-proof on an app with known problems:
// `hydration-proof baseline` records them, `test --new-only` fails only on
// findings that are not recorded.

export const BASELINE_VERSION = 1;

export interface BaselineEntry {
  /** Stable issue fingerprint. */
  fingerprint: string;
  code: string;
  title: string;
  /** Route pattern. */
  route: string;
  selector?: string;
  attribute?: string;
  /** Likely cause id when the entry was recorded. */
  cause?: string;
  scenarios: string[];
  /** YYYY-MM-DD */
  firstSeen: string;
  lastSeen: string;
  /** YYYY-MM-DD after which the entry no longer excuses the finding. */
  expires?: string;
  /** Why this is accepted for now (written by a developer). */
  reason?: string;
}

export interface BaselineFile {
  $schema?: string;
  version: typeof BASELINE_VERSION;
  tool: 'hydration-proof';
  updatedAt: string;
  /**
   * The fingerprint version the entries were recorded with. When a release has
   * to change how fingerprints are computed, an older baseline is still matched
   * by code, route and selector, so nobody's pipeline turns red overnight.
   */
  fingerprintVersion?: number;
  entries: BaselineEntry[];
}

export class BaselineError extends Error {
  override name = 'BaselineError';
}

export function today(date: Date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function readBaseline(file: string): BaselineFile | undefined {
  if (!existsSync(file)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new BaselineError(`The baseline ${file} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const data = parsed as Partial<BaselineFile>;
  if (data.version !== BASELINE_VERSION || !Array.isArray(data.entries)) {
    throw new BaselineError(`The baseline ${file} has an unknown format (expected version ${BASELINE_VERSION}). Run "hydration-proof migrate" or create it again with "hydration-proof baseline".`);
  }
  for (const entry of data.entries) {
    if (typeof entry?.fingerprint !== 'string') throw new BaselineError(`The baseline ${file} has an entry without a fingerprint.`);
    if (entry.expires !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires)) {
      throw new BaselineError(`The baseline ${file}: "expires" of ${entry.fingerprint} must be a date (YYYY-MM-DD).`);
    }
  }
  return data as BaselineFile;
}

/**
 * The baseline for the current findings. Entries that are still found keep
 * their first-seen date, expiry and reason; fixed problems are dropped.
 */
export function buildBaseline(issues: readonly Issue[], previous: BaselineFile | undefined, now: Date = new Date()): BaselineFile {
  const known = new Map((previous?.entries ?? []).map((entry) => [entry.fingerprint, entry]));
  const entries = new Map<string, BaselineEntry>();
  const date = today(now);
  for (const issue of issues) {
    if (issue.ignored && issue.ignored.rule !== 'baseline') continue;
    const existing = entries.get(issue.fingerprint);
    if (existing) {
      if (!existing.scenarios.includes(issue.scenario)) existing.scenarios.push(issue.scenario);
      continue;
    }
    const old = known.get(issue.fingerprint);
    const entry: BaselineEntry = {
      fingerprint: issue.fingerprint,
      code: issue.code,
      title: issue.title,
      route: issue.route.pattern,
      scenarios: [issue.scenario],
      firstSeen: old?.firstSeen ?? date,
      lastSeen: date,
    };
    if (issue.selector !== undefined) entry.selector = issue.selector;
    if (issue.attribute !== undefined) entry.attribute = issue.attribute;
    const cause = issue.cause?.id ?? old?.cause;
    if (cause !== undefined) entry.cause = cause;
    if (old?.expires !== undefined) entry.expires = old.expires;
    if (old?.reason !== undefined) entry.reason = old.reason;
    entries.set(issue.fingerprint, entry);
  }
  const sorted = [...entries.values()].sort((a, b) => a.route.localeCompare(b.route) || a.code.localeCompare(b.code) || a.fingerprint.localeCompare(b.fingerprint));
  for (const entry of sorted) entry.scenarios.sort();
  return {
    version: BASELINE_VERSION,
    tool: 'hydration-proof',
    updatedAt: now.toISOString(),
    fingerprintVersion: FINGERPRINT_VERSION,
    entries: sorted,
  };
}

/** Write the baseline; `rootDir` (where node_modules is) gives editors the schema. */
export function writeBaseline(file: string, baseline: BaselineFile, rootDir?: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const schema = rootDir ? relative(dirname(file), join(rootDir, 'node_modules', 'hydration-proof', 'schema', 'baseline.json')).split(sep).join('/') : undefined;
  const content: BaselineFile = schema ? { $schema: schema, ...baseline } : baseline;
  writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);
}

export interface ExpiredEntry {
  entry: BaselineEntry;
}

/** How an entry that no longer matches by fingerprint can still be recognised. */
function looseKey(code: string, route: string, selector: string | undefined): string {
  return `${code}|${route}|${selector ?? ''}`;
}

/**
 * Mark findings that are in the baseline. With `newOnly`, those findings are
 * ignored (they do not fail the run) unless their entry expired.
 */
export function applyBaseline(issues: Issue[], baseline: BaselineFile, options: { newOnly: boolean; now?: Date }): ExpiredEntry[] {
  const date = today(options.now);
  const entries = new Map(baseline.entries.map((entry) => [entry.fingerprint, entry]));
  const expired = new Map<string, ExpiredEntry>();
  // An older baseline was recorded with a different fingerprint recipe, so its
  // fingerprints cannot match. Fall back to what is still comparable rather
  // than declaring every known finding new. Unambiguous keys only: two entries
  // sharing one is no evidence about either.
  const stale = baseline.fingerprintVersion !== undefined && baseline.fingerprintVersion !== FINGERPRINT_VERSION;
  const loose = new Map<string, BaselineEntry | undefined>();
  if (stale) {
    for (const entry of baseline.entries) {
      const key = looseKey(entry.code, entry.route, entry.selector);
      loose.set(key, loose.has(key) ? undefined : entry);
    }
  }
  for (const issue of issues) {
    let entry = entries.get(issue.fingerprint);
    if (!entry && stale) entry = loose.get(looseKey(issue.code, issue.route.pattern, issue.selector));
    if (!entry) {
      if (!issue.ignored) issue.new = true;
      continue;
    }
    issue.baseline = { firstSeen: entry.firstSeen };
    if (entry.reason !== undefined) issue.baseline.reason = entry.reason;
    if (entry.expires !== undefined) issue.baseline.expires = entry.expires;
    const isExpired = entry.expires !== undefined && entry.expires < date;
    if (isExpired) {
      expired.set(entry.fingerprint, { entry });
      issue.evidence.push({ kind: 'note', message: `The baseline entry for this finding expired on ${entry.expires}.` });
      continue;
    }
    if (options.newOnly && !issue.ignored) {
      issue.ignored = { reason: entry.reason ?? `Known since ${entry.firstSeen} (baseline).`, rule: 'baseline' };
    }
  }
  return [...expired.values()];
}
