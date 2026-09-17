import type { Issue, PageResult, Report } from '../report/model.ts';

// Removes secrets and personal data from everything a report shows: page
// text, attribute values, messages, evidence, server logs and URLs.
// Fingerprints are computed before redaction, so they stay stable.

export interface RedactOptions {
  /** Built-in rules (emails, tokens, card numbers, secret URL parameters). Default true. */
  builtIn: boolean;
  /** Extra patterns; matches are replaced with `[redacted]`. */
  patterns: RegExp[];
}

interface Rule {
  label: string;
  pattern: RegExp;
  /** Extra check for a match (for example the Luhn checksum). */
  accept?: (match: string) => boolean;
}

function luhn(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

const RULES: readonly Rule[] = [
  { label: 'jwt', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { label: 'token', pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{12,}=*/g },
  { label: 'token', pattern: /\b(?:sk|pk|rk)_(?:live|test)_[0-9A-Za-z]{12,}\b/g },
  { label: 'token', pattern: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g },
  { label: 'token', pattern: /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g },
  { label: 'token', pattern: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
  { label: 'token', pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { label: 'token', pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { label: 'token', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { label: 'token', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g },
  { label: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  { label: 'card', pattern: /\b\d(?:[ -]?\d){12,18}\b/g, accept: luhn },
];

const SECRET_PARAMS =
  /([?&](?:access_token|refresh_token|id_token|token|auth|authorization|api_?key|apikey|key|secret|client_secret|password|passwd|pwd|session|sessionid|sid|code|sig|signature|jwt)=)[^&#\s"'<>]*/gi;

export class Redactor {
  private readonly options: RedactOptions;
  /** How many values were redacted, by label. */
  readonly counts: Map<string, number> = new Map();

  constructor(options: RedactOptions) {
    this.options = options;
  }

  private count(label: string): void {
    this.counts.set(label, (this.counts.get(label) ?? 0) + 1);
  }

  text(value: string): string;
  text(value: string | null | undefined): string | null | undefined;
  text(value: string | null | undefined): string | null | undefined {
    if (typeof value !== 'string' || value === '') return value;
    let out = value;
    if (this.options.builtIn) {
      out = out.replace(SECRET_PARAMS, (_match, prefix: string) => {
        this.count('url-parameter');
        return `${prefix}[redacted]`;
      });
      for (const rule of RULES) {
        out = out.replace(rule.pattern, (match) => {
          if (rule.accept && !rule.accept(match)) return match;
          this.count(rule.label);
          return `[${rule.label}]`;
        });
      }
    }
    for (const pattern of this.options.patterns) {
      const global = pattern.global ? pattern : new RegExp(pattern.source, `${pattern.flags}g`);
      out = out.replace(global, () => {
        this.count('custom');
        return '[redacted]';
      });
    }
    return out;
  }

  issue(issue: Issue): Issue {
    const out: Issue = {
      ...issue,
      message: this.text(issue.message),
      route: { ...issue.route, url: this.text(issue.route.url) },
      evidence: issue.evidence.map((entry) => {
        const copy = { ...entry, message: this.text(entry.message) };
        if (entry.detail !== undefined) copy.detail = this.text(entry.detail);
        return copy;
      }),
    };
    if (issue.server !== undefined) out.server = this.text(issue.server);
    if (issue.client !== undefined) out.client = this.text(issue.client);
    if (issue.excerpt) {
      out.excerpt = {};
      if (issue.excerpt.server !== undefined) out.excerpt.server = this.text(issue.excerpt.server);
      if (issue.excerpt.client !== undefined) out.excerpt.client = this.text(issue.excerpt.client);
    }
    if (issue.source?.frame !== undefined) out.source = { ...issue.source, frame: this.text(issue.source.frame) };
    if (issue.componentStack !== undefined) out.componentStack = this.text(issue.componentStack);
    if (issue.probes) out.probes = issue.probes.map((probe) => (probe.detail === undefined ? probe : { ...probe, detail: this.text(probe.detail) }));
    return out;
  }

  page(page: PageResult): PageResult {
    const out: PageResult = { ...page, url: this.text(page.url), finalUrl: this.text(page.finalUrl), route: { ...page.route, url: this.text(page.route.url) } };
    if (page.http) out.http = { ...page.http, redirects: page.http.redirects.map((redirect) => ({ ...redirect, url: this.text(redirect.url) })) };
    if (page.serverLogs) out.serverLogs = page.serverLogs.map((line) => this.text(line));
    if (page.timeline) {
      out.timeline = page.timeline.map((entry) => {
        const copy = { ...entry, label: this.text(entry.label) };
        if (entry.detail !== undefined) copy.detail = this.text(entry.detail);
        return copy;
      });
    }
    return out;
  }

  report(report: Report): Report {
    const run = { ...report.run };
    if (run.baseUrl !== undefined) run.baseUrl = this.text(run.baseUrl);
    return { ...report, run, pages: report.pages.map((page) => this.page(page)), issues: report.issues.map((issue) => this.issue(issue)) };
  }
}

export function createRedactor(options: Partial<RedactOptions> | false): Redactor | undefined {
  if (options === false) return undefined;
  return new Redactor({ builtIn: options.builtIn ?? true, patterns: options.patterns ?? [] });
}
