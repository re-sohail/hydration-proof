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
    navigateFrom: s.string({ description: 'Page the navigation check starts from.' }),
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

const viewport: Schema = s.union([
  s.object({ width: s.number({ integer: true, minimum: 1 }), height: s.number({ integer: true, minimum: 1 }) }, undefined, ['width', 'height']),
  s.enum(['mobile', 'tablet', 'desktop']),
]);

const network: Schema = s.union([
  s.enum(['fast', 'fast-3g', 'slow-3g']),
  s.object(
    {
      name: s.string(),
      downloadKbps: s.number({ minimum: 1 }),
      uploadKbps: s.number({ minimum: 1 }),
      latencyMs: s.number({ minimum: 0 }),
    },
    'Custom network throttling.',
    ['downloadKbps', 'uploadKbps', 'latencyMs'],
  ),
]);

const browserName: Schema = s.enum(['chromium', 'firefox', 'webkit']);
const cpu: Schema = s.number({ minimum: 1, maximum: 20, description: 'CPU slowdown factor (Chromium only).' });
const cacheState: Schema = s.enum(['cold', 'warm']);
const probeFactor: Schema = s.enum(['time', 'random', 'locale', 'timezone', 'theme', 'viewport', 'storage']);

const scenario: Schema = s.object(
  {
    name: s.string({ description: 'Scenario name shown in reports.' }),
    locale: s.string(),
    timezoneId: s.string(),
    colorScheme: s.enum(['light', 'dark', 'no-preference']),
    reducedMotion: s.enum(['reduce', 'no-preference']),
    viewport,
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
    query: s.record(s.string()),
    browser: browserName,
    network,
    cpu,
    cache: cacheState,
    clock: s.union([s.string(), s.number()]),
    randomSeed: s.number({ integer: true }),
  },
  'A browser environment routes are tested in.',
  ['name'],
);

const variant: Schema = s.object(
  {
    cookies: s.array(cookie),
    headers: s.record(s.string()),
    localStorage: s.record(s.string()),
    sessionStorage: s.record(s.string()),
    initScripts: s.array(s.string()),
    query: s.record(s.string()),
  },
  'Scenario settings for one value of a custom axis.',
);

const matrix: Schema = s.object(
  {
    locale: s.array(s.string()),
    timezoneId: s.array(s.string()),
    colorScheme: s.array(s.enum(['light', 'dark', 'no-preference'])),
    reducedMotion: s.array(s.enum(['reduce', 'no-preference'])),
    viewport: s.array(viewport),
    browser: s.array(browserName),
    network: s.array(network),
    cpu: s.array(cpu),
    cache: s.array(cacheState),
    axes: s.record(s.record(variant), 'Custom axes: axis name → value name → scenario settings.'),
    strategy: s.enum(['pairwise', 'full', 'sample']),
    max: s.number({ integer: true, minimum: 1, maximum: 1000 }),
    seed: s.number({ integer: true }),
    scenarios: s.array(s.string()),
  },
  'Test scenarios in combinations of environments.',
);

const limitFields = {
  error: s.number({ integer: true, minimum: 0 }),
  warning: s.number({ integer: true, minimum: 0 }),
  info: s.number({ integer: true, minimum: 0 }),
};

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
    adapter: s.union(
      [
        s.string({ description: 'auto, next, react-router, remix, astro, vite, node, none, or the name of a plugin adapter.' }),
        s.object(
          {
            name: s.string(),
            detect: s.fn(),
            commands: s.fn(),
            discoverRoutes: s.fn(),
            markers: s.array(s.any()),
            ignoreAttributes: s.array(s.union([s.string(), s.regexp()])),
            elementAttributes: s.record(s.array(s.union([s.string(), s.regexp()]))),
            devHost: s.string(),
            navigation: s.object({ navigate: s.string(), prefetch: s.string() }, undefined, ['navigate']),
            notFound: s.boolean(),
            pagesWithoutReact: s.boolean(),
            sourcePath: s.fn(),
          },
          'An adapter from defineAdapter().',
          ['name', 'detect', 'commands', 'markers'],
        ),
      ],
      'Framework adapter.',
    ),
    plugins: s.array(
      s.object(
        {
          name: s.string(),
          adapters: s.array(s.any()),
          normalizers: s.array(s.object({ name: s.string(), match: s.fn() }, undefined, ['name', 'match'])),
          ignoreAttributes: s.array(s.union([s.string(), s.regexp()])),
          detectors: s.array(s.object({ name: s.string(), detect: s.fn() }, undefined, ['name', 'detect'])),
          reporters: s.array(s.any()),
          routes: s.array(s.object({ name: s.string(), routes: s.fn() }, undefined, ['name', 'routes'])),
        },
        'A plugin from definePlugin().',
        ['name'],
      ),
    ),
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
      name: browserName,
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
      interactions: s.boolean('Type, click, focus and scroll while the page loads.'),
      navigation: s.union([
        s.boolean(),
        s.object({
          from: s.string({ description: 'Page to navigate from.' }),
          prefetch: s.boolean(),
          maxRoutes: s.number({ integer: true, minimum: 1 }),
        }),
      ]),
    }),
    interactions: s.array(
      s.object(
        {
          route: s.string({ description: 'Route glob.' }),
          name: s.string(),
          when: s.enum(['before-hydration', 'after-hydration']),
          scenarios: s.array(s.string()),
          steps: s.fn('async ({ page, baseUrl, url }) => { ... }'),
        },
        'A custom interaction.',
        ['route', 'steps'],
      ),
    ),
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
    matrix,
    probes: s.union([
      s.boolean(),
      s.object({ factors: s.array(probeFactor), maxPages: s.number({ integer: true, minimum: 1, maximum: 100 }) }),
    ]),
    repeat: s.number({ integer: true, minimum: 1, maximum: 100 }),
    ci: s.object({
      failOn: s.enum(['error', 'warning', 'info', 'never']),
      maxWarnings: s.number({ integer: true, minimum: 0 }),
      baseline: s.string(),
      newIssuesOnly: s.boolean(),
      budget: s.object(
        {
          ...limitFields,
          routes: s.record(s.object(limitFields)),
          codes: s.record(s.number({ integer: true, minimum: 0 })),
        },
        'How many findings are allowed before the run fails.',
      ),
      history: s.union([s.boolean(), s.string()]),
    }),
    owners: s.object({
      routes: s.record(s.union([s.string(), s.array(s.string())])),
      codeowners: s.union([s.boolean(), s.string()]),
    }),
    redact: s.union([
      s.boolean(),
      s.object({ builtIn: s.boolean(), patterns: s.array(s.regexp()), selectors: s.array(s.string()) }),
    ]),
    projects: s.array(
      s.union([
        s.string(),
        s.object({ path: s.string(), name: s.string(), config: s.string() }, undefined, ['path']),
      ]),
    ),
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
