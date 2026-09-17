import { s, toJsonSchema, validate, type JsonSchema, type Schema, type SchemaIssue } from './schema-dsl.ts';

// Runtime mirror of `types.ts`. A unit test validates a fully populated
// config against this schema, so the two cannot drift apart silently.

const ready: Schema = s.object(
  {
    quietMs: s.number({ integer: true, minimum: 0, description: 'Quiet time before the page counts as settled.' }),
    timeout: s.number({ integer: true, minimum: 1, description: 'Maximum time per page (ms).' }),
    hydrationTimeout: s.number({ integer: true, minimum: 1, description: 'Maximum time for hydration to finish (ms).' }),
    selector: s.string({ description: 'Selector that must exist before the final snapshot.' }),
    function: s.string({ description: 'Page function source that must return truthy.' }),
  },
  'When a page counts as ready.',
);

const route: Schema = s.object(
  {
    path: s.string({ description: 'Path, e.g. /pricing.' }),
    expectRedirect: s.string({ description: 'Path the route must redirect to.' }),
    pattern: s.string({ description: 'Route pattern used for grouping.' }),
    expectStatus: s.array(s.number({ integer: true, minimum: 100, maximum: 599 })),
    scenarios: s.array(s.string()),
    ready,
  },
  undefined,
  ['path'],
);

const cookie: Schema = s.object(
  {
    name: s.string(),
    value: s.string(),
    domain: s.string(),
    path: s.string(),
    httpOnly: s.boolean(),
    secure: s.boolean(),
    sameSite: s.enum(['Strict', 'Lax', 'None']),
  },
  undefined,
  ['name', 'value'],
);

const scenario: Schema = s.object(
  {
    name: s.string({ description: 'Scenario name shown in reports.' }),
    locale: s.string(),
    timezoneId: s.string(),
    colorScheme: s.enum(['light', 'dark', 'no-preference']),
    reducedMotion: s.enum(['reduce', 'no-preference']),
    viewport: s.union([
      s.object({ width: s.number({ integer: true, minimum: 1 }), height: s.number({ integer: true, minimum: 1 }) }, undefined, ['width', 'height']),
      s.enum(['mobile', 'tablet', 'desktop']),
    ]),
    userAgent: s.string(),
    storageState: s.string({ description: 'Playwright storage state file.' }),
    cookies: s.array(cookie),
    headers: s.record(s.string()),
    localStorage: s.record(s.string()),
    sessionStorage: s.record(s.string()),
    initScripts: s.array(s.string()),
    login: s.fn('Signs in once before the scenario is tested.'),
    mocks: s.array(
      s.object(
        {
          url: s.union([s.string(), s.regexp()]),
          method: s.string(),
          status: s.number({ integer: true, minimum: 100, maximum: 599 }),
          headers: s.record(s.string()),
          body: s.any('Response body; objects are sent as JSON.'),
        },
        undefined,
        ['url'],
      ),
    ),
    include: s.array(s.string()),
    exclude: s.array(s.string()),
  },
  'A browser environment routes are tested in.',
  ['name'],
);

const ignoreRule: Schema = s.object(
  {
    code: s.string(),
    route: s.string(),
    fingerprint: s.string(),
    selector: s.string(),
    reason: s.string(),
    expires: s.string({ description: 'ISO date (YYYY-MM-DD).' }),
  },
  undefined,
  ['reason'],
);

export const configSchema: Schema = s.object(
  {
    $schema: s.string(),
    configVersion: s.literal(1),
    adapter: s.enum(['auto', 'next', 'none'], 'Framework adapter.'),
    server: s.object({
      command: s.string({ description: 'Start command; {port} is replaced with the port.' }),
      build: s.union([s.string(), s.literal(false)]),
      buildWhen: s.enum(['always', 'if-missing', 'never']),
      url: s.string({ description: 'URL of an app that is already running.' }),
      port: s.number({ integer: true, minimum: 1, maximum: 65535 }),
      cwd: s.string(),
      env: s.record(s.string()),
      timeout: s.number({ integer: true, minimum: 1 }),
      reuseExisting: s.boolean(),
      mode: s.enum(['production', 'development', 'both']),
      devCommand: s.string({ description: 'Dev server command used with mode "both".' }),
    }),
    routes: s.object({
      paths: s.array(s.union([s.string(), route])),
      dynamic: s.record(s.array(s.string())),
      include: s.array(s.string()),
      exclude: s.array(s.string()),
      discover: s.boolean(),
      query: s.record(s.array(s.string())),
      sitemap: s.union([s.boolean(), s.string()]),
      crawl: s.union([
        s.boolean(),
        s.object({ depth: s.number({ integer: true, minimum: 0, maximum: 10 }), limit: s.number({ integer: true, minimum: 1 }) }),
      ]),
      notFound: s.boolean(),
      manifestExamples: s.number({ integer: true, minimum: 0 }),
    }),
    scenarios: s.array(scenario),
    ready,
    browser: s.object({
      name: s.enum(['chromium', 'firefox', 'webkit']),
      channel: s.string(),
      headless: s.boolean(),
    }),
    workers: s.number({ integer: true, minimum: 1, maximum: 64 }),
    retries: s.number({ integer: true, minimum: 0, maximum: 10 }),
    checks: s.object({
      reactErrors: s.boolean(),
      domDiff: s.boolean(),
      propsAudit: s.boolean(),
      invalidHtml: s.boolean(),
      externalChanges: s.boolean(),
      suppressedWarnings: s.enum(['off', 'info', 'strict']),
    }),
    ignore: s.object({
      selectors: s.array(s.string()),
      attributes: s.array(s.union([s.string(), s.regexp()])),
      textPatterns: s.array(s.regexp()),
      issues: s.array(ignoreRule),
    }),
    reporters: s.array(s.enum(['list', 'json', 'html', 'junit', 'sarif', 'github', 'gitlab'])),
    outputDir: s.string(),
    screenshots: s.enum(['failures', 'all', 'off']),
    hooks: s.object({ setup: s.fn(), teardown: s.fn() }),
    cache: s.boolean(),
    ci: s.object({
      failOn: s.enum(['error', 'warning', 'info', 'never']),
      maxWarnings: s.number({ integer: true, minimum: 0 }),
      baseline: s.string(),
      newIssuesOnly: s.boolean(),
    }),
  },
  'hydration-proof configuration',
);

export function validateConfig(value: unknown): SchemaIssue[] {
  return validate(value, configSchema);
}

export function configJsonSchema(): JsonSchema {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://hydration.jscrate.dev/schema/config.json',
    title: 'hydration-proof configuration',
    ...toJsonSchema(configSchema),
  };
}
