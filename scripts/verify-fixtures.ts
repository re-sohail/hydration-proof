// Ground truth: every broken fixture page must make React itself report a
// hydration problem in development mode, and no control page may.
//
// Usage: node scripts/verify-fixtures.ts [next-app|next-pages]

import { chromium, type Browser } from 'playwright-core';
import { CASES, caseId, DEFAULT_CONTEXT, type FixtureApp, type FixtureCase } from '../fixtures/cases.ts';
import { startFixture, type RunningFixture } from './lib/fixtures.ts';

const HYDRATION_MESSAGE =
  /hydrat|did not match|didn't match|server rendered|cannot be a descendant|cannot contain a nested|cannot appear as a (child|descendant)/i;

interface Row {
  id: string;
  ok: boolean;
  detail: string;
}

async function visit(browser: Browser, fixture: RunningFixture, entry: FixtureCase): Promise<string[]> {
  const context = await browser.newContext({
    locale: entry.context?.locale ?? DEFAULT_CONTEXT.locale,
    timezoneId: entry.context?.timezoneId ?? DEFAULT_CONTEXT.timezoneId,
    colorScheme: entry.context?.colorScheme ?? DEFAULT_CONTEXT.colorScheme,
    ...(entry.context?.viewport ? { viewport: entry.context.viewport } : {}),
  });
  if (entry.storage) {
    await context.addInitScript((items: Record<string, string>) => {
      for (const [key, value] of Object.entries(items)) window.localStorage.setItem(key, value);
    }, entry.storage);
  }
  for (const script of entry.initScripts ?? []) await context.addInitScript({ content: script });
  const page = await context.newPage();
  const messages: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') messages.push(message.text());
  });
  page.on('pageerror', (error) => messages.push(error.message));
  const base = entry.via === 'cdn-proxy' ? fixture.proxyUrl : fixture.url;
  await page.goto(base + entry.route, { waitUntil: 'load' });
  await page.waitForTimeout(1_500);
  await context.close();
  return messages.filter((text) => HYDRATION_MESSAGE.test(text));
}

async function main(): Promise<void> {
  const only = process.argv[2] as FixtureApp | undefined;
  const apps: FixtureApp[] = only ? [only] : ['next-app', 'next-pages'];
  const browser = await chromium.launch();
  const rows: Row[] = [];
  try {
    for (const app of apps) {
      const fixture = await startFixture(app, 'dev');
      try {
        const cases = CASES.filter((entry) => entry.app === app);
        // Turbopack compiles routes on first request; warm them up.
        for (const entry of cases) await fetch(fixture.url + entry.route).catch(() => {});
        for (const entry of cases) {
          const found = await visit(browser, fixture, entry);
          const ok = entry.kind === 'broken' ? found.length > 0 : found.length === 0;
          rows.push({ id: caseId(entry), ok, detail: found[0]?.split('\n')[0]?.slice(0, 110) ?? '—' });
        }
      } finally {
        await fixture.stop();
      }
    }
  } finally {
    await browser.close();
  }

  const width = Math.max(...rows.map((row) => row.id.length));
  for (const row of rows) console.log(`${row.ok ? 'ok  ' : 'FAIL'}  ${row.id.padEnd(width)}  ${row.detail}`);
  const failed = rows.filter((row) => !row.ok);
  console.log(`\n${rows.length - failed.length}/${rows.length} cases match React's own verdict.`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
