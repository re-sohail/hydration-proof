import Ajv from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import { configJsonSchema, validateConfig } from '../../../src/config/schema.ts';
import type { HydrationProofConfig } from '../../../src/config/types.ts';

// Every option set: if a key is added to types.ts but not to the schema,
// validation of this object fails.
const everything: Required<HydrationProofConfig> = {
  $schema: './node_modules/hydration-proof/schema/config.json',
  configVersion: 1,
  adapter: 'next',
  server: {
    command: 'npm start -- --port {port}',
    build: 'npm run build',
    buildWhen: 'if-missing',
    url: 'http://localhost:3000',
    port: 4000,
    cwd: 'apps/web',
    env: { FOO: 'bar' },
    timeout: 60_000,
    reuseExisting: true,
    mode: 'both',
    devCommand: 'npm run dev -- --port {port}',
  },
  routes: {
    paths: [
      '/',
      { path: '/404-page', pattern: '/404-page', expectStatus: [404], scenarios: ['default'], ready: { quietMs: 10 } },
      { path: '/account', expectRedirect: '/login', navigateFrom: '/home' },
    ],
    dynamic: { '/products/[id]': ['1', '42'] },
    include: ['/**'],
    exclude: ['/api/**'],
    discover: true,
    query: { '/search': ['?q=shoes'] },
    sitemap: '/sitemap-pages.xml',
    crawl: { depth: 1, limit: 10 },
    notFound: false,
    manifestExamples: 2,
  },
  scenarios: [
    {
      name: 'everything',
      locale: 'de-DE',
      timezoneId: 'Europe/Berlin',
      colorScheme: 'dark',
      reducedMotion: 'reduce',
      viewport: 'mobile',
      userAgent: 'test',
      storageState: 'auth.json',
      cookies: [{ name: 'a', value: 'b', domain: 'example.com', path: '/', httpOnly: true, secure: true, sameSite: 'Lax' }],
      headers: { authorization: 'Bearer x' },
      localStorage: { theme: 'dark' },
      sessionStorage: { tab: '1' },
      initScripts: ['window.x = 1'],
      login: async ({ page, baseUrl }) => {
        await page.goto(`${baseUrl}/login`);
      },
      mocks: [
        { url: '**/api/user', method: 'GET', status: 200, headers: { 'x-mock': '1' }, body: { name: 'Ada' } },
        { url: /\/api\/flags/, body: 'on' },
      ],
      include: ['/account/**'],
      exclude: ['/account/billing'],
      query: { currency: 'EUR' },
      browser: 'webkit',
      network: { name: 'hotel wifi', downloadKbps: 800, uploadKbps: 200, latencyMs: 250 },
      cpu: 1,
      cache: 'warm',
      clock: '2026-01-01T00:00:00Z',
      randomSeed: 42,
    },
    { name: 'sized', viewport: { width: 100, height: 200 } },
  ],
  ready: { quietMs: 100, timeout: 1000, hydrationTimeout: 500, selector: '#app', function: '() => true' },
  browser: { name: 'firefox', channel: 'chrome', headless: false },
  workers: 2,
  retries: 1,
  checks: {
    reactErrors: true,
    domDiff: true,
    propsAudit: true,
    invalidHtml: true,
    externalChanges: true,
    suppressedWarnings: 'strict',
    interactions: true,
    navigation: { from: '/', prefetch: false, maxRoutes: 5 },
  },
  ignore: {
    selectors: ['.ad'],
    attributes: ['data-reactroot', /^data-test/],
    textPatterns: [/\d+/],
    issues: [{ code: 'HP1004', route: '/blog/**', fingerprint: 'abc', selector: '#x', reason: 'known', expires: '2030-01-01' }],
  },
  reporters: ['list', 'json'],
  outputDir: 'out',
  screenshots: 'all',
  ci: { failOn: 'warning', maxWarnings: 3, baseline: 'baseline.json', newIssuesOnly: true },
  hooks: {
    setup: async () => async () => {},
    teardown: () => {},
  },
  cache: false,
  matrix: {
    locale: ['en-US', 'de-DE'],
    timezoneId: ['UTC', 'Asia/Karachi'],
    colorScheme: ['light', 'dark'],
    reducedMotion: ['no-preference', 'reduce'],
    viewport: ['desktop', { width: 390, height: 844 }],
    browser: ['chromium', 'firefox'],
    network: ['fast', 'slow-3g'],
    cpu: [1, 4],
    cache: ['cold', 'warm'],
    axes: { tenant: { acme: { headers: { 'x-tenant': 'acme' } }, globex: { query: { tenant: 'globex' } } } },
    strategy: 'pairwise',
    max: 20,
    seed: 3,
    scenarios: ['everything'],
  },
  probes: { factors: ['time', 'random', 'locale', 'timezone', 'theme', 'viewport', 'storage'], maxPages: 3 },
  repeat: 2,
  interactions: [
    {
      route: '/checkout',
      name: 'continue',
      when: 'before-hydration',
      scenarios: ['everything'],
      steps: async ({ page }) => {
        await page.click('#continue');
      },
    },
  ],
};

describe('config schema', () => {
  it('accepts every documented option', () => {
    expect(validateConfig(everything)).toEqual([]);
  });

  it('accepts an empty config', () => {
    expect(validateConfig({})).toEqual([]);
  });

  it('reports unknown keys with a suggestion', () => {
    expect(validateConfig({ scenarioz: [] })).toEqual([
      { path: 'scenarioz', message: 'is not a known option. Did you mean "scenarios"?' },
    ]);
    expect(validateConfig({ server: { comand: 'x' } })[0]?.message).toContain('Did you mean "command"?');
  });

  it('reports wrong types with a path', () => {
    expect(validateConfig({ workers: 'four' })).toEqual([{ path: 'workers', message: 'must be an integer, got string "four"' }]);
    expect(validateConfig({ scenarios: [{ name: 'x', colorScheme: 'blue' }] })).toEqual([
      { path: 'scenarios[0].colorScheme', message: 'must be "light" | "dark" | "no-preference", got "blue"' },
    ]);
    expect(validateConfig({ scenarios: [{ locale: 'en' }] })).toEqual([{ path: 'scenarios[0].name', message: 'is required' }]);
  });

  it('explains union failures from the closest branch', () => {
    expect(validateConfig({ scenarios: [{ name: 'x', viewport: { width: 10 } }] })).toEqual([
      { path: 'scenarios[0].viewport.height', message: 'is required' },
    ]);
  });

  it('emits a valid JSON Schema that agrees with the validator on JSON configs', () => {
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(configJsonSchema());
    // RegExps (and functions) have no JSON form.
    const scenarios = everything.scenarios.map((scenario) => ({ ...scenario, mocks: scenario.mocks?.filter((mock) => typeof mock.url === 'string') }));
    const { interactions: _functionsOnly, ...rest } = everything;
    const json = JSON.parse(JSON.stringify({ ...rest, scenarios, ignore: { selectors: ['.ad'], attributes: ['x'] } }));
    expect(validate(json), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ unknown: true })).toBe(false);
    expect(validate({ workers: 0 })).toBe(false);
  });
});
