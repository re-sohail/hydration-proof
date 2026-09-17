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
    mode: 'production',
  },
  routes: {
    paths: ['/', { path: '/404-page', pattern: '/404-page', expectStatus: [404], scenarios: ['default'], ready: { quietMs: 10 } }],
    dynamic: { '/products/[id]': ['1', '42'] },
    include: ['/**'],
    exclude: ['/api/**'],
    discover: true,
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
  },
  ignore: {
    selectors: ['.ad'],
    attributes: ['data-reactroot', /^data-test/],
    textPatterns: [/\d+/],
    issues: [{ code: 'HP1004', route: '/blog/**', fingerprint: 'abc', selector: '#x', reason: 'known', expires: '2030-01-01' }],
  },
  reporters: ['list', 'json'],
  outputDir: 'out',
  ci: { failOn: 'warning', maxWarnings: 3, baseline: 'baseline.json', newIssuesOnly: true },
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
    const json = JSON.parse(JSON.stringify({ ...everything, ignore: { selectors: ['.ad'], attributes: ['x'] } }));
    expect(validate(json), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ unknown: true })).toBe(false);
    expect(validate({ workers: 0 })).toBe(false);
  });
});
