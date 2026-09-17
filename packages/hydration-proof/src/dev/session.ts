import type { Page, Response } from 'playwright-core';
import overlaySource from 'virtual:hydration-proof/overlay';
import { selectAdapter, UnknownAdapterError } from '../adapters/index.ts';
import { analyzePage } from '../analyze/index.ts';
import { applyIgnores } from '../analyze/ignore.ts';
import { ExitCode } from '../ci/exit-codes.ts';
import { repositoryRoot } from '../ci/owners.ts';
import { palette, symbols } from '../cli/style.ts';
import { ConfigError, loadConfig } from '../config/load.ts';
import { resolveConfig, type CliOverrides, type ResolvedConfig } from '../config/resolve.ts';
import { BrowserMissingError, launchBrowser } from '../engine/browser.ts';
import { completeCapture, DEFAULT_READY, recordPage, type PageRecorder, type ReadyOptions } from '../engine/capture.ts';
import { createScenarioContext, parseContextOptions, type ScenarioSpec } from '../engine/context.ts';
import { createResolver, enrichIssues } from '../engine/enrich.ts';
import { performLogin } from '../engine/login.ts';
import { parseDocument } from '../engine/parse-stage.ts';
import { loadPlaywright } from '../engine/playwright.ts';
import type { RunningServer } from '../engine/server.ts';
import type { Issue } from '../report/model.ts';
import { issueLines } from '../report/reporters/list.ts';
import { RunError } from '../run/errors.ts';
import { filterChecks, normalizeOptions, serverEnvironment } from '../run/results.ts';
import { prepareServer } from '../run/server.ts';
import { OVERLAY_BINDING, OVERLAY_GLOBAL, type OverlayAction, type OverlayIssue, type OverlayState } from '../shared/overlay.ts';
import { detectPackageManager, selfCommand } from '../util/package-manager.ts';
import { openInEditor } from './editor.ts';

// `hydration-proof dev`: a browser window with an overlay that checks every
// page you open. The app is not changed; the overlay is injected by the
// browser.

export interface DevOptions {
  cwd: string;
  config?: string;
  overrides: CliOverrides;
  write(text: string): void;
  signal?: AbortSignal;
}

function overlayIssue(issue: Issue, absolute: (file: string) => string): OverlayIssue {
  const out: OverlayIssue = {
    fingerprint: issue.fingerprint,
    code: issue.code,
    title: issue.title,
    severity: issue.severity,
    message: issue.message,
    suggestions: issue.suggestions.slice(0, 3),
    docsUrl: issue.docsUrl,
  };
  if (issue.selector !== undefined) out.selector = issue.selector;
  if (issue.attribute !== undefined) out.attribute = issue.attribute;
  if (issue.server !== undefined) out.server = issue.server;
  if (issue.client !== undefined) out.client = issue.client;
  if (issue.component !== undefined) out.component = issue.component;
  if (issue.cause) out.cause = { title: issue.cause.title, confidence: issue.cause.confidence, ...(issue.cause.proven ? { proven: true } : {}) };
  if (issue.source) {
    out.source = { file: issue.source.file, line: issue.source.line, absolute: absolute(issue.source.file) };
    if (issue.source.column !== undefined) out.source.column = issue.source.column;
  }
  return out;
}

async function showOverlay(page: Page, state: OverlayState): Promise<void> {
  await page
    .evaluate(
      ([key, value]) => {
        const api = (globalThis as unknown as Record<string, { show(state: unknown): void } | undefined>)[key];
        api?.show(value);
      },
      [OVERLAY_GLOBAL, state] as const,
    )
    .catch(() => {});
}

async function loadConfigFor(options: DevOptions): Promise<ResolvedConfig> {
  try {
    const loaded = await loadConfig({ cwd: options.cwd, ...(options.config !== undefined ? { file: options.config } : {}) });
    return resolveConfig(loaded.config, {
      rootDir: loaded.rootDir,
      ...(loaded.file !== undefined ? { configFile: loaded.file } : {}),
      overrides: { ...options.overrides, mode: options.overrides.mode === 'production' ? 'production' : 'development', headed: true, matrix: false },
    });
  } catch (error) {
    if (error instanceof ConfigError) throw new RunError(error.message, ExitCode.Usage);
    throw error;
  }
}

export async function devSession(options: DevOptions): Promise<number> {
  const write = options.write;
  const c = palette(process.stdout);
  const config = await loadConfigFor(options);
  let adapter;
  try {
    adapter = selectAdapter(config.adapter, config.rootDir, config.plugins.flatMap((plugin) => plugin.adapters ?? []));
  } catch (error) {
    if (error instanceof UnknownAdapterError) throw new RunError(error.message, ExitCode.Usage);
    throw error;
  }
  const packageManager = detectPackageManager(config.rootDir);
  const scenario = config.scenarios.find((entry) => config.scenarioFilter.length === 0 || config.scenarioFilter.includes(entry.name) || config.scenarioFilter.includes(entry.base));
  if (!scenario) throw new RunError('No scenario to open.', ExitCode.Usage);
  const mode = config.server.mode === 'production' ? 'production' : 'development';

  const playwright = await loadPlaywright(config.rootDir);
  let server: RunningServer | undefined;
  let browser;
  try {
    browser = await launchBrowser(playwright, {
      browser: scenario.browser,
      // Tests (and remote machines) can run the session without a window.
      headless: process.env['HYDRATION_PROOF_DEV_HEADLESS'] === '1',
      ...(config.browser.channel !== undefined && scenario.browser === 'chromium' ? { channel: config.browser.channel } : {}),
    });
  } catch (error) {
    if (error instanceof BrowserMissingError) {
      throw new RunError(`${scenario.browser} is not installed. Run: ${selfCommand(packageManager, `install ${scenario.browser}`)}`, ExitCode.Browser);
    }
    throw new RunError(`Could not open ${scenario.browser}: ${error instanceof Error ? error.message : String(error)}`, ExitCode.Browser);
  }
  const done = new Promise<void>((resolve) => {
    browser.on('disconnected', () => resolve());
    options.signal?.addEventListener('abort', () => resolve(), { once: true });
  });

  try {
    const prepared = await prepareServer(config, adapter, packageManager, write, mode);
    server = prepared.server;
    const baseUrl = prepared.baseUrl;
    const repository = repositoryRoot(config.rootDir);
    const normalize = normalizeOptions(config, adapter);
    const resolver = createResolver(config.rootDir, [baseUrl, ...config.sourceOrigins]);
    const ready: ReadyOptions = {
      ...DEFAULT_READY,
      quietMs: config.ready.quietMs,
      timeout: config.ready.timeout,
      hydrationTimeout: config.ready.hydrationTimeout,
    };

    const spec: ScenarioSpec = {
      name: scenario.name,
      context: { ...scenario.context, viewport: null },
      cookies: scenario.cookies,
      cookieUrl: baseUrl,
      mocks: scenario.mocks,
      initScripts: [...scenario.initScripts, overlaySource],
      ...(scenario.clock !== undefined ? { clock: scenario.clock } : {}),
      ...(scenario.randomSeed !== undefined ? { randomSeed: scenario.randomSeed } : {}),
      ...(scenario.localStorage ? { localStorage: scenario.localStorage } : {}),
      ...(scenario.sessionStorage ? { sessionStorage: scenario.sessionStorage } : {}),
    };
    if (scenario.login) {
      const state = await performLogin(browser, { name: scenario.name, context: scenario.context, mocks: scenario.mocks, cookies: scenario.cookies, cookieUrl: baseUrl }, scenario.login, baseUrl);
      spec.context = { ...spec.context, storageState: state };
    }
    const context = await createScenarioContext(browser, spec, { ignoreSelectors: config.ignore.selectors });
    if (scenario.browser === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl }).catch(() => {});
    const page = await context.newPage();

    await context.exposeBinding(OVERLAY_BINDING, async (_source, action: OverlayAction) => {
      if (action.type === 'open') {
        const result = openInEditor(action.file, action.line, action.column, repository);
        write(`  ${result.opened ? c.cyan('↗') : c.yellow(symbols.warn)} ${result.message}\n`);
      } else if (action.type === 'rerun') {
        await page.reload().catch(() => {});
      } else if (action.type === 'copied') {
        write(`  ${c.gray(`Copied ${action.count} finding${action.count === 1 ? '' : 's'} to the clipboard.`)}\n`);
      }
    });

    let recorder: PageRecorder | undefined;
    let generation = 0;
    const analyze = async (response: Response, current: number, recording: PageRecorder): Promise<void> => {
      const url = response.url();
      const path = new URL(url).pathname + new URL(url).search;
      try {
        const capture = await completeCapture(page, recording.capture, response, ready);
        if (current !== generation) return;
        const parsed = capture.document?.body !== undefined ? await parseDocument(browser, capture.document, parseContextOptions(spec.context), 'csp', config.ignore.selectors).catch(() => undefined) : undefined;
        const route = { url, pattern: new URL(url).pathname };
        const analysis = analyzePage(capture, parsed, { route, scenario: scenario.name, normalize, propsAudit: config.checks.propsAudit, reportUnusedSuppression: config.checks.suppressedWarnings === 'strict' });
        await enrichIssues(page, capture, analysis, resolver, {
          rootDir: config.rootDir,
          sourceMaps: true,
          diagnosis: { scenario: { ...(scenario.context.locale ? { locale: scenario.context.locale } : {}), ...(scenario.context.timezoneId ? { timezoneId: scenario.context.timezoneId } : {}) }, server: serverEnvironment(config) },
          detectors: config.plugins.flatMap((plugin) => plugin.detectors ?? []),
        });
        if (current !== generation) return;
        const issues = filterChecks(config, analysis.issues);
        applyIgnores(issues, { textPatterns: config.ignore.textPatterns, rules: config.ignore.issues });
        const active = issues.filter((issue) => !issue.ignored);
        const react = analysis.react ? `React ${analysis.react.version} (${analysis.react.build})` : undefined;
        await showOverlay(page, {
          status: 'done',
          url,
          outcome: capture.outcome,
          issues: active.map((issue) => overlayIssue(issue, (file) => (file.startsWith('/') ? file : `${config.rootDir}/${file}`))),
          durationMs: capture.timings.total,
          ...(react ? { react } : {}),
        });
        const errors = active.filter((issue) => issue.severity === 'error').length;
        const warnings = active.filter((issue) => issue.severity === 'warning').length;
        const icon = errors > 0 ? c.red(symbols.fail) : warnings > 0 ? c.yellow(symbols.warn) : c.green(symbols.pass);
        const counts = [errors ? c.red(`${errors} error${errors === 1 ? '' : 's'}`) : '', warnings ? c.yellow(`${warnings} warning${warnings === 1 ? '' : 's'}`) : ''].filter(Boolean).join(', ');
        write(`  ${icon} ${path} ${c.gray(capture.outcome)}${counts ? `  ${counts}` : ''}\n`);
        for (const issue of active.filter((entry) => entry.severity !== 'info').slice(0, 5)) write(`${issueLines(issue, c).join('\n')}\n`);
      } catch (error) {
        if (current !== generation || page.isClosed()) return;
        const message = error instanceof Error ? error.message.split('\n')[0]! : String(error);
        await showOverlay(page, { status: 'failed', url, issues: [], error: message });
        write(`  ${c.yellow(symbols.warn)} ${path}: the check failed (${message})\n`);
      } finally {
        recording.dispose();
      }
    };

    page.on('response', (response) => {
      const request = response.request();
      if (!request.isNavigationRequest() || response.frame() !== page.mainFrame()) return;
      const status = response.status();
      if (status >= 300 && status < 400) return;
      generation++;
      recorder?.dispose();
      recorder = recordPage(page, response.url());
      void analyze(response, generation, recorder);
    });

    const start = config.routes.paths[0]?.path ?? '/';
    write(`\n${c.bold('Hydration Proof dev')} ${c.gray(`— ${baseUrl} (${mode})`)}\n`);
    write(`  Browse the app; every page you open is checked. Close the browser or press Ctrl+C to stop.\n\n`);
    await page.goto(new URL(start, `${baseUrl}/`).href).catch((error: unknown) => {
      write(`  ${c.red(symbols.fail)} Could not open ${start}: ${error instanceof Error ? error.message : String(error)}\n`);
    });
    await done;
    return ExitCode.Ok;
  } finally {
    await browser.close().catch(() => {});
    await server?.stop();
  }
}
