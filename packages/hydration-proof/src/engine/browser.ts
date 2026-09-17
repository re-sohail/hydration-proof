import type { Browser } from 'playwright-core';
import type { LoadedPlaywright } from './playwright.ts';

export type BrowserName = 'chromium' | 'firefox' | 'webkit';

export interface LaunchOptions {
  browser: BrowserName;
  /** Use an installed browser channel, e.g. `chrome` or `msedge` (Chromium only). */
  channel?: string;
  headless: boolean;
  slowMo?: number;
}

export class BrowserMissingError extends Error {
  override name = 'BrowserMissingError';
  readonly browser: BrowserName;

  constructor(browser: BrowserName, detail: string) {
    super(detail);
    this.browser = browser;
  }
}

export async function launchBrowser(playwright: LoadedPlaywright, options: LaunchOptions): Promise<Browser> {
  const type = playwright.module[options.browser];
  try {
    return await type.launch({
      headless: options.headless,
      ...(options.channel !== undefined ? { channel: options.channel } : {}),
      ...(options.slowMo !== undefined ? { slowMo: options.slowMo } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/Executable doesn't exist|browserType\.launch: .*not found|Please run the following command to download new browsers/i.test(message)) {
      throw new BrowserMissingError(options.browser, message);
    }
    throw error;
  }
}
