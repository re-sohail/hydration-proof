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

  it('rejects duplicate and unknown scenarios, bad URLs and bad --grep', () => {
    expect(() => resolveConfig({ scenarios: [{ name: 'a' }, { name: 'a' }] }, base)).toThrow(ConfigError);
    expect(() => resolveConfig({}, { ...base, overrides: { scenarios: ['nope'] } })).toThrow(/Unknown scenario "nope"/);
    expect(() => resolveConfig({ server: { url: 'ftp://x' } }, base)).toThrow(/server.url must be an http/);
    expect(() => resolveConfig({}, { ...base, overrides: { grep: '(' } })).toThrow(/--grep/);
  });
});
