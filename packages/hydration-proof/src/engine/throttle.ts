import type { BrowserContext, Page } from 'playwright-core';
import type { ResolvedNetwork } from '../config/resolve.ts';

// Slow network and slow JavaScript. Chromium supports both through the
// DevTools protocol. Firefox and WebKit have no network throttling: there,
// every request except the document is delayed by the latency instead.

export interface Throttling {
  network?: ResolvedNetwork;
  /** CPU slowdown factor, Chromium only. */
  cpu?: number;
}

export function isThrottled(throttling: Throttling): boolean {
  return throttling.network !== undefined || (throttling.cpu !== undefined && throttling.cpu > 1);
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Apply throttling to a new page before it navigates. */
export async function applyThrottling(context: BrowserContext, page: Page, browserName: string, throttling: Throttling): Promise<void> {
  if (!isThrottled(throttling)) return;
  if (browserName === 'chromium') {
    const session = await context.newCDPSession(page);
    if (throttling.network) {
      await session.send('Network.enable');
      await session.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: throttling.network.latencyMs,
        downloadThroughput: throttling.network.download,
        uploadThroughput: throttling.network.upload,
      });
    }
    if (throttling.cpu !== undefined && throttling.cpu > 1) {
      await session.send('Emulation.setCPUThrottlingRate', { rate: throttling.cpu });
    }
    return;
  }
  const network = throttling.network;
  if (network) {
    const bytesPerMs = network.download / 1000;
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (request.isNavigationRequest()) {
        await route.fallback();
        return;
      }
      // Latency plus a rough transfer time for a typical 30 KB resource.
      const delay = network.latencyMs + Math.min(3_000, Math.round(30_000 / Math.max(1, bytesPerMs)));
      await sleep(delay);
      await route.fallback().catch(() => {});
    });
  }
}

/** Longer timeouts for slowed-down pages. */
export function timeoutFactor(throttling: Throttling): number {
  let factor = 1;
  if (throttling.cpu !== undefined && throttling.cpu > 1) factor *= Math.min(throttling.cpu, 6);
  if (throttling.network) factor *= throttling.network.latencyMs >= 300 ? 3 : 2;
  return Math.min(factor, 10);
}

/**
 * Seeded replacements for Math.random and crypto randomness (a diagnostic
 * option, runs before page scripts).
 */
export function seededRandomScript(seed: number): string {
  return `(() => {
  let state = ${seed >>> 0};
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  Math.random = next;
  const c = globalThis.crypto;
  if (!c) return;
  const fill = (array) => {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(next() * 256);
    return array;
  };
  const uuid = () => {
    const b = fill(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  };
  try { Object.defineProperty(c, 'getRandomValues', { value: fill, configurable: true, writable: true }); } catch {}
  if (typeof c.randomUUID === 'function') {
    try { Object.defineProperty(c, 'randomUUID', { value: uuid, configurable: true, writable: true }); } catch {}
  }
})();`;
}
