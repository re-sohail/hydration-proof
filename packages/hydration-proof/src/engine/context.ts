import type { Browser, BrowserContext, BrowserContextOptions } from 'playwright-core';
import type { RuntimeOptions } from '../shared/protocol.ts';
import { runtimeScript } from './runtime-loader.ts';

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
  const context = await browser.newContext({ serviceWorkers: 'block', ...scenario.context });
  // Order matters: the runtime must run before anything the page or scenario adds.
  await context.addInitScript({ content: runtimeScript(runtime) });
  if (scenario.localStorage) await context.addInitScript({ content: storageScript('localStorage', scenario.localStorage) });
  if (scenario.sessionStorage) {
    await context.addInitScript({ content: storageScript('sessionStorage', scenario.sessionStorage) });
  }
  for (const script of scenario.initScripts ?? []) await context.addInitScript({ content: script });
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
