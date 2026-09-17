import { availableParallelism } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import type { BrowserContextOptions } from 'playwright-core';
import type { Severity } from '../issues/registry.ts';
import type {
  BrowserName,
  BuildMode,
  ChecksConfig,
  CookieConfig,
  HooksConfig,
  HydrationProofConfig,
  IgnoreRule,
  LoginContext,
  MockConfig,
  ReporterName,
  RouteEntry,
  ScenarioConfig,
} from './types.ts';
import { ConfigError } from './load.ts';

export interface CliOverrides {
  url?: string;
  routes?: string[];
  grep?: string;
  scenarios?: string[];
  browser?: BrowserName;
  channel?: string;
  mode?: BuildMode | 'both';
  reporters?: ReporterName[];
  outputDir?: string;
  workers?: number;
  timeout?: number;
  retries?: number;
  headed?: boolean;
  failOn?: Severity | 'never';
  build?: boolean;
  discover?: boolean;
  /** 1-based shard index and total, e.g. { index: 2, total: 4 }. */
  shard?: { index: number; total: number };
  crawl?: boolean;
  sitemap?: boolean;
  cache?: boolean;
}

export interface ResolvedScenario {
  name: string;
  context: BrowserContextOptions;
  cookies: CookieConfig[];
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  initScripts: string[];
  login?: (context: LoginContext) => Promise<void>;
  mocks: MockConfig[];
  include: string[];
  exclude: string[];
}

export interface ResolvedConfig {
  rootDir: string;
  configFile: string | undefined;
  adapter: 'auto' | 'next' | 'none';
  server: {
    command?: string;
    build?: string | false;
    buildWhen: 'always' | 'if-missing' | 'never';
    url?: string;
    port?: number;
    cwd: string;
    env: Record<string, string>;
    timeout: number;
    reuseExisting: boolean;
    mode: BuildMode | 'both';
    devCommand?: string;
  };
  routes: {
    paths: RouteEntry[];
    dynamic: Record<string, string[]>;
    include: string[];
    exclude: string[];
    discover: boolean | undefined;
    grep?: RegExp;
    query: Record<string, string[]>;
    /** `false`, or the sitemap URL/path to read (`true` means /sitemap.xml and robots.txt). */
    sitemap: false | true | string;
    crawl: false | { depth: number; limit: number };
    notFound: boolean | undefined;
    manifestExamples: number;
  };
  scenarios: ResolvedScenario[];
  /** Scenario names requested on the command line. */
  scenarioFilter: string[];
  ready: {
    quietMs: number;
    timeout: number;
    hydrationTimeout: number;
    selector?: string;
    function?: string;
  };
  browser: { name: BrowserName; channel?: string; headless: boolean };
  workers: number;
  retries: number;
  checks: Required<ChecksConfig>;
  ignore: {
    selectors: string[];
    attributes: (string | RegExp)[];
    textPatterns: RegExp[];
    issues: IgnoreRule[];
  };
  reporters: ReporterName[];
  outputDir: string;
  screenshots: 'failures' | 'all' | 'off';
  ci: { failOn: Severity | 'never'; maxWarnings?: number; baseline?: string; newIssuesOnly: boolean };
  hooks: HooksConfig;
  cache: boolean;
  shard?: { index: number; total: number };
}

export const DEFAULT_IGNORE_SELECTOR = '[data-hydration-proof-ignore]';

const VIEWPORTS: Record<'mobile' | 'tablet' | 'desktop', BrowserContextOptions> = {
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
  tablet: { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 } },
};

export function isCI(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env['CI'];
  return value !== undefined && value !== '' && value !== '0' && value.toLowerCase() !== 'false';
}

/** The locale and timezone of this machine: a server started here renders with them. */
function localEnvironment(): { locale: string; timezoneId: string } {
  const options = new Intl.DateTimeFormat().resolvedOptions();
  return { locale: options.locale || 'en-US', timezoneId: options.timeZone || 'UTC' };
}

function resolvePath(rootDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(rootDir, path);
}

function scenarioContext(scenario: ScenarioConfig, rootDir: string): BrowserContextOptions {
  const local = localEnvironment();
  const context: BrowserContextOptions = {
    locale: scenario.locale ?? local.locale,
    timezoneId: scenario.timezoneId ?? local.timezoneId,
    colorScheme: scenario.colorScheme ?? 'light',
  };
  if (scenario.reducedMotion) context.reducedMotion = scenario.reducedMotion;
  if (scenario.viewport) {
    Object.assign(context, typeof scenario.viewport === 'string' ? VIEWPORTS[scenario.viewport] : { viewport: scenario.viewport });
  }
  if (scenario.userAgent) context.userAgent = scenario.userAgent;
  if (scenario.storageState) context.storageState = resolvePath(rootDir, scenario.storageState);
  if (scenario.headers) context.extraHTTPHeaders = scenario.headers;
  return context;
}

function routeEntry(entry: string | RouteEntry): RouteEntry {
  if (typeof entry === 'string') return { path: entry };
  return entry;
}

function checkUrl(url: string, source: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('bad protocol');
    return parsed.href.replace(/\/$/, '');
  } catch {
    throw new ConfigError(`${source} must be an http(s) URL, got ${JSON.stringify(url)}.`);
  }
}

export function resolveConfig(
  config: HydrationProofConfig,
  options: { rootDir: string; configFile?: string; overrides?: CliOverrides; env?: NodeJS.ProcessEnv },
): ResolvedConfig {
  const { rootDir } = options;
  const overrides = options.overrides ?? {};
  const env = options.env ?? process.env;
  const ci = isCI(env);

  const scenarios: ResolvedScenario[] = (config.scenarios?.length ? config.scenarios : [{ name: 'default' }]).map(
    (scenario) => {
      const resolved: ResolvedScenario = {
        name: scenario.name,
        context: scenarioContext(scenario, rootDir),
        cookies: scenario.cookies ?? [],
        initScripts: scenario.initScripts ?? [],
        mocks: scenario.mocks ?? [],
        include: scenario.include ?? [],
        exclude: scenario.exclude ?? [],
      };
      if (scenario.login) resolved.login = scenario.login;
      if (scenario.localStorage) resolved.localStorage = scenario.localStorage;
      if (scenario.sessionStorage) resolved.sessionStorage = scenario.sessionStorage;
      return resolved;
    },
  );
  const names = new Set<string>();
  for (const scenario of scenarios) {
    if (names.has(scenario.name)) throw new ConfigError(`Scenario names must be unique; "${scenario.name}" is used twice.`);
    names.add(scenario.name);
  }
  for (const name of overrides.scenarios ?? []) {
    if (!names.has(name)) {
      throw new ConfigError(`Unknown scenario "${name}". Available: ${[...names].join(', ')}.`);
    }
  }

  const url = overrides.url ?? config.server?.url;
  const cliRoutes = overrides.routes?.length ? overrides.routes.map((path) => ({ path })) : undefined;

  let grep: RegExp | undefined;
  if (overrides.grep !== undefined) {
    try {
      grep = new RegExp(overrides.grep);
    } catch (error) {
      throw new ConfigError(`--grep is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const resolved: ResolvedConfig = {
    rootDir,
    configFile: options.configFile,
    adapter: config.adapter ?? 'auto',
    server: {
      buildWhen: overrides.build === true ? 'always' : overrides.build === false ? 'never' : (config.server?.buildWhen ?? 'if-missing'),
      cwd: config.server?.cwd ? resolvePath(rootDir, config.server.cwd) : rootDir,
      env: config.server?.env ?? {},
      timeout: config.server?.timeout ?? 120_000,
      reuseExisting: config.server?.reuseExisting ?? !ci,
      mode: overrides.mode ?? config.server?.mode ?? 'production',
    },
    routes: {
      paths: (cliRoutes ?? config.routes?.paths ?? []).map(routeEntry),
      dynamic: config.routes?.dynamic ?? {},
      include: config.routes?.include ?? [],
      exclude: config.routes?.exclude ?? ['/api/**'],
      discover: cliRoutes ? false : (overrides.discover ?? config.routes?.discover),
      query: config.routes?.query ?? {},
      sitemap: cliRoutes ? false : (overrides.sitemap ?? config.routes?.sitemap ?? false),
      crawl: false,
      notFound: cliRoutes ? false : config.routes?.notFound,
      manifestExamples: config.routes?.manifestExamples ?? 3,
    },
    scenarios,
    scenarioFilter: overrides.scenarios ?? [],
    ready: {
      quietMs: config.ready?.quietMs ?? 400,
      timeout: overrides.timeout ?? config.ready?.timeout ?? 30_000,
      hydrationTimeout: config.ready?.hydrationTimeout ?? 15_000,
    },
    browser: {
      name: overrides.browser ?? config.browser?.name ?? 'chromium',
      headless: overrides.headed === true ? false : (config.browser?.headless ?? true),
    },
    workers: overrides.workers ?? config.workers ?? Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2))),
    retries: overrides.retries ?? config.retries ?? (ci ? 1 : 0),
    checks: {
      reactErrors: config.checks?.reactErrors ?? true,
      domDiff: config.checks?.domDiff ?? true,
      propsAudit: config.checks?.propsAudit ?? true,
      invalidHtml: config.checks?.invalidHtml ?? true,
      externalChanges: config.checks?.externalChanges ?? true,
      suppressedWarnings: config.checks?.suppressedWarnings ?? 'info',
    },
    ignore: {
      selectors: [DEFAULT_IGNORE_SELECTOR, ...(config.ignore?.selectors ?? [])],
      attributes: config.ignore?.attributes ?? [],
      textPatterns: config.ignore?.textPatterns ?? [],
      issues: config.ignore?.issues ?? [],
    },
    reporters: overrides.reporters ?? config.reporters ?? ['list', 'json', 'html'],
    outputDir: resolvePath(rootDir, overrides.outputDir ?? config.outputDir ?? '.hydration-proof/report'),
    screenshots: 'off',
    ci: {
      failOn: overrides.failOn ?? config.ci?.failOn ?? 'error',
      newIssuesOnly: config.ci?.newIssuesOnly ?? false,
    },
    hooks: {},
    cache: true,
  };

  if (grep) resolved.routes.grep = grep;
  if (url !== undefined) resolved.server.url = checkUrl(url, overrides.url !== undefined ? '--url' : 'server.url');
  if (config.server?.command !== undefined) resolved.server.command = config.server.command;
  if (config.server?.devCommand !== undefined) resolved.server.devCommand = config.server.devCommand;
  resolved.screenshots = config.screenshots ?? (resolved.reporters.includes('html') ? 'failures' : 'off');
  const crawl = overrides.crawl ?? config.routes?.crawl ?? false;
  if (crawl !== false && !cliRoutes) {
    const options = crawl === true ? {} : crawl;
    resolved.routes.crawl = { depth: options.depth ?? 2, limit: options.limit ?? 50 };
  }
  resolved.hooks = config.hooks ?? {};
  resolved.cache = overrides.cache ?? config.cache ?? true;
  if (overrides.shard) {
    if (overrides.shard.index < 1 || overrides.shard.index > overrides.shard.total) {
      throw new ConfigError(`--shard ${overrides.shard.index}/${overrides.shard.total} is out of range.`);
    }
    resolved.shard = overrides.shard;
  }
  if (config.server?.build !== undefined) resolved.server.build = config.server.build;
  if (config.server?.port !== undefined) resolved.server.port = config.server.port;
  if (config.ready?.selector !== undefined) resolved.ready.selector = config.ready.selector;
  if (config.ready?.function !== undefined) resolved.ready.function = config.ready.function;
  const channel = overrides.channel ?? config.browser?.channel;
  if (channel !== undefined) resolved.browser.channel = channel;
  if (config.ci?.maxWarnings !== undefined) resolved.ci.maxWarnings = config.ci.maxWarnings;
  if (config.ci?.baseline !== undefined) resolved.ci.baseline = resolvePath(rootDir, config.ci.baseline);
  return resolved;
}
