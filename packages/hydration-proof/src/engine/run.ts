import type { Browser, BrowserContext } from 'playwright-core';
import type { BrowserName } from '../config/types.ts';
import type { RuntimeOptions } from '../shared/protocol.ts';
import { analyzePage, type AnalyzeOptions, type PageAnalysis } from '../analyze/index.ts';
import type { NormalizeOptions } from '../dom/normalize.ts';
import type { RouteRef } from '../report/model.ts';
import { capturePage, DEFAULT_READY, type PageCapture, type ReadyOptions } from './capture.ts';
import { createScenarioContext, parseContextOptions, type ScenarioSpec } from './context.ts';
import { enrichIssues } from './enrich.ts';
import { parseDocument, screenshot, screenshotServerHtml, type ParsedDocument } from './parse-stage.ts';
import { mapConcurrent } from './pool.ts';
import { nodeRects } from './runtime-loader.ts';
import { applyThrottling, timeoutFactor, type Throttling } from './throttle.ts';
import type { DiagnosisContext } from '../diagnose/index.ts';
import type { SourceResolver } from '../source/resolve.ts';

export interface PageJob {
  id: string;
  url: string;
  route: RouteRef;
  scenario: ScenarioSpec;
  ready?: Partial<ReadyOptions>;
  expectedStatuses?: readonly number[];
  expectRedirect?: string;
}

/** Returns the browser for a job (launched on first use). */
export type BrowserSource = (name: BrowserName | undefined) => Promise<Browser>;

export interface EngineOptions {
  workers: number;
  /** Skip enrichment (source locations, causes); used by probe runs. */
  enrich?: boolean;
  ready: ReadyOptions;
  runtime: Partial<RuntimeOptions>;
  normalize?: NormalizeOptions;
  /** Capture stage 2 (browser-parsed server HTML). */
  parseStage: boolean;
  reportUnusedSuppression: boolean;
  /** Compare attributes and text with what React renders on the client. */
  propsAudit: boolean;
  /** Retry a page whose capture failed to navigate. */
  retries: number;
  /** Map elements to source files (needs source maps in production). */
  sourceMaps: boolean;
  resolver?: SourceResolver;
  rootDir: string;
  /** Locale and timezone the app server renders with, when known. */
  serverEnvironment: DiagnosisContext['server'];
  screenshots: 'off' | 'failures' | 'all';
  /** Tallest screenshot, in CSS pixels. */
  screenshotMaxHeight: number;
}

export const DEFAULT_ENGINE: EngineOptions = {
  workers: 4,
  ready: DEFAULT_READY,
  runtime: {},
  parseStage: true,
  reportUnusedSuppression: false,
  propsAudit: true,
  retries: 0,
  sourceMaps: true,
  rootDir: process.cwd(),
  serverEnvironment: {},
  screenshots: 'off',
  screenshotMaxHeight: 4_000,
};

export interface PageScreenshots {
  hydrated?: Buffer;
  server?: Buffer;
  width: number;
  height: number;
  boxes: { fingerprint: string; x: number; y: number; width: number; height: number }[];
}

export interface PageRun {
  job: PageJob;
  capture: PageCapture;
  parsed?: ParsedDocument;
  parseError?: string;
  analysis: PageAnalysis;
  screenshots?: PageScreenshots;
  attempts: number;
}

function diagnosisScenario(scenario: ScenarioSpec): DiagnosisContext['scenario'] {
  const context = scenario.context;
  const out: DiagnosisContext['scenario'] = {};
  if (context.locale !== undefined) out.locale = context.locale;
  if (context.timezoneId !== undefined) out.timezoneId = context.timezoneId;
  if (context.colorScheme !== undefined && context.colorScheme !== null) out.colorScheme = context.colorScheme;
  if (scenario.localStorage || scenario.sessionStorage || context.storageState) out.hasStorage = true;
  if (context.isMobile || (context.viewport && context.viewport.width < 600)) out.mobile = true;
  return out;
}

async function warmUp(context: BrowserContext, url: string, timeout: number): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'load', timeout }).catch(() => undefined);
  } finally {
    await page.close().catch(() => {});
  }
}

async function runOnce(browser: Browser, job: PageJob, options: EngineOptions): Promise<Omit<PageRun, 'attempts'>> {
  const context = await createScenarioContext(browser, job.scenario, options.runtime);
  const throttling: Throttling = {};
  if (job.scenario.network) throttling.network = job.scenario.network;
  if (job.scenario.cpu !== undefined) throttling.cpu = job.scenario.cpu;
  const factor = timeoutFactor(throttling);
  const ready = { ...options.ready, ...job.ready };
  if (factor > 1) {
    ready.timeout = Math.round(ready.timeout * factor);
    ready.hydrationTimeout = Math.round(ready.hydrationTimeout * factor);
    ready.bodyTimeout = Math.round(ready.bodyTimeout * factor);
    ready.noReactGrace = Math.round(ready.noReactGrace * Math.min(factor, 3));
  }
  const browserName = browser.browserType().name();
  const analyzeOptions: AnalyzeOptions = {
    route: job.route,
    scenario: job.scenario.name,
    reportUnusedSuppression: options.reportUnusedSuppression,
    propsAudit: options.propsAudit,
  };
  if (options.normalize) analyzeOptions.normalize = options.normalize;
  if (job.expectedStatuses) analyzeOptions.expectedStatuses = job.expectedStatuses;
  if (job.expectRedirect !== undefined) analyzeOptions.expectRedirect = job.expectRedirect;
  const parseOptions = parseContextOptions(job.scenario.context);

  let parsed: ParsedDocument | undefined;
  let parseError: string | undefined;
  let analysis: PageAnalysis | undefined;
  let screenshots: PageScreenshots | undefined;
  let capture: PageCapture;

  try {
    if (job.scenario.cache === 'warm') await warmUp(context, job.url, ready.timeout);
    capture = await capturePage(context, job.url, ready, {
      prepare: (page) => applyThrottling(context, page, browserName, throttling),
      beforeClose: async (page, result) => {
        if (options.parseStage && result.document?.body !== undefined) {
          try {
            parsed = await parseDocument(browser, result.document, parseOptions, 'csp', options.runtime.ignoreSelectors ?? []);
          } catch (error) {
            parseError = error instanceof Error ? error.message : String(error);
          }
        }
        analysis = analyzePage(result, parsed, analyzeOptions);
        if (options.enrich === false) return;
        await enrichIssues(page, result, analysis, options.resolver, {
          rootDir: options.rootDir,
          sourceMaps: options.sourceMaps,
          diagnosis: { scenario: diagnosisScenario(job.scenario), server: options.serverEnvironment },
        });

        const failing = analysis.issues.some((issue) => !issue.ignored && issue.severity !== 'info');
        if (options.screenshots === 'all' || (options.screenshots === 'failures' && failing)) {
          const ids = [...new Set(analysis.nodes.values())];
          const rects = new Map((await nodeRects(page, ids).catch(() => [])).map((rect) => [rect.id, rect]));
          const boxes: PageScreenshots['boxes'] = [];
          for (const [fingerprint, id] of analysis.nodes) {
            const rect = rects.get(id);
            if (rect) boxes.push({ fingerprint, x: rect.x, y: rect.y, width: rect.width, height: rect.height });
          }
          const size = page.viewportSize() ?? { width: 1280, height: 720 };
          const hydrated = await screenshot(page, options.screenshotMaxHeight);
          const server = result.document
            ? await screenshotServerHtml(browser, result.document, parseOptions, options.screenshotMaxHeight)
            : undefined;
          screenshots = { width: size.width, height: size.height, boxes };
          if (hydrated) screenshots.hydrated = hydrated;
          if (server) screenshots.server = server;
        }
      },
    });
  } finally {
    await context.close();
  }

  analysis ??= analyzePage(capture, undefined, analyzeOptions);
  const run: Omit<PageRun, 'attempts'> = { job, capture, analysis };
  if (parsed) run.parsed = parsed;
  if (parseError !== undefined) run.parseError = parseError;
  if (screenshots) run.screenshots = screenshots;
  return run;
}

export async function runJobs(
  browsers: Browser | BrowserSource,
  jobs: readonly PageJob[],
  options: EngineOptions,
  onResult?: (run: PageRun) => void,
): Promise<PageRun[]> {
  const source: BrowserSource = typeof browsers === 'function' ? browsers : async () => browsers;
  return mapConcurrent(jobs, options.workers, async (job) => {
    const browser = await source(job.scenario.browser);
    let attempts = 0;
    let run: Omit<PageRun, 'attempts'>;
    do {
      attempts++;
      run = await runOnce(browser, job, options);
    } while (run.capture.outcome === 'navigation-failed' && attempts <= options.retries);
    const result: PageRun = { ...run, attempts };
    onResult?.(result);
    return result;
  });
}
