import type { IgnoreRule } from '../config/types.ts';
import type { Issue } from '../report/model.ts';
import { matchesGlob, pathOf } from '../routes/pattern.ts';

// Ignored issues stay in the report (marked), they just don't fail the run.

export interface IgnoreOptions {
  textPatterns: readonly RegExp[];
  rules: readonly IgnoreRule[];
  /** For expiry checks; defaults to now. */
  today?: Date;
}

export interface ExpiredRule {
  rule: IgnoreRule;
  issue: Issue;
}

const TEXT_CODES = new Set(['HP1001', 'HP1015', 'HP6001']);

function mask(value: string, patterns: readonly RegExp[]): string {
  let out = value;
  for (const pattern of patterns) {
    const global = pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
    out = out.replace(global, '∗');
  }
  return out;
}

function ruleMatches(rule: IgnoreRule, issue: Issue): boolean {
  if (rule.fingerprint !== undefined && rule.fingerprint !== issue.fingerprint) return false;
  if (rule.code !== undefined && rule.code !== issue.code) return false;
  if (rule.route !== undefined) {
    const path = pathOf(new URL(issue.route.url, 'http://localhost').pathname);
    if (!matchesGlob(path, rule.route) && !matchesGlob(issue.route.pattern, rule.route)) return false;
  }
  if (rule.selector !== undefined) {
    const selector = issue.selector ?? '';
    if (selector !== rule.selector && !selector.startsWith(`${rule.selector} `)) return false;
  }
  return rule.fingerprint !== undefined || rule.code !== undefined || rule.route !== undefined || rule.selector !== undefined;
}

function isExpired(rule: IgnoreRule, today: Date): boolean {
  if (rule.expires === undefined) return false;
  const expires = new Date(`${rule.expires}T23:59:59Z`);
  return !Number.isNaN(expires.getTime()) && expires < today;
}

/** Mark issues as ignored in place. Returns rules that matched but have expired. */
export function applyIgnores(issues: Issue[], options: IgnoreOptions): ExpiredRule[] {
  const today = options.today ?? new Date();
  const expired: ExpiredRule[] = [];
  for (const issue of issues) {
    if (issue.ignored) continue;
    if (
      options.textPatterns.length > 0 &&
      TEXT_CODES.has(issue.code) &&
      typeof issue.server === 'string' &&
      typeof issue.client === 'string' &&
      mask(issue.server, options.textPatterns) === mask(issue.client, options.textPatterns)
    ) {
      issue.ignored = { reason: 'The difference only matches ignore.textPatterns.', rule: 'ignore.textPatterns' };
      continue;
    }
    for (const rule of options.rules) {
      if (!ruleMatches(rule, issue)) continue;
      if (isExpired(rule, today)) {
        expired.push({ rule, issue });
        continue;
      }
      issue.ignored = { reason: rule.reason, rule: `ignore.issues${rule.fingerprint ? ` (${rule.fingerprint})` : rule.code ? ` (${rule.code})` : ''}` };
      break;
    }
  }
  return expired;
}
