import type { Browser } from 'playwright-core';
import type { RuntimeOptions } from '../shared/protocol.ts';
import { analyzePage, type AnalyzeOptions, type PageAnalysis } from '../analyze/index.ts';
import type { NormalizeOptions } from '../dom/normalize.ts';
import type { RouteRef } from '../report/model.ts';
import { capturePage, DEFAULT_READY, type PageCapture, type ReadyOptions } from './capture.ts';
import { createScenarioContext, parseContextOptions, type ScenarioSpec } from './context.ts';
import { parseDocument, type ParsedDocument } from './parse-stage.ts';
import { mapConcurrent } from './pool.ts';

export interface PageJob {
  id: string;
  url: string;
  route: RouteRef;
  scenario: ScenarioSpec;
  ready?: Partial<ReadyOptions>;
  expectedStatuses?: readonly number[];
}

export interface EngineOptions {
  workers: number;
  ready: ReadyOptions;
  runtime: Partial<RuntimeOptions>;
  normalize?: NormalizeOptions;
  /** Capture stage 2 (browser-parsed server HTML). */
  parseStage: boolean;
  reportUnusedSuppression: boolean;
  /** Retry a page whose capture failed to navigate. */
  retries: number;
}

export const DEFAULT_ENGINE: EngineOptions = {
  workers: 4,
  ready: DEFAULT_READY,
  runtime: {},
  parseStage: true,
  reportUnusedSuppression: false,
  retries: 0,
};

export interface PageRun {
  job: PageJob;
  capture: PageCapture;
  parsed?: ParsedDocument;
  parseError?: string;
  analysis: PageAnalysis;
  attempts: number;
}

async function runOnce(browser: Browser, job: PageJob, options: EngineOptions): Promise<Omit<PageRun, 'attempts'>> {
  const context = await createScenarioContext(browser, job.scenario, options.runtime);
  let capture: PageCapture;
  try {
    capture = await capturePage(context, job.url, { ...options.ready, ...job.ready });
  } finally {
    await context.close();
  }

  let parsed: ParsedDocument | undefined;
  let parseError: string | undefined;
  if (options.parseStage && capture.document?.body !== undefined) {
    try {
      parsed = await parseDocument(browser, capture.document, parseContextOptions(job.scenario.context));
    } catch (error) {
      parseError = error instanceof Error ? error.message : String(error);
    }
  }

  const analyzeOptions: AnalyzeOptions = {
    route: job.route,
    scenario: job.scenario.name,
    reportUnusedSuppression: options.reportUnusedSuppression,
  };
  if (options.normalize) analyzeOptions.normalize = options.normalize;
  if (job.expectedStatuses) analyzeOptions.expectedStatuses = job.expectedStatuses;
  const analysis = analyzePage(capture, parsed, analyzeOptions);

  const run: Omit<PageRun, 'attempts'> = { job, capture, analysis };
  if (parsed) run.parsed = parsed;
  if (parseError !== undefined) run.parseError = parseError;
  return run;
}

export async function runJobs(
  browser: Browser,
  jobs: readonly PageJob[],
  options: EngineOptions,
  onResult?: (run: PageRun) => void,
): Promise<PageRun[]> {
  return mapConcurrent(jobs, options.workers, async (job) => {
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
