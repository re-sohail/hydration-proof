// GitLab Code Quality report (a subset of the Code Climate issue format).

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ResolvedConfig } from '../../config/resolve.ts';
import type { Issue, Report } from '../model.ts';
import {
  activeIssues,
  byImportance,
  causeText,
  fallbackPath,
  findRepoRoot,
  hasValues,
  issuePath,
  jsonText,
  outputDirOf,
  positiveInt,
  quoteValue,
  relativeToBase,
  rootDirOf,
  truncate,
} from './ci-shared.ts';
import type { Reporter } from './types.ts';

export type CodeQualitySeverity = 'info' | 'minor' | 'major' | 'critical' | 'blocker';

export interface CodeQualityIssue {
  description: string;
  check_name: string;
  fingerprint: string;
  severity: CodeQualitySeverity;
  location: { path: string; lines: { begin: number } };
}

const VALUE_LIMIT = 100;
const DESCRIPTION_LIMIT = 1000;
/** Errors this certain are `critical`, other errors `major`. */
export const CRITICAL_CONFIDENCE = 0.9;

export function codeQualitySeverity(issue: Pick<Issue, 'severity' | 'confidence'>): CodeQualitySeverity {
  if (issue.severity === 'error') {
    return typeof issue.confidence === 'number' && issue.confidence >= CRITICAL_CONFIDENCE ? 'critical' : 'major';
  }
  return issue.severity === 'warning' ? 'minor' : 'info';
}

function description(issue: Issue, fallback: boolean): string {
  const scope = [issue.scenario ? `scenario ${issue.scenario}` : '', issue.mode ? `${issue.mode} build` : ''].filter(Boolean).join(', ');
  const parts = [`${issue.code} ${issue.title ?? ''}`.trim() + ` on ${issuePath(issue)}${scope ? ` (${scope})` : ''}`];
  const detail: string[] = [];
  if (issue.selector) detail.push(`${truncate(issue.selector, VALUE_LIMIT)}${issue.attribute ? ` [${issue.attribute}]` : ''}`);
  if (hasValues(issue)) detail.push(`server ${quoteValue(issue.server, VALUE_LIMIT)}, client ${quoteValue(issue.client, VALUE_LIMIT)}`);
  else if (issue.message) detail.push(truncate(issue.message, 2 * VALUE_LIMIT));
  const cause = causeText(issue);
  if (cause) detail.push(`likely cause: ${cause}`);
  if (fallback && issue.source?.file) detail.push(`source: ${issue.source.file}${positiveInt(issue.source.line) ? `:${issue.source.line}` : ''}`);
  if (detail.length > 0) parts.push(detail.join('; '));
  return truncate(parts.join(': ').replace(/\s+/g, ' ').trim(), DESCRIPTION_LIMIT);
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function renderCodeQuality(
  report: Report,
  config: ResolvedConfig | undefined,
  env: NodeJS.ProcessEnv = process.env,
): CodeQualityIssue[] {
  const rootDir = rootDirOf(config);
  const base = env['CI_PROJECT_DIR'] || findRepoRoot(rootDir);
  const fallback = fallbackPath(config, base);
  const seen = new Set<string>();
  return activeIssues(report)
    .sort(byImportance(report))
    .map((issue) => {
      const file = relativeToBase(issue.source?.file, rootDir, base);
      const line = (file && positiveInt(issue.source?.line)) || 1;
      // GitLab needs unique fingerprints: the issue fingerprint is per route
      // pattern, so add the scenario, mode and URL path (not the host, whose
      // port changes between runs).
      const identity = ['hydration-proof/v1', issue.fingerprint || `${issue.code}`, issue.scenario ?? '', issue.mode ?? '', issuePath(issue)].join('\n');
      let fingerprint = sha256(identity);
      for (let n = 2; seen.has(fingerprint); n++) fingerprint = sha256(`${identity}\n${n}`);
      seen.add(fingerprint);
      return {
        description: description(issue, !file),
        check_name: String(issue.code),
        fingerprint,
        severity: codeQualitySeverity(issue),
        location: { path: file ?? fallback, lines: { begin: line } },
      };
    });
}

export function gitlabReporter(env: NodeJS.ProcessEnv = process.env, fileName = 'gl-code-quality.json'): Reporter {
  return {
    name: 'gitlab',
    onEnd(report, context) {
      const dir = outputDirOf(context.config);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, fileName);
      writeFileSync(file, jsonText(renderCodeQuality(report, context.config, env)));
      return [file];
    },
  };
}
