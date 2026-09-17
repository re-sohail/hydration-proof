import { s, toJsonSchema, type JsonSchema, type Schema } from '../config/schema-dsl.ts';
import { ISSUES } from '../issues/registry.ts';
import { REPORT_SCHEMA_VERSION } from './model.ts';

// JSON Schema of report.json, mirroring model.ts.

const severity = s.enum(['error', 'warning', 'info']);
const nullableString: Schema = s.union([s.string(), s.literal('__null__')]);
const routeRef = s.object({ url: s.string(), pattern: s.string() }, undefined, ['url', 'pattern']);
const counts = s.object({ error: s.number({ integer: true }), warning: s.number({ integer: true }), info: s.number({ integer: true }) }, undefined, [
  'error',
  'warning',
  'info',
]);

const issue = s.object(
  {
    fingerprint: s.string(),
    code: s.enum([...ISSUES.keys()]),
    title: s.string(),
    severity,
    confidence: s.number({ minimum: 0, maximum: 1 }),
    message: s.string(),
    route: routeRef,
    scenario: s.string(),
    stage: s.enum(['raw', 'parsed', 'pre-hydration', 'hydration', 'post-effect', 'stable', 'runtime']),
    selector: s.string(),
    domPath: s.array(s.string()),
    attribute: s.string(),
    server: nullableString,
    client: nullableString,
    component: s.string(),
    componentStack: s.string(),
    source: s.object(
      { file: s.string(), line: s.number({ integer: true }), column: s.number({ integer: true }), frame: s.string() },
      undefined,
      ['file', 'line'],
    ),
    sourceUnavailableReason: s.string(),
    cause: s.object(
      { id: s.string(), title: s.string(), confidence: s.number(), docsUrl: s.string(), proven: s.boolean() },
      undefined,
      ['id', 'title', 'confidence'],
    ),
    evidence: s.array(
      s.object(
        {
          kind: s.enum(['react-error', 'react-warning', 'console', 'page-error', 'dom-change', 'mutation', 'http', 'markup', 'note']),
          message: s.string(),
          detail: s.string(),
        },
        undefined,
        ['kind', 'message'],
      ),
    ),
    suggestions: s.array(s.string()),
    docsUrl: s.string(),
    ignored: s.object({ reason: s.string(), rule: s.string() }, undefined, ['reason', 'rule']),
    suppressed: s.boolean(),
    excerpt: s.object({ server: s.string(), client: s.string() }),
    mode: s.enum(['production', 'development']),
    occurrences: s.object({ seen: s.number({ integer: true }), runs: s.number({ integer: true }) }, undefined, ['seen', 'runs']),
    flaky: s.boolean(),
    onlyIn: s.array(s.object({ axis: s.string(), values: s.array(s.string()) }, undefined, ['axis', 'values'])),
    probes: s.array(
      s.object(
        { factor: s.string(), result: s.enum(['changes', 'stable', 'inconclusive']), detail: s.string() },
        undefined,
        ['factor', 'result'],
      ),
    ),
    baseline: s.object({ firstSeen: s.string(), reason: s.string(), expires: s.string() }, undefined, ['firstSeen']),
    new: s.boolean(),
    owners: s.array(s.string()),
    project: s.string(),
  },
  'One finding.',
  ['fingerprint', 'code', 'title', 'severity', 'confidence', 'message', 'route', 'scenario', 'stage', 'evidence', 'suggestions', 'docsUrl'],
);

const page = s.object(
  {
    id: s.string(),
    route: routeRef,
    scenario: s.string(),
    url: s.string(),
    finalUrl: s.string(),
    status: s.enum(['passed', 'warning', 'failed', 'error']),
    outcome: s.string(),
    http: s.object(
      {
        status: s.number({ integer: true }),
        redirects: s.array(s.object({ url: s.string(), status: s.number({ integer: true }) }, undefined, ['url', 'status'])),
      },
      undefined,
      ['status', 'redirects'],
    ),
    react: s.object(
      {
        version: s.string(),
        build: s.enum(['production', 'development', 'unknown']),
        roots: s.array(s.object({ selector: s.string(), mode: s.enum(['hydrate', 'client']) }, undefined, ['selector', 'mode'])),
      },
      undefined,
      ['version', 'build', 'roots'],
    ),
    timings: s.object(
      { navigation: s.number(), hydration: s.number(), total: s.number() },
      undefined,
      ['navigation', 'total'],
    ),
    issues: s.array(s.string()),
    counts,
    mode: s.enum(['production', 'development']),
    serverLogs: s.array(s.string()),
    source: s.enum(['config', 'discovered', 'manifest', 'sitemap', 'crawl', 'not-found', 'plugin']),
    baseScenario: s.string(),
    environment: s.record(s.string()),
    runs: s.number({ integer: true }),
    flakiness: s.number({ minimum: 0, maximum: 1 }),
    project: s.string(),
    timeline: s.array(
      s.object(
        {
          time: s.number(),
          kind: s.enum(['renderer', 'commit', 'error', 'mutation', 'stream', 'effects', 'snapshot', 'network', 'navigation', 'interaction']),
          label: s.string(),
          detail: s.string(),
        },
        undefined,
        ['time', 'kind', 'label'],
      ),
    ),
    screenshots: s.object(
      {
        hydrated: s.string(),
        server: s.string(),
        width: s.number(),
        height: s.number(),
        boxes: s.array(
          s.object(
            { fingerprint: s.string(), x: s.number(), y: s.number(), width: s.number(), height: s.number() },
            undefined,
            ['fingerprint', 'x', 'y', 'width', 'height'],
          ),
        ),
      },
      undefined,
      ['width', 'height', 'boxes'],
    ),
  },
  'One route tested in one scenario.',
  ['id', 'route', 'scenario', 'url', 'finalUrl', 'status', 'outcome', 'timings', 'issues', 'counts'],
);

export const reportSchema: Schema = s.object(
  {
    schemaVersion: s.literal(REPORT_SCHEMA_VERSION),
    tool: s.object({ name: s.literal('hydration-proof'), version: s.string() }, undefined, ['name', 'version']),
    run: s.object(
      {
        startedAt: s.string(),
        finishedAt: s.string(),
        durationMs: s.number(),
        cwd: s.string(),
        node: s.string(),
        platform: s.string(),
        playwright: s.string(),
        browsers: s.array(s.string()),
        mode: s.string(),
        baseUrl: s.string(),
        ci: s.string(),
        commit: s.string(),
        branch: s.string(),
        shards: s.array(s.string()),
      },
      undefined,
      ['startedAt', 'finishedAt', 'durationMs', 'cwd', 'node', 'platform', 'playwright', 'browsers', 'mode'],
    ),
    summary: s.object(
      {
        pages: s.number({ integer: true }),
        routes: s.number({ integer: true }),
        passed: s.number({ integer: true }),
        warnings: s.number({ integer: true }),
        failed: s.number({ integer: true }),
        errored: s.number({ integer: true }),
        issues: counts,
        ignored: s.number({ integer: true }),
        flaky: s.number({ integer: true }),
        new: s.number({ integer: true }),
        known: s.number({ integer: true }),
        redacted: s.record(s.number({ integer: true })),
      },
      undefined,
      ['pages', 'routes', 'passed', 'warnings', 'failed', 'errored', 'issues', 'ignored'],
    ),
    pages: s.array(page),
    issues: s.array(issue),
    history: s.array(
      s.object(
        {
          date: s.string(),
          commit: s.string(),
          branch: s.string(),
          durationMs: s.number(),
          pages: s.number({ integer: true }),
          failed: s.number({ integer: true }),
          issues: counts,
          codes: s.record(s.number({ integer: true })),
          fingerprints: s.array(s.string()),
        },
        undefined,
        ['date', 'durationMs', 'pages', 'failed', 'issues', 'codes', 'fingerprints'],
      ),
    ),
  },
  'hydration-proof report',
  ['schemaVersion', 'tool', 'run', 'summary', 'pages', 'issues'],
);

export function reportJsonSchema(): JsonSchema {
  const schema = JSON.parse(
    JSON.stringify(toJsonSchema(reportSchema)).replaceAll('{"const":"__null__"}', '{"type":"null"}'),
  ) as JsonSchema;
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://hydration.jscrate.dev/schema/report.json',
    title: 'hydration-proof report',
    ...schema,
  };
}
