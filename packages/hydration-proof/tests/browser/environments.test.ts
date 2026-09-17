import { existsSync } from 'node:fs';
import { chromium, firefox, webkit, type Browser, type BrowserType } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveNetwork } from '../../src/config/resolve.ts';
import type { BrowserName } from '../../src/config/types.ts';
import { createScenarioContext, type ScenarioSpec } from '../../src/engine/context.ts';
import { DEFAULT_ENGINE, runJobs, type BrowserSource, type EngineOptions, type PageJob } from '../../src/engine/run.ts';
import { runProbes } from '../../src/run/probes.ts';
import { FAST_READY, harnessUrl } from '../helpers/browser.ts';

// 0.4 engine features in real browsers: fixed clock, seeded random values,
// throttling, warm cache, per-job browsers and probes.

const types: Record<BrowserName, BrowserType> = { chromium, firefox, webkit };
const installed = (name: BrowserName): boolean => existsSync(types[name].executablePath());
const browsers = new Map<BrowserName, Browser>();
const source: BrowserSource = async (name) => {
  const key = name ?? 'chromium';
  let browser = browsers.get(key);
  if (!browser) {
    browser = await types[key].launch();
    browsers.set(key, browser);
  }
  return browser;
};

afterAll(async () => {
  await Promise.all([...browsers.values()].map((browser) => browser.close()));
});

const engine: EngineOptions = { ...DEFAULT_ENGINE, workers: 3, ready: FAST_READY, parseStage: false, sourceMaps: false };

function job(url: string, scenario: Partial<ScenarioSpec> = {}, id = url): PageJob {
  return { id, url, route: { url, pattern: new URL(url).pathname }, scenario: { name: 'default', context: {}, ...scenario } };
}

describe.each(['chromium', 'firefox', 'webkit'] as const)('%s', (name) => {
  const available = installed(name);
  let browser: Browser;
  beforeAll(async () => {
    if (available) browser = await source(name);
  });

  it.skipIf(!available)('fixes the clock and seeds random values without stopping timers', async () => {
    const clock = Date.UTC(2026, 2, 14, 15, 9, 26);
    const read = async (seed: number) => {
      const context = await createScenarioContext(browser, { name: 'x', context: {}, clock, randomSeed: seed });
      try {
        const page = await context.newPage();
        await page.goto(harnessUrl('19', 'production', 'ok'));
        return await page.evaluate(async () => {
          const timer = await new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 20));
          return {
            now: Date.now(),
            date: new Date().toISOString(),
            random: [Math.random(), Math.random()],
            bytes: Array.from(crypto.getRandomValues(new Uint8Array(4))),
            timer,
          };
        });
      } finally {
        await context.close();
      }
    };
    const first = await read(1);
    const again = await read(1);
    const other = await read(2);
    expect(first.now).toBe(clock);
    expect(first.date).toBe('2026-03-14T15:09:26.000Z');
    expect(first.timer).toBe(true);
    expect(again.random).toEqual(first.random);
    expect(again.bytes).toEqual(first.bytes);
    expect(other.random).not.toEqual(first.random);
    expect(first.random.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it.skipIf(!available)('hydrates with slow network, slow CPU (Chromium) and a warm cache', async () => {
    const url = harnessUrl('19', 'production', 'suspense');
    const slow: Partial<ScenarioSpec> = { network: resolveNetwork({ downloadKbps: 2_000, uploadKbps: 1_000, latencyMs: 120 })!, browser: name };
    if (name === 'chromium') slow.cpu = 3;
    const runs = await runJobs(source, [job(url, slow, 'slow'), job(url, { cache: 'warm', browser: name }, 'warm'), job(url, { browser: name }, 'plain')], engine);
    const by = Object.fromEntries(runs.map((run) => [run.job.id, run]));
    for (const run of runs) {
      expect(run.capture.outcome, run.job.id).toBe('hydrated');
      expect(run.analysis.issues.filter((issue) => issue.severity !== 'info'), run.job.id).toEqual([]);
    }
    expect(by['slow']!.capture.timings.hydration!).toBeGreaterThan(120);
    expect((await source(name)).browserType().name()).toBe(name);
  });
});

describe('probes', () => {
  it.skipIf(!installed('chromium'))('prove that one value depends on the clock and another on random numbers', async () => {
    const url = harnessUrl('19', 'production', 'probe-values');
    const [run] = await runJobs(source, [job(url)], engine);
    const issues = run!.analysis.issues.filter((issue) => issue.code === 'HP1001');
    expect(issues.map((issue) => issue.selector).sort()).toEqual(['#now', '#random']);
    const loads = await runProbes(source, [{ job: run!.job, issues }], engine, ['time', 'random', 'locale'], {});
    expect(loads).toBe(5);
    const now = issues.find((issue) => issue.selector === '#now')!;
    const random = issues.find((issue) => issue.selector === '#random')!;
    expect(now.cause).toMatchObject({ id: 'time', proven: true });
    expect(random.cause).toMatchObject({ id: 'random', proven: true });
    expect(now.probes?.map((probe) => `${probe.factor}:${probe.result}`)).toEqual(['repeat:stable', 'time:changes', 'random:stable', 'locale:stable']);
  });
});
