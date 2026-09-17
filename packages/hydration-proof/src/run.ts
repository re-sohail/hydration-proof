import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser } from 'playwright-core';
import { selectAdapter, type Adapter } from './adapters/index.ts';
import { applyIgnores, type ExpiredRule } from './analyze/ignore.ts';
import { ExitCode } from './ci/exit-codes.ts';
import { ConfigError, loadConfig } from './config/load.ts';
import { resolveConfig, type CliOverrides, type ResolvedConfig } from './config/resolve.ts';
import type { BuildMode, RouteEntry } from './config/types.ts';
import type { DiagnosisContext } from './diagnose/index.ts';
import { createResolver } from './engine/enrich.ts';
import { DEFAULT_NORMALIZE, genericMarkers, reactMarkers, type NormalizeOptions } from './dom/normalize.ts';
import { BrowserMissingError, launchBrowser } from './engine/browser.ts';
import { DEFAULT_READY, type ReadyOptions } from './engine/capture.ts';
import { loadPlaywright } from './engine/playwright.ts';
import { DEFAULT_ENGINE, runJobs, type EngineOptions, type PageJob, type PageRun, type PageScreenshots } from './engine/run.ts';
import { isReachable, ServerStartError, startServer, type RunningServer } from './engine/server.ts';
import type { Severity } from './issues/registry.ts';
import { REPORT_SCHEMA_VERSION, type Issue, type PageResult, type Report, type Screenshots, type Summary } from './report/model.ts';
import { createReporters, type Reporter, type ReporterContext } from './report/reporters/index.ts';
import { expandPattern, isDynamicPattern, matchesAny, pathOf } from './routes/pattern.ts';
import { detectPackageManager, selfCommand, type PackageManager } from './util/package-manager.ts';
import { freePort } from './util/port.ts';
import { VERSION } from './util/version.ts';

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

export class RunError extends Error {
  override name = 'RunError';
  readonly exitCode: ExitCode;
  readonly details: string | undefined;

  constructor(message: string, exitCode: ExitCode, details?: string) {
    super(message);
    this.exitCode = exitCode;
    this.details = details;
  }
}

interface PlannedRoute extends RouteEntry {
  pattern: string;
}

function planRoutes(config: ResolvedConfig, adapter: Adapter, packageManager: PackageManager, notes: string[]): PlannedRoute[] {
  const planned = new Map<string, PlannedRoute>();
  const add = (route: RouteEntry): void => {
    const pattern = route.pattern ?? pathOf(route.path);
    if (!planned.has(route.path)) planned.set(route.path, { ...route, pattern });
  };

  for (const route of config.routes.paths) add(route);

  const discover = config.routes.discover ?? (config.routes.paths.length === 0 && adapter.discoverRoutes !== undefined);
  if (discover && adapter.discoverRoutes) {
    const skipped: string[] = [];
    for (const route of adapter.discoverRoutes({ rootDir: config.rootDir, packageManager })) {
      if (!route.dynamic) {
        add({ path: route.pattern, ...(route.expectStatus ? { expectStatus: route.expectStatus } : {}) });
      } else if (!config.routes.dynamic[route.pattern]) {
        skipped.push(route.pattern);
      }
    }
    if (skipped.length > 0) {
      notes.push(
        `Skipped ${skipped.length} dynamic route${skipped.length === 1 ? '' : 's'} without example values (${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? ', …' : ''}). Add them under routes.dynamic.`,
      );
    }
  }

  for (const [pattern, values] of Object.entries(config.routes.dynamic)) {
    for (const value of values) add({ path: isDynamicPattern(pattern) ? expandPattern(pattern, value) : pattern, pattern });
  }

  if (planned.size === 0) add({ path: '/' });

  return [...planned.values()].filter((route) => {
    const path = pathOf(route.path);
    if (config.routes.include.length > 0 && !matchesAny(path, config.routes.include) && !matchesAny(route.pattern, config.routes.include)) {
      return false;
    }
    if (matchesAny(path, config.routes.exclude) || matchesAny(route.pattern, config.routes.exclude)) return false;
    if (config.routes.grep && !config.routes.grep.test(route.path)) return false;
    return true;
  });
}

function runCommand(command: string, cwd: string, env: Record<string, string>, write: (text: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, env: { ...process.env, ...env }, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const collect = (chunk: Buffer): void => {
      tail = (tail + chunk.toString('utf8')).slice(-8_000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => reject(new RunError(`Could not run "${command}": ${error.message}`, ExitCode.Server)));
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new RunError(`"${command}" failed with exit code ${String(code)}.`, ExitCode.Server, tail));
    });
    write(`  Building: ${command}\n`);
  });
}

async function prepareServer(
  config: ResolvedConfig,
  adapter: Adapter,
  packageManager: PackageManager,
  write: (text: string) => void,
  mode: BuildMode,
): Promise<{ baseUrl: string; server?: RunningServer }> {
  const { server } = config;
  if (server.url !== undefined) {
    if (!(await isReachable(server.url, 10_000))) {
      throw new RunError(`Nothing answers at ${server.url}. Start the app first or remove --url to let hydration-proof start it.`, ExitCode.Server);
    }
    return { baseUrl: server.url };
  }

  const commands = adapter.commands({ rootDir: config.rootDir, packageManager });
  const production = mode === 'production';
  const custom = production
    ? server.mode === 'development' ? undefined : server.command
    : (server.devCommand ?? (server.mode === 'development' ? server.command : undefined));
  const command = custom ?? (production ? commands.start : commands.dev);
  if (!command) {
    throw new RunError(
      'hydration-proof does not know how to start this app. Set server.command (and server.build) in hydration-proof.config.ts, or pass --url.',
      ExitCode.Usage,
    );
  }

  if (production) {
    const build = commands.build;
    const output = commands.buildOutput ? join(server.cwd, commands.buildOutput) : undefined;
    const needed = server.buildWhen === 'always' || (server.buildWhen === 'if-missing' && (output === undefined || !existsSync(output)));
    // A custom start command only gets a build step when one is configured.
    const effective = server.build !== undefined ? server.build : custom === undefined ? build : undefined;
    if (effective && needed) await runCommand(effective, server.cwd, server.env, write);
  }

  const port = server.port ?? (await freePort());
  const host = production ? '127.0.0.1' : (adapter.devHost ?? '127.0.0.1');
  const baseUrl = `http://${host}:${port}`;
  try {
    const running = await startServer({
      name: production ? 'the app' : 'the development server',
      command: command.replaceAll('{port}', String(port)),
      cwd: server.cwd,
      env: { PORT: String(port), ...server.env },
      url: baseUrl,
      timeout: server.timeout,
      reuseExisting: server.reuseExisting && server.port !== undefined,
    });
    return { baseUrl, server: running };
  } catch (error) {
    if (error instanceof ServerStartError) {
      const tail = error.logs.slice(-30).map((line) => line.text).join('\n');
      throw new RunError(error.message, ExitCode.Server, tail);
    }
    throw error;
  }
}

function readyOptions(config: ResolvedConfig, route: RouteEntry): ReadyOptions {
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

function buildJobs(config: ResolvedConfig, routes: PlannedRoute[], baseUrl: string, modeTag?: BuildMode): PageJob[] {
  const jobs: PageJob[] = [];
  const scenarios = config.scenarios.filter(
    (scenario) => config.scenarioFilter.length === 0 || config.scenarioFilter.includes(scenario.name),
  );
  for (const route of routes) {
    for (const scenario of scenarios) {
      if (route.scenarios && !route.scenarios.includes(scenario.name)) continue;
      const url = new URL(route.path, `${baseUrl}/`).href;
      const job: PageJob = {
        id: `${route.path} [${scenario.name}]${modeTag ? ` (${modeTag})` : ''}`,
        url,
        route: { url, pattern: route.pattern },
        scenario: {
          name: scenario.name,
          context: scenario.context,
          initScripts: scenario.initScripts,
          cookies: scenario.cookies,
          cookieUrl: baseUrl,
          ...(scenario.localStorage ? { localStorage: scenario.localStorage } : {}),
          ...(scenario.sessionStorage ? { sessionStorage: scenario.sessionStorage } : {}),
        },
        ready: readyOptions(config, route),
      };
      if (route.expectStatus) job.expectedStatuses = route.expectStatus;
      jobs.push(job);
    }
  }
  return jobs;
}

function serverEnvironment(config: ResolvedConfig): DiagnosisContext['server'] {
  if (config.server.url !== undefined) return {};
  const local = new Intl.DateTimeFormat().resolvedOptions();
  const env = { ...process.env, ...config.server.env };
  const lang = env['LC_ALL'] || env['LANG'];
  const locale = lang && lang !== 'C' && lang !== 'POSIX' ? (lang.split('.')[0] ?? lang).replace('_', '-') : local.locale;
  return { locale, timezoneId: env['TZ'] || local.timeZone };
}

function slug(text: string): string {
  return text.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 40) || 'page';
}

function writeScreenshots(outputDir: string, run: PageRun, shots: PageScreenshots): Screenshots {
  const dir = join(outputDir, 'screenshots');
  mkdirSync(dir, { recursive: true });
  const base = `${slug(new URL(run.job.url).pathname)}-${createHash('sha1').update(run.job.id).digest('hex').slice(0, 8)}`;
  const out: Screenshots = {
    width: shots.width,
    height: shots.height,
    boxes: shots.boxes,
  };
  if (shots.hydrated) {
    writeFileSync(join(dir, `${base}-hydrated.jpg`), shots.hydrated);
    out.hydrated = `screenshots/${base}-hydrated.jpg`;
  }
  if (shots.server) {
    writeFileSync(join(dir, `${base}-server.jpg`), shots.server);
    out.server = `screenshots/${base}-server.jpg`;
  }
  return out;
}

function normalizeOptions(config: ResolvedConfig, adapter: Adapter): NormalizeOptions {
  return {
    ...DEFAULT_NORMALIZE,
    markers: [...reactMarkers, ...genericMarkers, ...adapter.markers],
    ignoreAttributes: config.ignore.attributes.map((pattern) => (typeof pattern === 'string' ? pattern.toLowerCase() : pattern)),
  };
}

function filterChecks(config: ResolvedConfig, issues: Issue[]): Issue[] {
  const { checks } = config;
  return issues.filter((issue) => {
    if (!checks.reactErrors && issue.code.startsWith('HP2')) return false;
    if (!checks.invalidHtml && issue.code.startsWith('HP3')) return false;
    if (!checks.externalChanges && issue.code.startsWith('HP4')) return false;
    if (checks.suppressedWarnings === 'off' && issue.code.startsWith('HP6')) return false;
    if (!checks.domDiff && issue.stage === 'hydration' && !issue.suppressed) return false;
    return true;
  });
}

const RANK: Record<Severity, number> = { error: 3, warning: 2, info: 1 };

function toPageResult(run: PageRun, issues: Issue[], mode?: BuildMode): PageResult {
  const counts: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) if (!issue.ignored) counts[issue.severity]++;
  const status = run.capture.outcome === 'navigation-failed' ? 'error' : counts.error > 0 ? 'failed' : counts.warning > 0 ? 'warning' : 'passed';
  const page: PageResult = {
    id: run.job.id,
    route: run.job.route,
    scenario: run.job.scenario.name,
    url: run.job.url,
    finalUrl: run.capture.finalUrl,
    status,
    outcome: run.capture.outcome,
    timings: run.capture.timings,
    issues: issues.map((issue) => issue.fingerprint),
    counts,
  };
  if (run.capture.document) {
    page.http = {
      status: run.capture.document.status,
      redirects: run.capture.document.redirects.map((redirect) => ({ url: redirect.url, status: redirect.status })),
    };
  }
  if (run.analysis.react) page.react = run.analysis.react;
  if (mode) page.mode = mode;
  if (run.analysis.timeline.length > 0) page.timeline = run.analysis.timeline;
  return page;
}

/** With --mode both: note issues that appear in only one build. */
function compareModes(issues: Issue[]): void {
  const modes = new Map<string, Set<string>>();
  for (const issue of issues) {
    if (!issue.mode) continue;
    const key = `${issue.fingerprint}|${issue.scenario}`;
    const set = modes.get(key) ?? new Set<string>();
    set.add(issue.mode);
    modes.set(key, set);
  }
  for (const issue of issues) {
    const set = issue.mode ? modes.get(`${issue.fingerprint}|${issue.scenario}`) : undefined;
    if (!set || set.size !== 1) continue;
    issue.evidence.push({
      kind: 'note',
      message:
        issue.mode === 'production'
          ? 'Only found in the production build.'
          : 'Only found in development (React development builds check more).',
    });
  }
}

function summarize(pages: PageResult[], issues: Issue[]): Summary {
  const summary: Summary = {
    pages: pages.length,
    routes: new Set(pages.map((page) => page.route.pattern)).size,
    passed: pages.filter((page) => page.status === 'passed').length,
    warnings: pages.filter((page) => page.status === 'warning').length,
    failed: pages.filter((page) => page.status === 'failed').length,
    errored: pages.filter((page) => page.status === 'error').length,
    issues: { error: 0, warning: 0, info: 0 },
    ignored: 0,
  };
  for (const issue of issues) {
    if (issue.ignored) summary.ignored++;
    else summary.issues[issue.severity]++;
  }
  return summary;
}

function policy(config: ResolvedConfig, report: Report, expired: ExpiredRule[]): string[] {
  const failures: string[] = [];
  const { failOn, maxWarnings } = config.ci;
  const active = report.issues.filter((issue) => !issue.ignored);
  if (failOn !== 'never') {
    const failing = active.filter((issue) => RANK[issue.severity] >= RANK[failOn]);
    if (failing.length > 0) {
      failures.push(`${failing.length} issue${failing.length === 1 ? '' : 's'} at or above "${failOn}" severity.`);
    }
  }
  if (maxWarnings !== undefined && report.summary.issues.warning > maxWarnings) {
    failures.push(`${report.summary.issues.warning} warnings exceed ci.maxWarnings (${maxWarnings}).`);
  }
  const seen = new Set<string>();
  for (const { rule } of expired) {
    const key = `${rule.fingerprint ?? ''}|${rule.code ?? ''}|${rule.route ?? ''}|${rule.expires}`;
    if (seen.has(key)) continue;
    seen.add(key);
    failures.push(`Ignore rule "${rule.reason}" expired on ${rule.expires}.`);
  }
  return failures;
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
  const routes = planRoutes(config, adapter, packageManager, notes);
  const { reporters, unsupported } = createReporters(config.reporters);
  reporters.push(...(options.reporters ?? []));
  if (unsupported.length > 0) notes.push(`Reporter${unsupported.length === 1 ? '' : 's'} not available yet: ${unsupported.join(', ')}.`);

  const playwright = await loadPlaywright(config.rootDir);
  const modes: BuildMode[] = config.server.mode === 'both' ? ['production', 'development'] : [config.server.mode];
  if (modes.length > 1 && config.server.url !== undefined) {
    throw new RunError('--mode both starts the app twice, so it cannot be combined with --url / server.url.', ExitCode.Usage);
  }
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

    for (const mode of modes) {
      const modeTag = modes.length > 1 ? mode : undefined;
      const prepared = await prepareServer(config, adapter, packageManager, write, mode);
      server = prepared.server;
      const baseUrl = prepared.baseUrl;
      baseUrls.push(baseUrl);
      try {
        const jobs = buildJobs(config, routes, baseUrl, modeTag);
        for (const job of jobs) order.set(job.id, order.size);
        if (!context) {
          context = { config, baseUrl, totalPages: jobs.length * modes.length, write };
          for (const reporter of reporters) await reporter.onBegin?.(context);
          for (const note of notes) write(`  ${note}\n`);
        }
        const reporterContext = context;

        // Development servers compile each route on its first request.
        if (mode === 'development') {
          await Promise.all(
            [...new Set(jobs.map((job) => job.url))].map((url) => fetch(url, { signal: AbortSignal.timeout(config.server.timeout) }).catch(() => undefined)),
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

        const pending: Promise<void>[] = [];
        await runJobs(browser, jobs, engine, (pageRun) => {
          const issues = filterChecks(config, pageRun.analysis.issues);
          if (modeTag) for (const issue of issues) issue.mode = modeTag;
          expired.push(...applyIgnores(issues, { textPatterns: config.ignore.textPatterns, rules: config.ignore.issues }));
          const page = toPageResult(pageRun, issues, modeTag);
          if (pageRun.screenshots) page.screenshots = writeScreenshots(config.outputDir, pageRun, pageRun.screenshots);
          pages.push(page);
          allIssues.push(...issues);
          for (const reporter of reporters) pending.push(Promise.resolve(reporter.onPage?.(page, issues, reporterContext)));
        });
        await Promise.all(pending);
      } finally {
        await server?.stop();
        server = undefined;
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
