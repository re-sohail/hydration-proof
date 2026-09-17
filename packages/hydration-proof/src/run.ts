import { createHash } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { Browser } from 'playwright-core';
import { selectAdapter, UnknownAdapterError, type Adapter } from './adapters/index.ts';
import { applyIgnores, type ExpiredRule } from './analyze/ignore.ts';
import { applyBaseline, BaselineError, buildBaseline, readBaseline, writeBaseline, type BaselineFile, type ExpiredEntry } from './ci/baseline.ts';
import { ExitCode } from './ci/exit-codes.ts';
import { OwnerResolver } from './ci/owners.ts';
import { createRedactor } from './ci/redact.ts';
import { ConfigError, loadConfig } from './config/load.ts';
import { resolveConfig, type CliOverrides, type ResolvedConfig, type ResolvedScenario } from './config/resolve.ts';
import type { BrowserName, BuildMode } from './config/types.ts';
import { BrowserMissingError, launchBrowser } from './engine/browser.ts';
import { DEFAULT_READY, type ReadyOptions } from './engine/capture.ts';
import { createResolver } from './engine/enrich.ts';
import { LoginError, performLogin, type StorageState } from './engine/login.ts';
import { loadPlaywright } from './engine/playwright.ts';
import { DEFAULT_ENGINE, runJobs, type BrowserSource, type EngineOptions, type PageJob, type PageRun } from './engine/run.ts';
import type { RunningServer } from './engine/server.ts';
import { REPORT_SCHEMA_VERSION, type Issue, type PageResult, type Report } from './report/model.ts';
import { createReporters, type Reporter, type ReporterContext } from './report/reporters/index.ts';
import { classifyEnvironments } from './matrix/classify.ts';
import { linksFromSnapshot, patternFor } from './routes/crawl.ts';
import { matchesAny, pathOf } from './routes/pattern.ts';
import { RunError } from './run/errors.ts';
import { planServerRoutes, planStaticRoutes, routeAllowed, type PlannedRoute, type RoutePlan } from './run/plan.ts';
import { appendHistory, historyEntry, readHistory } from './report/history.ts';
import { changedRouteFilter, type RouteFilter } from './run/changed.ts';
import { runLateChecks } from './run/checks.ts';
import { runProjects } from './run/projects.ts';
import { isProbeCandidate, runProbes, type ProbeTarget } from './run/probes.ts';
import { aggregateRuns } from './run/repeat.ts';
import {
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
import { currentBranch, currentCommit } from './util/git.ts';
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
  /** Where the reports were written. */
  outputDir: string;
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

const REPEAT_SUFFIX = /#\d+$/;

function withQuery(url: string, query: Record<string, string>): string {
  const entries = Object.entries(query);
  if (entries.length === 0) return url;
  const parsed = new URL(url);
  for (const [key, value] of entries) parsed.searchParams.set(key, value);
  return parsed.href;
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
      if (route.scenarios && !route.scenarios.includes(scenario.name) && !route.scenarios.includes(scenario.base)) continue;
      if (route.source !== 'not-found' && !scenarioAllows(scenario, route)) continue;
      const url = withQuery(new URL(route.path, `${baseUrl}/`).href, scenario.query);
      const state = states.get(scenario.base);
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
          browser: scenario.browser,
          cpu: scenario.cpu,
          cache: scenario.cache,
          ...(scenario.network ? { network: scenario.network } : {}),
          ...(scenario.clock !== undefined ? { clock: scenario.clock } : {}),
          ...(scenario.randomSeed !== undefined ? { randomSeed: scenario.randomSeed } : {}),
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

  if (config.projects.length > 0) {
    return runProjects(config, (project) => run(project), {
      overrides: options.overrides ?? {},
      write,
      reporters: options.reporters ?? [],
      ...(options.signal ? { signal: options.signal } : {}),
    });
  }

  let adapter: Adapter;
  try {
    adapter = selectAdapter(config.adapter, config.rootDir, config.plugins.flatMap((plugin) => plugin.adapters ?? []));
  } catch (error) {
    if (error instanceof UnknownAdapterError) throw new RunError(error.message, ExitCode.Usage);
    throw error;
  }
  const packageManager = detectPackageManager(config.rootDir);
  const { reporters, unsupported } = createReporters(config.reporters);
  reporters.push(...config.plugins.flatMap((plugin) => plugin.reporters ?? []), ...(options.reporters ?? []));
  if (unsupported.length > 0) notes.push(`Reporter${unsupported.length === 1 ? '' : 's'} not available yet: ${unsupported.join(', ')}.`);

  let baseline: BaselineFile | undefined;
  try {
    baseline = readBaseline(config.ci.baseline);
  } catch (error) {
    if (error instanceof BaselineError) throw new RunError(error.message, ExitCode.Usage);
    throw error;
  }
  const baselineName = relative(config.rootDir, config.ci.baseline) || config.ci.baseline;
  if (config.ci.newIssuesOnly && !baseline && !config.ci.updateBaseline) {
    throw new RunError(
      `--new-only compares with a baseline, but ${baselineName} does not exist. Create it with: ${selfCommand(packageManager, 'baseline')}`,
      ExitCode.Usage,
    );
  }
  const expiredBaseline: ExpiredEntry[] = [];
  const owners = new OwnerResolver({ rootDir: config.rootDir, routes: config.owners.routes, codeowners: config.owners.codeowners });
  const redactor = config.redact === false ? undefined : createRedactor({ builtIn: config.redact.builtIn, patterns: config.redact.patterns });
  /** Owners and baseline state of new findings (after ignore rules). */
  const prepareIssues = (issues: Issue[]): void => {
    owners.assign(issues);
    if (baseline) expiredBaseline.push(...applyBaseline(issues, baseline, { newOnly: config.ci.newIssuesOnly }));
  };
  const shownPage = (page: PageResult): PageResult => (redactor ? redactor.page(page) : page);
  const shownIssues = (issues: Issue[]): Issue[] => (redactor ? issues.map((issue) => redactor.issue(issue)) : issues);
  if (baseline && config.ci.newIssuesOnly) notes.push(`Only findings that are not in ${baselineName} fail the run.`);

  const playwright = await loadPlaywright(config.rootDir);
  const modes: BuildMode[] = config.server.mode === 'both' ? ['production', 'development'] : [config.server.mode];
  if (modes.length > 1 && config.server.url !== undefined) {
    throw new RunError('--mode both starts the app twice, so it cannot be combined with --url / server.url.', ExitCode.Usage);
  }
  const scenarios = config.scenarios.filter(
    (scenario) =>
      config.scenarioFilter.length === 0 || config.scenarioFilter.includes(scenario.name) || config.scenarioFilter.includes(scenario.base),
  );
  notes.push(...config.matrixNotes);
  const bases = new Set(scenarios.map((scenario) => scenario.base));
  if (scenarios.length > bases.size) {
    notes.push(`Matrix: ${scenarios.length} environments for ${bases.size} scenario${bases.size === 1 ? '' : 's'}.`);
  }

  const launched = new Map<BrowserName, Promise<Browser>>();
  let server: RunningServer | undefined;
  const closeBrowsers = async (): Promise<void> => {
    await Promise.all([...launched.values()].map((pending) => pending.then((browser) => browser.close()).catch(() => {})));
  };
  const abort = (): void => {
    void closeBrowsers();
    void server?.stop();
  };
  options.signal?.addEventListener('abort', abort, { once: true });

  const launch = async (name: BrowserName): Promise<Browser> => {
    try {
      return await launchBrowser(playwright, {
        browser: name,
        headless: config.browser.headless,
        // A channel (installed Chrome / Edge) only applies to Chromium.
        ...(config.browser.channel !== undefined && name === 'chromium' ? { channel: config.browser.channel } : {}),
      });
    } catch (error) {
      if (error instanceof BrowserMissingError) {
        throw new RunError(
          `${name} is not installed for Playwright ${playwright.version}. Run: ${selfCommand(packageManager, `install ${name}`)}`,
          ExitCode.Browser,
        );
      }
      throw new RunError(`Could not launch ${name}: ${errorText(error)}`, ExitCode.Browser);
    }
  };
  const browsers: BrowserSource = (name) => {
    const key = name ?? config.browser.name;
    let pending = launched.get(key);
    if (!pending) {
      pending = launch(key);
      launched.set(key, pending);
    }
    return pending;
  };

  try {
    // Launch every needed browser up front, so a missing one fails fast.
    const neededBrowsers = [...new Set([config.browser.name, ...scenarios.map((scenario) => scenario.browser)])];
    await Promise.all(neededBrowsers.map((name) => browsers(name)));
    const browser = await browsers(config.browser.name);

    if (config.screenshots !== 'off') rmSync(join(config.outputDir, 'screenshots'), { recursive: true, force: true });
    const resolver = createResolver(config.rootDir);
    const pages: PageResult[] = [];
    const allIssues: Issue[] = [];
    const expired: ExpiredRule[] = [];
    const baseUrls: string[] = [];
    const order = new Map<string, number>();
    let context: ReporterContext | undefined;
    let staticPlan: RoutePlan | undefined;
    let routeFilter: RouteFilter | undefined;
    let printedNotes = 0;

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
        if (!staticPlan) {
          staticPlan = planStaticRoutes(config, adapter, packageManager, notes);
          routeFilter = changedRouteFilter(config, adapter, staticPlan, notes);
          if (routeFilter) staticPlan = { ...staticPlan, routes: staticPlan.routes.filter(routeFilter) };
        }
        const serverPlan = await planServerRoutes(config, adapter, staticPlan, baseUrl, fetchText, modes.indexOf(mode) === 0 ? notes : []);
        const plan = routeFilter ? { ...serverPlan, routes: serverPlan.routes.filter(routeFilter) } : serverPlan;

        try {
          const setupResult = await config.hooks.setup?.(hookContext);
          if (typeof setupResult === 'function') teardown = setupResult;
        } catch (error) {
          throw new RunError(`The setup hook failed: ${errorText(error)}`, ExitCode.Usage);
        }

        const states = new Map<string, StorageState>();
        const loggedIn = new Set<string>();
        for (const scenario of scenarios) {
          // One login per configured scenario, shared by its matrix environments.
          if (!scenario.login || loggedIn.has(scenario.base)) continue;
          loggedIn.add(scenario.base);
          try {
            states.set(
              scenario.base,
              await performLogin(browser, { name: scenario.base, context: scenario.context, mocks: scenario.mocks, cookies: scenario.cookies, cookieUrl: baseUrl }, scenario.login, baseUrl),
            );
          } catch (error) {
            throw new RunError(error instanceof LoginError ? error.message : String(error), ExitCode.Usage);
          }
        }

        const jobPlans = buildJobs(config, plan.routes, scenarios, baseUrl, states, modeTag).filter((entry) => inShard(entry, config.shard));
        const planOf = new Map(jobPlans.map((entry) => [entry.job.id, entry]));
        for (const entry of jobPlans) order.set(entry.job.id, order.size);
        const repeated = (list: readonly JobPlan[]): PageJob[] =>
          config.repeat === 1
            ? list.map((entry) => entry.job)
            : list.flatMap((entry) => Array.from({ length: config.repeat }, (_, index) => ({ ...entry.job, id: `${entry.job.id}#${index + 1}` })));

        if (!context) {
          const crawlNote = config.routes.crawl ? ' (plus crawled links)' : '';
          context = { config, baseUrl, totalPages: jobPlans.length * modes.length, write };
          for (const reporter of reporters) await reporter.onBegin?.(context);
          if (crawlNote) notes.push(`Crawling up to ${config.routes.crawl ? config.routes.crawl.limit : 0} more routes from the pages it tests.`);
          if (config.shard) notes.push(`Shard ${config.shard.index}/${config.shard.total}: ${jobPlans.length} of the pages.`);
          if (config.repeat > 1) notes.push(`Loading every page ${config.repeat} times to find flaky findings.`);
          for (const note of notes) write(`  ${note}\n`);
          printedNotes = notes.length;
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
          screenshotMask: config.redact === false ? [] : config.redact.selectors,
          detectors: config.plugins.flatMap((plugin) => plugin.detectors ?? []),
          allowNoReact: adapter.pagesWithoutReact ?? false,
        };

        const crawl = config.routes.crawl;
        const seenPaths = new Set(plan.routes.map((route) => route.path));
        const crawled: PlannedRoute[] = [];
        let crawlBudget = crawl ? crawl.limit : 0;
        let collecting = crawl !== false;
        const pending: Promise<void>[] = [];
        interface Buffered {
          run: PageRun;
          page: PageResult;
          issues: Issue[];
        }
        const buffered = new Map<string, Buffered[]>();
        const finish = (entries: Buffered[]): void => {
          const aggregated = aggregateRuns(entries.map((entry) => ({ page: entry.page, issues: entry.issues })));
          const page = aggregated.page;
          const shot =
            entries.find((entry) => entry.run.screenshots && entry.issues.some((issue) => !issue.ignored && issue.severity !== 'info')) ??
            entries.find((entry) => entry.run.screenshots);
          if (shot?.run.screenshots) page.screenshots = writeScreenshots(config.outputDir, shot.run, shot.run.screenshots);
          pages.push(page);
          allIssues.push(...aggregated.issues);
          const visiblePage = shownPage(page);
          const visibleIssues = shownIssues(aggregated.issues);
          for (const reporter of reporters) pending.push(Promise.resolve(reporter.onPage?.(visiblePage, visibleIssues, reporterContext)));
        };
        const onResult = (pageRun: PageRun): void => {
          const id = pageRun.job.id.replace(REPEAT_SUFFIX, '');
          const planned = planOf.get(id);
          const issues = filterChecks(config, pageRun.analysis.issues);
          if (modeTag) for (const issue of issues) issue.mode = modeTag;
          expired.push(...applyIgnores(issues, { textPatterns: config.ignore.textPatterns, rules: config.ignore.issues }));
          prepareIssues(issues);
          const page = toPageResult(pageRun, issues, planned?.route, modeTag);
          page.id = id;
          if (planned) {
            const { scenario } = planned;
            if (scenario.base !== scenario.name) page.baseScenario = scenario.base;
            page.environment = { browser: scenario.browser, ...scenario.environment };
          }
          if (server) {
            const logs = serverLogsFor(pageRun, server.logs());
            if (logs.length > 0) page.serverLogs = logs;
          }
          const entries = buffered.get(id) ?? [];
          entries.push({ run: pageRun, page, issues });
          buffered.set(id, entries);
          if (entries.length >= config.repeat) {
            buffered.delete(id);
            finish(entries);
          }

          if (collecting && crawlBudget > 0 && entries.length === 1) {
            const snapshot = pageRun.capture.runtime.snapshots.find((entry) => entry.seq === pageRun.capture.stableSnapshot);
            if (!snapshot) return;
            for (const path of linksFromSnapshot(snapshot.tree, pageRun.capture.finalUrl)) {
              if (crawlBudget <= 0) break;
              if (seenPaths.has(path) || !routeAllowed(config, path)) continue;
              if (routeFilter && !routeFilter({ path, pattern: patternFor(path, plan.patterns), source: 'crawl' })) continue;
              seenPaths.add(path);
              crawlBudget--;
              crawled.push({ path, pattern: patternFor(path, plan.patterns), source: 'crawl' });
            }
          }
        };

        await runJobs(browsers, repeated(jobPlans), engine, onResult);

        // Crawl: test newly found links, level by level.
        for (let depth = 1; crawl && depth <= crawl.depth && crawled.length > 0; depth++) {
          const level = crawled.splice(0, crawled.length);
          if (depth === crawl.depth) collecting = false;
          const next = buildJobs(config, level, scenarios, baseUrl, states, modeTag).filter((entry) => inShard(entry, config.shard));
          for (const entry of next) {
            order.set(entry.job.id, order.size);
            planOf.set(entry.job.id, entry);
          }
          await runJobs(browsers, repeated(next), engine, onResult);
        }
        await Promise.all(pending);

        // Probes: prove the causes of value mismatches on this server.
        if (config.probes) {
          const byPage = new Map<string, Issue[]>();
          for (const page of pages) {
            if (page.mode !== modeTag || !planOf.has(page.id)) continue;
            const fingerprints = new Set(page.issues);
            const issues = allIssues.filter(
              (issue) =>
                fingerprints.has(issue.fingerprint) &&
                issue.route.url === page.url &&
                issue.scenario === page.scenario &&
                issue.mode === page.mode &&
                isProbeCandidate(issue),
            );
            if (issues.length > 0) byPage.set(page.id, issues);
          }
          const targets: ProbeTarget[] = [...byPage.entries()]
            .map(([id, issues]) => ({ job: planOf.get(id)?.job, issues }))
            .filter((target): target is ProbeTarget => target.job !== undefined)
            .sort((a, b) => b.issues.filter((issue) => issue.severity === 'error').length - a.issues.filter((issue) => issue.severity === 'error').length)
            .slice(0, config.probes.maxPages);
          if (byPage.size > targets.length && targets.length === config.probes.maxPages) {
            notes.push(`Probed ${targets.length} of ${byPage.size} pages with value mismatches (probes.maxPages).`);
          }
          if (targets.length > 0) {
            write(`  Probing ${targets.length} page${targets.length === 1 ? '' : 's'} to prove causes...\n`);
            const loads = await runProbes(browsers, targets, engine, config.probes.factors, engine.serverEnvironment);
            notes.push(`Probes: ${loads} extra page loads for ${targets.length} page${targets.length === 1 ? '' : 's'}.`);
          }
        }

        // Interaction and navigation checks.
        await runLateChecks({
          config,
          adapter,
          browsers,
          engine,
          normalize: engine.normalize!,
          baseUrl,
          mode: modeTag,
          plan,
          pages: pages.filter((page) => page.mode === modeTag && planOf.has(page.id)).map((page) => ({ page, planned: planOf.get(page.id)! })),
          allIssues,
          expired,
          notes,
          write,
          prepare: prepareIssues,
        });
      } finally {
        for (const step of [teardown, config.hooks.teardown && (() => config.hooks.teardown?.(hookContext))]) {
          try {
            await step?.();
          } catch (error) {
            // A failing teardown must not hide the result (or the error) of the run.
            notes.push(`The teardown hook failed: ${errorText(error)}`);
          }
        }
        await server?.stop();
        server = undefined;
      }
    }

    classifyEnvironments(pages, allIssues);
    const commit = currentCommit(config.rootDir);
    const branch = currentBranch(config.rootDir);
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
        browsers: await Promise.all(
          [...launched.entries()].map(async ([name, pending]) => {
            const launchedBrowser = await pending;
            return `${name}${name === 'chromium' && config.browser.channel ? ` (${config.browser.channel})` : ''} ${launchedBrowser.version()}`;
          }),
        ),
        mode: config.server.mode,
        baseUrl: baseUrls.join(', '),
        ...(process.env['GITHUB_ACTIONS'] ? { ci: 'github-actions' } : process.env['GITLAB_CI'] ? { ci: 'gitlab' } : process.env['CI'] ? { ci: 'ci' } : {}),
        ...(commit !== undefined ? { commit } : {}),
        ...(branch !== undefined ? { branch } : {}),
      },
      summary: summarize(pages, allIssues),
      pages,
      issues: allIssues,
    };
    if (config.ci.history) {
      const history = readHistory(config.ci.history);
      if (history.length > 0) report.history = history;
    }
    if (config.ci.updateBaseline) {
      const next = buildBaseline(allIssues, baseline);
      writeBaseline(config.ci.baseline, next, config.rootDir);
      notes.push(`Baseline written to ${baselineName}: ${next.entries.length} finding${next.entries.length === 1 ? '' : 's'}.`);
    }

    if (notes.length > printedNotes) write(`\n${notes.slice(printedNotes).map((note) => `  ${note}\n`).join('')}`);
    const failures = policy(config, report, expired, expiredBaseline);
    const exitCode = failures.length > 0 ? ExitCode.Failed : ExitCode.Ok;
    if (config.ci.history) appendHistory(config.ci.history, historyEntry(report));
    const shown = redactor ? redactor.report(report) : report;
    if (redactor && redactor.counts.size > 0) shown.summary = { ...shown.summary, redacted: Object.fromEntries(redactor.counts) };
    const files: string[] = [];
    const endContext = context ?? { config, baseUrl: baseUrls[0] ?? '', totalPages: 0, write };
    for (const reporter of reporters) {
      const written = await reporter.onEnd?.(shown, { ...endContext, exitCode, failures });
      if (written) files.push(...written);
    }
    return { report: shown, exitCode, failures, files, notes, outputDir: config.outputDir };
  } finally {
    options.signal?.removeEventListener('abort', abort);
    await closeBrowsers();
    await server?.stop();
  }
}
