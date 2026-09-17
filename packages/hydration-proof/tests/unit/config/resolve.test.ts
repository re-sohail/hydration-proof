import { describe, expect, it } from 'vitest';
import { ConfigError } from '../../../src/config/load.ts';
import { DEFAULT_IGNORE_SELECTOR, isCI, resolveConfig } from '../../../src/config/resolve.ts';

const base = { rootDir: '/project', env: {} };

describe('resolveConfig', () => {
  it('fills defaults', () => {
    const config = resolveConfig({}, base);
    expect(config.scenarios).toHaveLength(1);
    expect(config.scenarios[0]?.name).toBe('default');
    expect(config.scenarios[0]?.context.colorScheme).toBe('light');
    expect(config.server.mode).toBe('production');
    expect(config.server.buildWhen).toBe('if-missing');
    expect(config.server.reuseExisting).toBe(true);
    expect(config.retries).toBe(0);
    expect(config.routes.exclude).toEqual(['/api/**']);
    expect(config.ignore.selectors).toEqual([DEFAULT_IGNORE_SELECTOR]);
    expect(config.reporters).toEqual(['list', 'json', 'html']);
    expect(config.screenshots).toBe('failures');
    expect(config.outputDir).toBe('/project/.hydration-proof/report');
    expect(config.ci.failOn).toBe('error');
  });

  it('uses CI-friendly defaults on CI', () => {
    const config = resolveConfig({}, { ...base, env: { CI: 'true' } });
    expect(config.retries).toBe(1);
    expect(config.server.reuseExisting).toBe(false);
    expect(isCI({ CI: 'false' })).toBe(false);
    expect(isCI({ CI: '0' })).toBe(false);
  });

  it('lets command-line overrides win', () => {
    const config = resolveConfig(
      { server: { mode: 'production', url: 'http://a.test' }, reporters: ['json'], workers: 8 },
      { ...base, overrides: { mode: 'development', url: 'http://b.test/', reporters: ['list'], workers: 1, routes: ['/x'], headed: true, build: true } },
    );
    expect(config.server.mode).toBe('development');
    expect(config.server.url).toBe('http://b.test');
    expect(config.reporters).toEqual(['list']);
    expect(config.workers).toBe(1);
    expect(config.routes.paths).toEqual([{ path: '/x' }]);
    expect(config.routes.discover).toBe(false);
    expect(config.browser.headless).toBe(false);
    expect(config.server.buildWhen).toBe('always');
  });

  it('expands viewport presets and resolves storage state paths', () => {
    const config = resolveConfig(
      { scenarios: [{ name: 'phone', viewport: 'mobile', storageState: 'auth/user.json', headers: { a: 'b' } }] },
      base,
    );
    expect(config.scenarios[0]?.context).toMatchObject({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      storageState: '/project/auth/user.json',
      extraHTTPHeaders: { a: 'b' },
    });
  });

  it('expands the matrix, resolves throttling, clock and probes', () => {
    const config = resolveConfig(
      {
        scenarios: [{ name: 'guest', network: 'slow-3g', clock: '2026-01-02T03:04:05Z', randomSeed: 7, query: { currency: 'EUR' } }, { name: 'admin' }],
        matrix: { locale: ['en-US', 'de-DE'], browser: ['chromium', 'firefox'], strategy: 'full', scenarios: ['guest'] },
        probes: { factors: ['time'], maxPages: 2 },
        repeat: 3,
      },
      base,
    );
    expect(config.scenarios.map((scenario) => [scenario.name, scenario.base, scenario.browser])).toEqual([
      ['guest (en-US, chromium)', 'guest', 'chromium'],
      ['guest (en-US, firefox)', 'guest', 'firefox'],
      ['guest (de-DE, chromium)', 'guest', 'chromium'],
      ['guest (de-DE, firefox)', 'guest', 'firefox'],
      ['admin', 'admin', 'chromium'],
    ]);
    const first = config.scenarios[0]!;
    expect(first.context.locale).toBe('en-US');
    expect(first.environment).toEqual({ locale: 'en-US', browser: 'chromium' });
    expect(first.network).toEqual({ label: 'slow-3g', download: 50_000, upload: 50_000, latencyMs: 400 });
    expect(first.clock).toBe(Date.UTC(2026, 0, 2, 3, 4, 5));
    expect(first.randomSeed).toBe(7);
    expect(first.query).toEqual({ currency: 'EUR' });
    expect(first.cache).toBe('cold');
    expect(config.probes).toEqual({ factors: ['time'], maxPages: 2 });
    expect(config.repeat).toBe(3);

    const plain = resolveConfig({ matrix: { locale: ['en-US', 'de-DE'] }, probes: true }, { ...base, overrides: { matrix: false, probes: false, repeat: 2, browser: 'webkit' } });
    expect(plain.scenarios.map((scenario) => [scenario.name, scenario.browser])).toEqual([['default', 'webkit']]);
    expect(plain.probes).toBe(false);
    expect(plain.repeat).toBe(2);
    expect(resolveConfig({ probes: true }, base).probes).toEqual({ factors: undefined, maxPages: 5 });
    // --scenario accepts the configured name of a matrix scenario.
    expect(resolveConfig({ matrix: { locale: ['en-US', 'de-DE'] } }, { ...base, overrides: { scenarios: ['default'] } }).scenarioFilter).toEqual(['default']);
  });

  it('resolves interaction and navigation checks', () => {
    const off = resolveConfig({}, base);
    expect(off.checks.interactions).toBe(false);
    expect(off.checks.navigation).toBe(false);
    expect(off.interactions).toEqual([]);
    const on = resolveConfig({ checks: { navigation: { from: 'start' } } }, { ...base, overrides: { interactions: true } });
    expect(on.checks.interactions).toBe(true);
    expect(on.checks.navigation).toEqual({ from: '/start', prefetch: true, maxRoutes: 20 });
    expect(resolveConfig({}, { ...base, overrides: { navigation: true } }).checks.navigation).toEqual({ prefetch: true, maxRoutes: 20 });
    expect(resolveConfig({ checks: { navigation: true } }, { ...base, overrides: { navigation: false } }).checks.navigation).toBe(false);
  });

  it('rejects impossible throttling, bad clocks and unknown matrix scenarios', () => {
    expect(() => resolveConfig({ scenarios: [{ name: 'x', browser: 'firefox', cpu: 4 }] }, base)).toThrow(/only works in Chromium/);
    expect(() => resolveConfig({ scenarios: [{ name: 'x', clock: 'yesterday' }] }, base)).toThrow(/clock must be/);
    expect(() => resolveConfig({ matrix: { locale: ['en-US'], scenarios: ['nope'] } }, base)).toThrow(/unknown scenario "nope"/);
    expect(() => resolveConfig({ repeat: 0 }, base)).toThrow(ConfigError);
  });

  it('rejects duplicate and unknown scenarios, bad URLs and bad --grep', () => {
    expect(() => resolveConfig({ scenarios: [{ name: 'a' }, { name: 'a' }] }, base)).toThrow(ConfigError);
    expect(() => resolveConfig({}, { ...base, overrides: { scenarios: ['nope'] } })).toThrow(/Unknown scenario "nope"/);
    expect(() => resolveConfig({ server: { url: 'ftp://x' } }, base)).toThrow(/server.url must be an http/);
    expect(() => resolveConfig({}, { ...base, overrides: { grep: '(' } })).toThrow(/--grep/);
  });
});
