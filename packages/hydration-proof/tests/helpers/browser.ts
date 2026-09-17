import { chromium, type Browser, type BrowserContext } from 'playwright-core';
import { afterAll, beforeAll, inject } from 'vitest';
import { capturePage, DEFAULT_READY, type PageCapture, type ReadyOptions } from '../../src/engine/capture.ts';
import { runtimeScript } from '../../src/engine/runtime-loader.ts';
import type { BuildMode, ReactVersion } from './provided.ts';

export const MATRIX: [ReactVersion, BuildMode][] = [
  ['18', 'development'],
  ['18', 'production'],
  ['19', 'development'],
  ['19', 'production'],
];

export function harnessUrl(version: ReactVersion, mode: BuildMode, page: string): string {
  return `${inject('harness')[`${version}-${mode}`]}/${page}`;
}

/** One Chromium per test file. */
export function useBrowser(): () => Browser {
  let browser: Browser | undefined;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });
  return () => {
    if (!browser) throw new Error('Browser not started');
    return browser;
  };
}

export async function withRuntimeContext<T>(browser: Browser, fn: (context: BrowserContext) => Promise<T>): Promise<T> {
  const context = await browser.newContext();
  await context.addInitScript({ content: runtimeScript() });
  try {
    return await fn(context);
  } finally {
    await context.close();
  }
}

export const FAST_READY: ReadyOptions = {
  ...DEFAULT_READY,
  quietMs: 150,
  noReactGrace: 800,
  hydrationTimeout: 8_000,
  timeout: 15_000,
};

export async function capture(browser: Browser, url: string, ready: ReadyOptions = FAST_READY): Promise<PageCapture> {
  return withRuntimeContext(browser, (context) => capturePage(context, url, ready));
}
