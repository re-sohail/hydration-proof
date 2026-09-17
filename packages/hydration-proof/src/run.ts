import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from 'playwright-core';
import { selectAdapter } from './adapters/index.ts';
import { applyIgnores, type ExpiredRule } from './analyze/ignore.ts';
import { ExitCode } from './ci/exit-codes.ts';
import { ConfigError, loadConfig } from './config/load.ts';
import { resolveConfig, type CliOverrides, type ResolvedConfig, type ResolvedScenario } from './config/resolve.ts';
import type { BuildMode } from './config/types.ts';
import { BrowserMissingError, launchBrowser } from './engine/browser.ts';
import { DEFAULT_READY, type ReadyOptions } from './engine/capture.ts';
import { createResolver } from './engine/enrich.ts';
import { LoginError, performLogin, type StorageState } from './engine/login.ts';
import { loadPlaywright } from './engine/playwright.ts';
import { DEFAULT_ENGINE, runJobs, type EngineOptions, type PageJob, type PageRun } from './engine/run.ts';
import type { RunningServer } from './engine/server.ts';
import { REPORT_SCHEMA_VERSION, type Issue, type PageResult, type Report } from './report/model.ts';
import { createReporters, type Reporter, type ReporterContext } from './report/reporters/index.ts';
import { linksFromSnapshot, patternFor } from './routes/crawl.ts';
import { matchesAny, pathOf } from './routes/pattern.ts';
import { RunError } from './run/errors.ts';
import { planServerRoutes, planStaticRoutes, routeAllowed, type PlannedRoute, type RoutePlan } from './run/plan.ts';
import {
  compareModes,
  filterChecks,
  normalizeOptions,
  policy,
  serverEnvironment,
  serverLogsFor,
  summarize,
  toPageResult,
  writeScreenshots,
} from './run/results.ts';
import { prepareServer } from './run/server.ts';
import { detectPackageManager, selfCommand } from './util/package-manager.ts';
import { VERSION } from './util/version.ts';

export { RunError };

export interface RunOptions {
  cwd?: string;
  /** Config file path; found automatically when omitted. */
  config?: string;
  overrides?: CliOverrides;
  /** Where progress and the terminal report are written. */
  write?: (text: string) => void;
  /** Extra reporters (in addition to the configured ones). */
  reporters?: Reporter[];
  signal?: AbortSignal;
}

export interface RunResult {
  report: Report;
  exitCode: ExitCode;
  /** Human-readable reasons the run failed. */
  failures: string[];
  files: string[];
  notes: string[];
}

function readyOptions(config: ResolvedConfig, route: PlannedRoute): ReadyOptions {
  const merged = { ...config.ready, ...route.ready };
  const ready: ReadyOptions = {
    ...DEFAULT_READY,
    quietMs: merged.quietMs ?? DEFAULT_READY.quietMs,
    timeout: merged.timeout ?? DEFAULT_READY.timeout,
    hydrationTimeout: merged.hydrationTimeout ?? DEFAULT_READY.hydrationTimeout,
  };
  if (merged.selector !== undefined) ready.selector = merged.selector;
  if (merged.function !== undefined) ready.readyFunction = merged.function;
  return ready;
}

function scenarioAllows(scenario: ResolvedScenario, route: PlannedRoute): boolean {
  const path = pathOf(route.path);
  if (scenario.include.length > 0 && !matchesAny(path, scenario.include) && !matchesAny(route.pattern, scenario.include)) return false;
  return !matchesAny(path, scenario.exclude) && !matchesAny(route.pattern, scenario.exclude);
}

function jobId(route: PlannedRoute, scenario: string, mode: BuildMode | undefined): string {
  return `${route.path} [${scenario}]${mode ? ` (${mode})` : ''}`;
}

interface JobPlan {
  job: PageJob;
  route: PlannedRoute;
  scenario: ResolvedScenario;
}

function buildJobs(
  config: ResolvedConfig,
  routes: readonly PlannedRoute[],
  scenarios: readonly ResolvedScenario[],
  baseUrl: string,
  states: ReadonlyMap<string, StorageState>,
  mode: BuildMode | undefined,
): JobPlan[] {
  const out: JobPlan[] = [];
  for (const route of routes) {
    for (const scenario of scenarios) {
      if (route.scenarios && !route.scenarios.includes(scenario.name)) continue;
      if (route.source !== 'not-found' && !scenarioAllows(scenario, route)) continue;
      const url = new URL(route.path, `${baseUrl}/`).href;
      const state = states.get(scenario.name);
      const job: PageJob = {
        id: jobId(route, scenario.name, mode),
        url,
        route: { url, pattern: route.pattern },
        scenario: {
          name: scenario.name,
          context: state ? { ...scenario.context, storageState: state } : scenario.context,
          initScripts: scenario.initScripts,
          cookies: scenario.cookies,
          cookieUrl: baseUrl,
          mocks: scenario.mocks,
          ...(scenario.localStorage ? { localStorage: scenario.localStorage } : {}),
          ...(scenario.sessionStorage ? { sessionStorage: scenario.sessionStorage } : {}),
        },
        ready: readyOptions(config, route),
      };
      if (route.expectStatus) job.expectedStatuses = route.expectStatus;
      if (route.expectRedirect !== undefined) job.expectRedirect = route.expectRedirect;
      out.push({ job, route, scenario });
    }
  }
  return out;
}

/** Deterministic split of jobs across CI shards (independent of order and mode). */
function inShard(plan: JobPlan, shard: { index: number; total: number } | undefined): boolean {
  if (!shard || shard.total === 1) return true;
  const digest = createHash('sha1').update(`${plan.route.path}|${plan.scenario.name}`).digest();
  return digest.readUInt32BE(0) % shard.total === shard.index - 1;
}

async function fetchText(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    return response.ok ? await response.text() : undefined;
  } catch {
    return undefined;
  }
}

export async function run(options: RunOptions = {}): Promise<RunResult> {
  const cwd = options.cwd ?? process.cwd();
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  const startedAt = new Date();
  const notes: string[] = [];

  let config: ResolvedConfig;
  try {
    const loaded = await loadConfig({ cwd, ...(options.config !== undefined ? { file: options.config } : {}) });
    config = resolveConfig(loaded.config, {
      rootDir: loaded.rootDir,
      ...(loaded.file !== undefined ? { configFile: loaded.file } : {}),
      overrides: options.overrides ?? {},
    });
  } catch (error) {
    if (error instanceof ConfigError) throw new RunError(error.message, ExitCode.Usage);
    throw error;
  }

  const adapter = selectAdapter(config.adapter, config.rootDir);
  const packageManager = detectPackageManager(config.rootDir);
  const { reporters, unsupported } = createReporters(config.reporters);
  reporters.push(...(options.reporters ?? []));
  if (unsupported.length > 0) notes.push(`Reporter${unsupported.length === 1 ? '' : 's'} not available yet: ${unsupported.join(', ')}.`);

  const playwright = await loadPlaywright(config.rootDir);
  const modes: BuildMode[] = config.server.mode === 'both' ? ['production', 'development'] : [config.server.mode];
  if (modes.length > 1 && config.server.url !== undefined) {
    throw new RunError('--mode both starts the app twice, so it cannot be combined with --url / server.url.', ExitCode.Usage);
  }
  const scenarios = config.scenarios.filter(
    (scenario) => config.scenarioFilter.length === 0 || config.scenarioFilter.includes(scenario.name),
  );

  let browser: Browser | undefined;
  let server: RunningServer | undefined;
  const abort = (): void => {
    void browser?.close().catch(() => {});
    void server?.stop();
  };
  options.signal?.addEventListener('abort', abort, { once: true });

  try {
    try {
      browser = await launchBrowser(playwright, {
        browser: config.browser.name,
        headless: config.browser.headless,
        ...(config.browser.channel !== undefined ? { channel: config.browser.channel } : {}),
      });
    } catch (error) {
      if (error instanceof BrowserMissingError) {
        throw new RunError(
          `${config.browser.name} is not installed for Playwright ${playwright.version}. Run: ${selfCommand(packageManager, `install ${config.browser.name}`)}`,
          ExitCode.Browser,
        );
      }
      throw new RunError(`Could not launch ${config.browser.name}: ${error instanceof Error ? error.message : String(error)}`, ExitCode.Browser);
    }

    if (config.screenshots !== 'off') rmSync(join(config.outputDir, 'screenshots'), { recursive: true, force: true });
    const resolver = createResolver(config.rootDir);
    const pages: PageResult[] = [];
    const allIssues: Issue[] = [];
    const expired: ExpiredRule[] = [];
    const baseUrls: string[] = [];
    const order = new Map<string, number>();
    let context: ReporterContext | undefined;
    let staticPlan: RoutePlan | undefined;

    for (const mode of modes) {
      const modeTag = modes.length > 1 ? mode : undefined;
      const prepared = await prepareServer(config, adapter, packageManager, write, mode);
      server = prepared.server;
      const baseUrl = prepared.baseUrl;
      baseUrls.push(baseUrl);
      const hookContext = { baseUrl, rootDir: config.rootDir };
      let teardown: (() => Promise<void> | void) | undefined;
      try {
        // Build output (manifests) exists now; plan the routes once.
        staticPlan ??= planStaticRoutes(config, adapter, packageManager, notes);
        const plan = await planServerRoutes(config, adapter, staticPlan, baseUrl, fetchText, modes.indexOf(mode) === 0 ? notes : []);

        const setupResult = await config.hooks.setup?.(hookContext);
        if (typeof setupResult === 'function') teardown = setupResult;

        const states = new Map<string, StorageState>();
        for (const scenario of scenarios) {
          if (!scenario.login) continue;
          try {
            states.set(
              scenario.name,
              await performLogin(browser, { name: scenario.name, context: scenario.context, mocks: scenario.mocks, cookies: scenario.cookies, cookieUrl: baseUrl }, scenario.login, baseUrl),
            );
          } catch (error) {
            throw new RunError(error instanceof LoginError ? error.message : String(error), ExitCode.Usage);
          }
        }

        const jobPlans = buildJobs(config, plan.routes, scenarios, baseUrl, states, modeTag).filter((entry) => inShard(entry, config.shard));
        const routeOf = new Map(jobPlans.map((entry) => [entry.job.id, entry.route]));
        for (const entry of jobPlans) order.set(entry.job.id, order.size);

        if (!context) {
          const crawlNote = config.routes.crawl ? ' (plus crawled links)' : '';
          context = { config, baseUrl, totalPages: jobPlans.length * modes.length, write };
          for (const reporter of reporters) await reporter.onBegin?.(context);
          if (crawlNote) notes.push(`Crawling up to ${config.routes.crawl ? config.routes.crawl.limit : 0} more routes from the pages it tests.`);
          if (config.shard) notes.push(`Shard ${config.shard.index}/${config.shard.total}: ${jobPlans.length} of the pages.`);
          for (const note of notes) write(`  ${note}\n`);
        }
        const reporterContext = context;

        // Development servers compile each route on its first request.
        if (mode === 'development') {
          await Promise.all(
            [...new Set(jobPlans.map((entry) => entry.job.url))].map((url) =>
              fetch(url, { signal: AbortSignal.timeout(config.server.timeout) }).catch(() => undefined),
            ),
          );
        }

        const engine: EngineOptions = {
          ...DEFAULT_ENGINE,
          workers: config.workers,
          retries: config.retries,
          normalize: normalizeOptions(config, adapter),
          runtime: { ignoreSelectors: config.ignore.selectors },
          reportUnusedSuppression: config.checks.suppressedWarnings === 'strict',
          propsAudit: config.checks.propsAudit,
          parseStage: config.checks.invalidHtml || config.checks.externalChanges,
          rootDir: config.rootDir,
          resolver,
          serverEnvironment: serverEnvironment(config),
          screenshots: config.screenshots,
        };

        const crawl = config.routes.crawl;
        const seenPaths = new Set(plan.routes.map((route) => route.path));
        const crawled: PlannedRoute[] = [];
        let crawlBudget = crawl ? crawl.limit : 0;
        let collecting = crawl !== false;
        const pending: Promise<void>[] = [];
        const onResult = (pageRun: PageRun): void => {
          const issues = filterChecks(config, pageRun.analysis.issues);
          if (modeTag) for (const issue of issues) issue.mode = modeTag;
          expired.push(...applyIgnores(issues, { textPatterns: config.ignore.textPatterns, rules: config.ignore.issues }));
          const page = toPageResult(pageRun, issues, routeOf.get(pageRun.job.id), modeTag);
          if (pageRun.screenshots) page.screenshots = writeScreenshots(config.outputDir, pageRun, pageRun.screenshots);
          if (server) {
            const logs = serverLogsFor(pageRun, server.logs());
            if (logs.length > 0) page.serverLogs = logs;
          }
          pages.push(page);
          allIssues.push(...issues);
          for (const reporter of reporters) pending.push(Promise.resolve(reporter.onPage?.(page, issues, reporterContext)));

          if (collecting && crawlBudget > 0) {
            const snapshot = pageRun.capture.runtime.snapshots.find((entry) => entry.seq === pageRun.capture.stableSnapshot);
            if (!snapshot) return;
            for (const path of linksFromSnapshot(snapshot.tree, pageRun.capture.finalUrl)) {
              if (crawlBudget <= 0) break;
              if (seenPaths.has(path) || !routeAllowed(config, path)) continue;
              seenPaths.add(path);
              crawlBudget--;
              crawled.push({ path, pattern: patternFor(path, plan.patterns), source: 'crawl' });
            }
          }
        };

        await runJobs(browser, jobPlans.map((entry) => entry.job), engine, onResult);

        // Crawl: test newly found links, level by level.
        for (let depth = 1; crawl && depth <= crawl.depth && crawled.length > 0; depth++) {
          const level = crawled.splice(0, crawled.length);
          if (depth === crawl.depth) collecting = false;
          const next = buildJobs(config, level, scenarios, baseUrl, states, modeTag).filter((entry) => inShard(entry, config.shard));
          for (const entry of next) {
            order.set(entry.job.id, order.size);
            routeOf.set(entry.job.id, entry.route);
          }
          await runJobs(browser, next.map((entry) => entry.job), engine, onResult);
        }
        await Promise.all(pending);
      } finally {
        try {
          await teardown?.();
          await config.hooks.teardown?.(hookContext);
        } finally {
          await server?.stop();
          server = undefined;
        }
      }
    }

    if (modes.length > 1) compareModes(allIssues);
    pages.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
    const finishedAt = new Date();
    const report: Report = {
      schemaVersion: REPORT_SCHEMA_VERSION,
      tool: { name: 'hydration-proof', version: VERSION },
      run: {
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        cwd: config.rootDir,
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        playwright: playwright.version,
        browsers: [`${config.browser.name}${config.browser.channel ? ` (${config.browser.channel})` : ''} ${browser.version()}`],
        mode: config.server.mode,
        baseUrl: baseUrls.join(', '),
        ...(process.env['GITHUB_ACTIONS'] ? { ci: 'github-actions' } : process.env['GITLAB_CI'] ? { ci: 'gitlab' } : process.env['CI'] ? { ci: 'ci' } : {}),
      },
      summary: summarize(pages, allIssues),
      pages,
      issues: allIssues,
    };

    const failures = policy(config, report, expired);
    const exitCode = failures.length > 0 ? ExitCode.Failed : ExitCode.Ok;
    const files: string[] = [];
    const endContext = context ?? { config, baseUrl: baseUrls[0] ?? '', totalPages: 0, write };
    for (const reporter of reporters) {
      const written = await reporter.onEnd?.(report, { ...endContext, exitCode, failures });
      if (written) files.push(...written);
    }
    return { report, exitCode, failures, files, notes };
  } finally {
    options.signal?.removeEventListener('abort', abort);
    await browser?.close().catch(() => {});
    await server?.stop();
  }
}
