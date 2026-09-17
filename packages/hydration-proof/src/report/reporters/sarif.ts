// SARIF 2.1.0 (GitHub code scanning and other static-analysis dashboards).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ResolvedConfig } from '../../config/resolve.ts';
import { docsUrl, ISSUES, type Severity } from '../../issues/registry.ts';
import { suggestionsFor } from '../../issues/suggestions.ts';
import type { Issue, Report } from '../model.ts';
import {
  byImportance,
  causeText,
  codeGroup,
  escapeHtml,
  fallbackPath,
  findRepoRoot,
  issuePath,
  jsonText,
  locationText,
  outputDirOf,
  pascalCase,
  positiveInt,
  quoteValue,
  relativeToBase,
  rootDirOf,
  truncate,
  validDate,
} from './ci-shared.ts';
import type { Reporter } from './types.ts';

export const SARIF_SCHEMA = 'https://json.schemastore.org/sarif-2.1.0.json';
export const SARIF_FINGERPRINT_KEY = 'hydrationProof/v1';
const INFORMATION_URI = 'https://hydration.jscrate.dev';
const SRCROOT = '%SRCROOT%';
/** Exit codes that mean the run itself did not work (usage, server, browser, internal). */
const UNSUCCESSFUL_EXIT_CODES = new Set([2, 3, 4, 70]);
const VALUE_LIMIT = 500;

export type SarifLevel = 'error' | 'warning' | 'note';

export interface SarifMessage {
  text: string;
  markdown?: string;
}

export interface SarifRule {
  id: string;
  name: string;
  shortDescription: SarifMessage;
  fullDescription: SarifMessage;
  help: SarifMessage;
  helpUri: string;
  defaultConfiguration: { level: SarifLevel };
  properties: { tags: string[] };
}

export interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string; uriBaseId: string };
    region?: { startLine: number; startColumn?: number };
  };
  logicalLocations: { name: string; fullyQualifiedName: string; kind: string }[];
}

export interface SarifResult {
  ruleId: string;
  ruleIndex?: number;
  level: SarifLevel;
  message: SarifMessage;
  locations: SarifLocation[];
  partialFingerprints?: Record<string, string>;
  suppressions?: { kind: 'external'; status: 'accepted'; justification: string }[];
  properties: Record<string, unknown>;
}

export interface SarifLog {
  $schema: string;
  version: '2.1.0';
  runs: {
    tool: {
      driver: { name: string; version: string; semanticVersion?: string; informationUri: string; rules: SarifRule[] };
    };
    originalUriBaseIds: Record<string, { uri: string; description?: SarifMessage }>;
    invocations: {
      executionSuccessful: boolean;
      exitCode?: number;
      startTimeUtc?: string;
      endTimeUtc?: string;
      workingDirectory?: { uri: string };
    }[];
    columnKind: 'utf16CodeUnits';
    results: SarifResult[];
    properties?: Record<string, unknown>;
  }[];
}

export function sarifLevel(severity: Severity | undefined): SarifLevel {
  return severity === 'error' ? 'error' : severity === 'warning' ? 'warning' : 'note';
}

/** A file URL for a directory, always ending with a slash (SARIF requires it for base URIs). */
export function directoryUri(dir: string): string {
  const href = pathToFileURL(dir).href;
  return href.endsWith('/') ? href : `${href}/`;
}

/** Every issue code as a SARIF rule, in registry order. */
export function sarifRules(): SarifRule[] {
  return [...ISSUES.values()].map((definition) => {
    const url = docsUrl(definition.code);
    const fixes = suggestionsFor(definition.code);
    const text = [definition.description, fixes.length > 0 ? `How to fix:\n${fixes.map((fix) => `- ${fix}`).join('\n')}` : '', url]
      .filter(Boolean)
      .join('\n\n');
    const markdown = [
      escapeHtml(definition.description),
      fixes.length > 0 ? `**How to fix**\n\n${fixes.map((fix) => `- ${escapeHtml(fix)}`).join('\n')}` : '',
      `[Documentation](${url})`,
    ]
      .filter(Boolean)
      .join('\n\n');
    return {
      id: definition.code,
      name: pascalCase(definition.name),
      shortDescription: { text: definition.title },
      fullDescription: { text: definition.description },
      help: { text, markdown },
      helpUri: url,
      defaultConfiguration: { level: sarifLevel(definition.severity) },
      properties: { tags: ['hydration', 'react', codeGroup(definition.code)].filter((tag): tag is string => Boolean(tag)) },
    };
  });
}

function scopeOf(issue: Issue): string {
  const parts = [issue.scenario ? `scenario ${issue.scenario}` : '', issue.mode ? `${issue.mode} build` : ''].filter(Boolean);
  return parts.length > 0 ? ` (${parts.join(', ')})` : '';
}

function messageText(issue: Issue, fallback: string | undefined): string {
  const lines = [`${issue.title ?? issue.code} on ${issuePath(issue)}${scopeOf(issue)}.`];
  if (issue.message) lines.push(truncate(issue.message, 2 * VALUE_LIMIT));
  if (issue.selector) lines.push(`Element: ${truncate(issue.selector, VALUE_LIMIT)}${issue.attribute ? ` (attribute ${issue.attribute})` : ''}`);
  if (!issue.message && (issue.server !== undefined || issue.client !== undefined)) {
    lines.push(`Server: ${quoteValue(issue.server, VALUE_LIMIT)}`, `Client: ${quoteValue(issue.client, VALUE_LIMIT)}`);
  }
  const cause = causeText(issue);
  if (cause) lines.push(`Likely cause: ${cause}.`);
  if (issue.suggestions?.[0]) lines.push(`Fix: ${issue.suggestions[0]}`);
  if (fallback) {
    const source = locationText(issue);
    const why = source ? `The source (${source}) is outside the repository.` : issue.sourceUnavailableReason ? `No source location: ${issue.sourceUnavailableReason}` : 'No source location was found.';
    lines.push(`${why} This result is attached to ${fallback}.`);
  }
  return lines.join('\n');
}

function resultFor(
  issue: Issue,
  ruleIndex: Map<string, number>,
  paths: { rootDir: string; repoRoot: string; fallback: string },
): SarifResult {
  const file = relativeToBase(issue.source?.file, paths.rootDir, paths.repoRoot);
  const physicalLocation: SarifLocation['physicalLocation'] = {
    artifactLocation: { uri: file ?? paths.fallback, uriBaseId: SRCROOT },
  };
  if (file) {
    const startLine = positiveInt(issue.source?.line);
    if (startLine) {
      const startColumn = positiveInt(issue.source?.column);
      physicalLocation.region = startColumn ? { startLine, startColumn } : { startLine };
    }
  } else {
    physicalLocation.region = { startLine: 1 };
  }
  const pattern = issue.route?.pattern ?? issuePath(issue);
  const scope = [issue.scenario, issue.mode].filter(Boolean).join('/');
  const code = String(issue.code);

  const properties: Record<string, unknown> = {
    url: issue.route?.url,
    routePattern: issue.route?.pattern,
    scenario: issue.scenario,
    mode: issue.mode,
    stage: issue.stage,
    confidence: issue.confidence,
    selector: issue.selector,
    attribute: issue.attribute,
    component: issue.component,
    server: typeof issue.server === 'string' ? truncate(issue.server, VALUE_LIMIT) : issue.server,
    client: typeof issue.client === 'string' ? truncate(issue.client, VALUE_LIMIT) : issue.client,
    causeId: issue.cause?.id,
    causeConfidence: issue.cause?.confidence,
    source: file ? undefined : locationText(issue),
    sourceUnavailableReason: file ? undefined : issue.sourceUnavailableReason,
    docsUrl: issue.docsUrl,
  };
  for (const key of Object.keys(properties)) if (properties[key] === undefined) delete properties[key];

  const index = ruleIndex.get(code);
  const suppression = issue.ignored
    ? `${issue.ignored.reason || 'Ignored by the hydration-proof configuration'}${issue.ignored.rule ? ` (${issue.ignored.rule})` : ''}`
    : undefined;
  return {
    ruleId: code,
    ...(index !== undefined ? { ruleIndex: index } : {}),
    level: sarifLevel(issue.severity),
    message: { text: messageText(issue, file ? undefined : paths.fallback) },
    locations: [
      {
        physicalLocation,
        logicalLocations: [{ name: pattern, fullyQualifiedName: scope ? `${scope}:${pattern}` : pattern, kind: 'resource' }],
      },
    ],
    ...(typeof issue.fingerprint === 'string' && issue.fingerprint !== ''
      ? { partialFingerprints: { [SARIF_FINGERPRINT_KEY]: issue.fingerprint } }
      : {}),
    ...(suppression !== undefined ? { suppressions: [{ kind: 'external', status: 'accepted', justification: suppression }] } : {}),
    properties,
  };
}

export function renderSarif(
  report: Report,
  context: { config: ResolvedConfig | undefined; exitCode: number },
): SarifLog {
  const rootDir = rootDirOf(context.config);
  const repoRoot = findRepoRoot(rootDir);
  const paths = { rootDir, repoRoot, fallback: fallbackPath(context.config, repoRoot) };
  const rules = sarifRules();
  const ruleIndex = new Map(rules.map((rule, index) => [rule.id, index]));
  const issues = (Array.isArray(report?.issues) ? report.issues : []).filter(Boolean);
  // Ignored issues go last, the rest by importance.
  const compare = byImportance(report);
  const ordered = [...issues].sort((a, b) => Number(Boolean(a.ignored)) - Number(Boolean(b.ignored)) || compare(a, b));

  const version = typeof report?.tool?.version === 'string' ? report.tool.version : '0.0.0';
  const invocation: SarifLog['runs'][number]['invocations'][number] = {
    executionSuccessful: !UNSUCCESSFUL_EXIT_CODES.has(context.exitCode),
    exitCode: context.exitCode,
  };
  const started = validDate(report?.run?.startedAt);
  const finished = validDate(report?.run?.finishedAt);
  if (started) invocation.startTimeUtc = started.toISOString();
  if (finished) invocation.endTimeUtc = finished.toISOString();
  invocation.workingDirectory = { uri: directoryUri(rootDir) };

  const run: SarifLog['runs'][number] = {
    tool: {
      driver: {
        name: 'hydration-proof',
        version,
        ...(/^\d+\.\d+\.\d+/.test(version) ? { semanticVersion: version } : {}),
        informationUri: INFORMATION_URI,
        rules,
      },
    },
    originalUriBaseIds: { [SRCROOT]: { uri: directoryUri(repoRoot), description: { text: 'The repository root.' } } },
    invocations: [invocation],
    columnKind: 'utf16CodeUnits',
    results: ordered.map((issue) => resultFor(issue, ruleIndex, paths)),
  };
  if (report?.summary) run.properties = { summary: report.summary };
  return { $schema: SARIF_SCHEMA, version: '2.1.0', runs: [run] };
}

export function sarifReporter(fileName = 'report.sarif'): Reporter {
  return {
    name: 'sarif',
    onEnd(report, context) {
      const dir = outputDirOf(context.config);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, fileName);
      writeFileSync(file, jsonText(renderSarif(report, context)));
      return [file];
    },
  };
}
