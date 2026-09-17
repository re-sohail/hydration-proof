import type { BrowserContextOptions } from 'playwright-core';
import type { ProbeFactor } from '../config/types.ts';
import type { DiagnosisContext } from '../diagnose/index.ts';
import { applyProbeResults, evaluateProbes, type ProbeObservation, type ProbeRun } from '../diagnose/probes.ts';
import type { ScenarioSpec } from '../engine/context.ts';
import { runJobs, type BrowserSource, type EngineOptions, type PageJob, type PageRun } from '../engine/run.ts';
import type { IssueCode } from '../issues/registry.ts';
import type { Issue } from '../report/model.ts';

// Runs the probe variants of pages with value mismatches and records which
// factor each finding depends on.

/** Findings whose values can be compared between runs. */
const PROBE_CODES: ReadonlySet<IssueCode> = new Set(['HP1001', 'HP1002', 'HP1003', 'HP1004', 'HP1005', 'HP1006', 'HP1012', 'HP1013']);

const ALL_FACTORS: readonly ProbeFactor[] = ['time', 'random', 'locale', 'timezone', 'theme', 'viewport', 'storage'];
/** How far the clock moves: every date and time field changes. */
const CLOCK_SHIFT = ((((3 * 24 + 7) * 60 + 11) * 60 + 13) * 1000) + 17;

export function isProbeCandidate(issue: Issue): boolean {
  return !issue.ignored && !issue.suppressed && issue.severity !== 'info' && PROBE_CODES.has(issue.code);
}

function hasStorage(scenario: ScenarioSpec): boolean {
  return scenario.localStorage !== undefined || scenario.sessionStorage !== undefined || scenario.context.storageState !== undefined;
}

function otherLocale(current: string | undefined, server: string | undefined): string {
  if (server !== undefined && server !== current) return server;
  return current?.toLowerCase().startsWith('de') ? 'en-US' : 'de-DE';
}

function otherTimezone(current: string | undefined, server: string | undefined): string {
  if (server !== undefined && server !== current) return server;
  return current === 'Pacific/Kiritimati' ? 'America/Adak' : 'Pacific/Kiritimati';
}

function otherViewport(context: BrowserContextOptions): BrowserContextOptions {
  const out: BrowserContextOptions = { ...context };
  const narrow = context.isMobile === true || (context.viewport?.width ?? 1280) < 600;
  delete out.isMobile;
  delete out.hasTouch;
  delete out.deviceScaleFactor;
  if (narrow) {
    out.viewport = { width: 1280, height: 800 };
  } else {
    Object.assign(out, { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  }
  return out;
}

export function probeFactors(scenario: ScenarioSpec, requested: readonly ProbeFactor[] | undefined): ProbeFactor[] {
  return (requested ?? ALL_FACTORS).filter((factor) => factor !== 'storage' || hasStorage(scenario));
}

/** The probe variants of a job: base, identical control, and one per factor. */
export function probeVariants(
  job: PageJob,
  factors: readonly ProbeFactor[],
  server: DiagnosisContext['server'],
  now: number = Date.now(),
): { run: ProbeRun; job: PageJob }[] {
  const clock = job.scenario.clock ?? Math.floor(now / 60_000) * 60_000;
  const seed = job.scenario.randomSeed ?? 1;
  const base: ScenarioSpec = { ...job.scenario, clock, randomSeed: seed, cache: 'cold' };
  const variant = (run: ProbeRun, scenario: ScenarioSpec): { run: ProbeRun; job: PageJob } => ({
    run,
    job: { ...job, id: `${job.id} probe:${run}`, scenario },
  });
  const out = [variant('base', base), variant('control', base)];
  for (const factor of factors) {
    switch (factor) {
      case 'time':
        out.push(variant(factor, { ...base, clock: clock + CLOCK_SHIFT }));
        break;
      case 'random':
        out.push(variant(factor, { ...base, randomSeed: seed + 1 }));
        break;
      case 'locale':
        out.push(variant(factor, { ...base, context: { ...base.context, locale: otherLocale(base.context.locale, server.locale) } }));
        break;
      case 'timezone':
        out.push(variant(factor, { ...base, context: { ...base.context, timezoneId: otherTimezone(base.context.timezoneId, server.timezoneId) } }));
        break;
      case 'theme':
        out.push(variant(factor, { ...base, context: { ...base.context, colorScheme: base.context.colorScheme === 'dark' ? 'light' : 'dark' } }));
        break;
      case 'viewport':
        out.push(variant(factor, { ...base, context: otherViewport(base.context) }));
        break;
      case 'storage': {
        const context = { ...base.context };
        delete context.storageState;
        const scenario: ScenarioSpec = { ...base, context };
        delete scenario.localStorage;
        delete scenario.sessionStorage;
        out.push(variant(factor, scenario));
        break;
      }
    }
  }
  return out;
}

function observe(run: PageRun | undefined, fingerprint: string): ProbeObservation | undefined {
  if (!run || (run.capture.outcome !== 'hydrated' && run.capture.outcome !== 'hydration-stalled')) return undefined;
  const issue = run.analysis.issues.find((entry) => entry.fingerprint === fingerprint);
  if (!issue) return { present: false };
  return issue.client === undefined ? { present: true } : { present: true, client: issue.client };
}

export interface ProbeTarget {
  job: PageJob;
  issues: Issue[];
}

/** Probe the targets; returns the number of extra page loads. */
export async function runProbes(
  browsers: BrowserSource,
  targets: readonly ProbeTarget[],
  engine: EngineOptions,
  requested: readonly ProbeFactor[] | undefined,
  server: DiagnosisContext['server'],
): Promise<number> {
  const plans = targets.map((target) => {
    const factors = probeFactors(target.job.scenario, requested);
    return { target, factors, variants: probeVariants(target.job, factors, server) };
  });
  const jobs = plans.flatMap((plan) => plan.variants.map((entry) => entry.job));
  const options: EngineOptions = {
    ...engine,
    parseStage: false,
    screenshots: 'off',
    enrich: false,
    sourceMaps: false,
    retries: 0,
  };
  const runs = new Map((await runJobs(browsers, jobs, options)).map((run) => [run.job.id, run]));
  for (const plan of plans) {
    for (const issue of plan.target.issues) {
      const observations = new Map<ProbeRun, ProbeObservation | undefined>();
      for (const entry of plan.variants) observations.set(entry.run, observe(runs.get(entry.job.id), issue.fingerprint));
      applyProbeResults(issue, evaluateProbes(observations, plan.factors));
    }
  }
  return jobs.length;
}
