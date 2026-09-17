import type { Browser, BrowserContext, BrowserContextOptions, Route } from 'playwright-core';
import type { ResolvedNetwork } from '../config/resolve.ts';
import type { BrowserName, CacheState, MockConfig } from '../config/types.ts';
import type { RuntimeOptions } from '../shared/protocol.ts';
import { runtimeScript } from './runtime-loader.ts';
import { seededRandomScript } from './throttle.ts';

/** Everything that describes one browser environment a route is tested in. */
export interface ScenarioSpec {
  name: string;
  /** Options passed to browser.newContext (locale, timezoneId, colorScheme, viewport, storageState, ...). */
  context: BrowserContextOptions;
  /** localStorage entries written before any page script runs. */
  localStorage?: Record<string, string>;
  /** sessionStorage entries written before any page script runs. */
  sessionStorage?: Record<string, string>;
  /** Extra scripts injected before page scripts (after the hydration-proof runtime). */
  initScripts?: string[];
  /** Cookies added before navigation; cookies without a domain use `cookieUrl`. */
  cookies?: { name: string; value: string; domain?: string; path?: string; httpOnly?: boolean; secure?: boolean; sameSite?: 'Strict' | 'Lax' | 'None' }[];
  cookieUrl?: string;
  /** Browser request fixtures. */
  mocks?: MockConfig[];
  /** Browser to use. Default: the run's browser. */
  browser?: BrowserName;
  network?: ResolvedNetwork;
  /** CPU slowdown factor (Chromium only). */
  cpu?: number;
  /** `warm`: the page is loaded once in the same context before it is tested. */
  cache?: CacheState;
  /** Fixed browser time (epoch ms). */
  clock?: number;
  /** Seed for Math.random and crypto randomness in the browser. */
  randomSeed?: number;
}

function mockHandler(mock: MockConfig): (route: Route) => Promise<void> {
  return async (route) => {
    if (mock.method !== undefined && route.request().method().toUpperCase() !== mock.method.toUpperCase()) {
      await route.fallback();
      return;
    }
    const json = mock.body !== undefined && typeof mock.body !== 'string' && !(mock.body instanceof Uint8Array);
    await route.fulfill({
      status: mock.status ?? 200,
      headers: { ...(json ? { 'content-type': 'application/json' } : {}), ...mock.headers },
      body: mock.body === undefined ? '' : json ? JSON.stringify(mock.body) : (mock.body as string),
    });
  };
}

/** Context options that affect how the server bytes are parsed (stage 2). */
export function parseContextOptions(options: BrowserContextOptions): BrowserContextOptions {
  const out: BrowserContextOptions = {};
  if (options.locale !== undefined) out.locale = options.locale;
  if (options.userAgent !== undefined) out.userAgent = options.userAgent;
  if (options.ignoreHTTPSErrors !== undefined) out.ignoreHTTPSErrors = options.ignoreHTTPSErrors;
  return out;
}

function storageScript(kind: 'localStorage' | 'sessionStorage', entries: Record<string, string>): string {
  return `(() => { try { const s = window[${JSON.stringify(kind)}]; for (const [k, v] of Object.entries(${JSON.stringify(entries)})) s.setItem(k, v); } catch {} })();`;
}

export async function createScenarioContext(
  browser: Browser,
  scenario: ScenarioSpec,
  runtime: Partial<RuntimeOptions> = {},
): Promise<BrowserContext> {
  const options: BrowserContextOptions = { serviceWorkers: 'block', ...scenario.context };
  // Firefox has no mobile emulation; the viewport and touch still apply.
  if (options.isMobile !== undefined && browser.browserType().name() === 'firefox') delete options.isMobile;
  const context = await browser.newContext(options);
  // Order matters: the runtime must run before anything the page or scenario adds.
  await context.addInitScript({ content: runtimeScript(runtime) });
  if (scenario.clock !== undefined) await context.clock.setFixedTime(scenario.clock);
  if (scenario.randomSeed !== undefined) await context.addInitScript({ content: seededRandomScript(scenario.randomSeed) });
  if (scenario.localStorage) await context.addInitScript({ content: storageScript('localStorage', scenario.localStorage) });
  if (scenario.sessionStorage) {
    await context.addInitScript({ content: storageScript('sessionStorage', scenario.sessionStorage) });
  }
  for (const script of scenario.initScripts ?? []) await context.addInitScript({ content: script });
  for (const mock of scenario.mocks ?? []) await context.route(mock.url, mockHandler(mock));
  if (scenario.cookies?.length) {
    await context.addCookies(
      scenario.cookies.map((cookie) =>
        cookie.domain !== undefined
          ? { ...cookie, domain: cookie.domain, path: cookie.path ?? '/' }
          : { name: cookie.name, value: cookie.value, url: scenario.cookieUrl ?? 'http://localhost', ...(cookie.httpOnly !== undefined ? { httpOnly: cookie.httpOnly } : {}), ...(cookie.secure !== undefined ? { secure: cookie.secure } : {}), ...(cookie.sameSite !== undefined ? { sameSite: cookie.sameSite } : {}) },
      ),
    );
  }
  return context;
}
