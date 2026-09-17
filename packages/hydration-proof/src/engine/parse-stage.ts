import type { Browser, BrowserContextOptions } from 'playwright-core';
import type { SFragment } from '../shared/protocol.ts';
import type { DocumentResponse } from './capture.ts';
import { drainRuntime, runtimeScript } from './runtime-loader.ts';

// Stage 2: the DOM the browser builds from the server bytes before any script
// runs. The same bytes are served again (no second server render) with a CSP
// that forbids every script, so the parser keeps its normal "scripting
// enabled" behaviour (`<noscript>` stays raw text, exactly like the live page).

export type ParseMethod = 'csp' | 'no-javascript';

export interface ParsedDocument {
  tree: SFragment;
  method: ParseMethod;
}

const BLOCK_ALL = "script-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'";

const DROPPED_HEADERS = new Set([
  'content-encoding',
  'content-length',
  'transfer-encoding',
  'content-security-policy',
  'content-security-policy-report-only',
  'set-cookie',
  'refresh',
  'link',
]);

function replayHeaders(headers: Record<string, string>, method: ParseMethod): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!DROPPED_HEADERS.has(name.toLowerCase())) out[name] = value;
  }
  if (method === 'csp') out['content-security-policy'] = BLOCK_ALL;
  return out;
}

export async function parseDocument(
  browser: Browser,
  document: DocumentResponse,
  contextOptions: BrowserContextOptions = {},
  method: ParseMethod = 'csp',
  ignoreSelectors: readonly string[] = [],
): Promise<ParsedDocument> {
  if (document.body === undefined) throw new Error('The document body was not captured.');
  const context = await browser.newContext({
    ...contextOptions,
    javaScriptEnabled: method !== 'no-javascript',
    serviceWorkers: 'block',
  });
  try {
    let served = false;
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (!served && request.isNavigationRequest()) {
        served = true;
        await route.fulfill({
          status: 200,
          headers: replayHeaders(document.headers, method),
          body: document.body,
        });
        return;
      }
      await route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    await page.goto(document.url, { waitUntil: 'domcontentloaded' });
    // DevTools evaluation is not subject to the page CSP, and still works
    // with JavaScript disabled.
    await page.evaluate(
      runtimeScript({ captureClientView: false, captureWarnings: false, ignoreSelectors: [...ignoreSelectors] }),
    );
    await page.evaluate(() => {
      const api = (globalThis as unknown as Record<string, { snapshot(kind: string): number }>)['__HYDRATION_PROOF__'];
      api?.snapshot('manual');
    });
    const payload = await drainRuntime(page);
    const snapshot = payload.snapshots.at(-1);
    if (snapshot === undefined) throw new Error('The parse stage produced no snapshot.');
    return { tree: snapshot.tree, method };
  } finally {
    await context.close();
  }
}

/**
 * A picture of the server HTML as the browser renders it without scripts
 * (stylesheets, fonts and images are allowed to load).
 */
export async function screenshotServerHtml(
  browser: Browser,
  document: DocumentResponse,
  contextOptions: BrowserContextOptions,
  maxHeight: number,
  mask: readonly string[] = [],
): Promise<Buffer | undefined> {
  if (document.body === undefined) return undefined;
  const context = await browser.newContext({ ...contextOptions, serviceWorkers: 'block' });
  try {
    let served = false;
    await context.route('**/*', async (route) => {
      const request = route.request();
      if (!served && request.isNavigationRequest()) {
        served = true;
        await route.fulfill({ status: 200, headers: replayHeaders(document.headers, 'csp'), body: document.body });
        return;
      }
      const type = request.resourceType();
      if (type === 'stylesheet' || type === 'image' || type === 'font' || type === 'media') await route.continue();
      else await route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    await page.goto(document.url, { waitUntil: 'load', timeout: 15_000 }).catch(() => undefined);
    return await screenshot(page, maxHeight, mask);
  } catch {
    return undefined;
  } finally {
    await context.close();
  }
}

/** Full-page JPEG, at most `maxHeight` tall; elements matching `mask` are blacked out. */
export async function screenshot(page: import('playwright-core').Page, maxHeight: number, mask: readonly string[] = []): Promise<Buffer | undefined> {
  try {
    const size = await page.evaluate(() => {
      const root = (globalThis as unknown as { document: { documentElement: { scrollWidth: number; scrollHeight: number } } }).document
        .documentElement;
      return { width: root.scrollWidth, height: root.scrollHeight };
    });
    const height = Math.min(size.height, maxHeight);
    const clip = { x: 0, y: 0, width: Math.max(1, size.width), height: Math.max(1, height) };
    return await page.screenshot({
      type: 'jpeg',
      quality: 70,
      fullPage: true,
      clip,
      animations: 'disabled',
      caret: 'hide',
      ...(mask.length > 0 ? { mask: mask.map((selector) => page.locator(selector)), maskColor: '#000000' } : {}),
    });
  } catch {
    return undefined;
  }
}
