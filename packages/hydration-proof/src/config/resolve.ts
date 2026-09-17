import { availableParallelism } from 'node:os';
import { isAbsolute, resolve } from 'node:path';
import type { BrowserContextOptions } from 'playwright-core';
import type { Severity } from '../issues/registry.ts';
import { expandMatrix, networkLabel, type EnvironmentLabels } from '../matrix/expand.ts';
import type {
  BrowserName,
  BudgetConfig,
  BuildMode,
  CacheState,
  ChecksConfig,
  CookieConfig,
  HooksConfig,
  HydrationProofConfig,
  IgnoreRule,
  InteractionConfig,
  LoginContext,
  MockConfig,
  NetworkProfile,
  ProbeFactor,
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
  /** Load every page this many times. */
  repeat?: number;
  /** Turn probes on or off. */
  probes?: boolean;
  /** `false` tests the scenarios without the matrix. */
  matrix?: boolean;
  /** Turn the interaction checks on or off. */
  interactions?: boolean;
  /** Turn the navigation checks on or off. */
  navigation?: boolean;
  /** Fail only on findings that are not in the baseline. */
  newOnly?: boolean;
  /** Write the baseline from this run's findings. */
  updateBaseline?: boolean;
  /** Only test routes affected by files changed since this git ref (`true`: the default base). */
  changed?: string | true;
  /** Monorepo: only these projects (names or paths). */
  projects?: string[];
}

export interface ResolvedProject {
  name: string;
  dir: string;
  config?: string;
}

export interface ResolvedNavigation {
  from?: string;
  prefetch: boolean;
  maxRoutes: number;
}

/** Network throttling in the units browsers use. */
export interface ResolvedNetwork {
  label: string;
  /** Bytes per second. */
  download: number;
  upload: number;
  latencyMs: number;
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
  /** The configured scenario this one was derived from (itself without a matrix). */
  base: string;
  /** Matrix axis values of this environment. */
  environment: EnvironmentLabels;
  browser: BrowserName;
  network?: ResolvedNetwork;
  /** CPU slowdown factor; 1 = none. */
  cpu: number;
  cache: CacheState;
  /** Fixed browser time (epoch ms). */
  clock?: number;
  randomSeed?: number;
  query: Record<string, string>;
}

export interface ResolvedProbes {
  factors: ProbeFactor[] | undefined;
  maxPages: number;
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
  checks: Required<Omit<ChecksConfig, 'navigation'>> & { navigation: false | ResolvedNavigation };
  interactions: InteractionConfig[];
  ignore: {
    selectors: string[];
    attributes: (string | RegExp)[];
    textPatterns: RegExp[];
    issues: IgnoreRule[];
  };
  reporters: ReporterName[];
  outputDir: string;
  screenshots: 'failures' | 'all' | 'off';
  ci: {
    failOn: Severity | 'never';
    maxWarnings?: number;
    /** Absolute path of the baseline file (it may not exist). */
    baseline: string;
    newIssuesOnly: boolean;
    updateBaseline: boolean;
    budget?: BudgetConfig;
    /** Absolute path of the history file, when enabled. */
    history?: string;
  };
  owners: { routes: Record<string, string[]>; codeowners: boolean | string };
  redact: false | { builtIn: boolean; patterns: RegExp[]; selectors: string[] };
  changed?: { ref: string | true };
  projects: ResolvedProject[];
  hooks: HooksConfig;
  cache: boolean;
  shard?: { index: number; total: number };
  probes: false | ResolvedProbes;
  repeat: number;
  /** Explanations of how the matrix was limited. */
  matrixNotes: string[];
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

const NETWORK_PRESETS: Record<Exclude<NetworkProfile, object | 'fast'>, { downloadKbps: number; uploadKbps: number; latencyMs: number }> = {
  'fast-3g': { downloadKbps: 1_600, uploadKbps: 750, latencyMs: 150 },
  'slow-3g': { downloadKbps: 400, uploadKbps: 400, latencyMs: 400 },
};

export function resolveNetwork(profile: NetworkProfile | undefined): ResolvedNetwork | undefined {
  if (profile === undefined || profile === 'fast') return undefined;
  const values = typeof profile === 'string' ? NETWORK_PRESETS[profile] : profile;
  return {
    label: networkLabel(profile),
    download: Math.round((values.downloadKbps * 1000) / 8),
    upload: Math.round((values.uploadKbps * 1000) / 8),
    latencyMs: values.latencyMs,
  };
}

function parseClock(value: string | number, scenario: string): number {
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time)) throw new ConfigError(`scenarios "${scenario}": clock must be an ISO date or epoch milliseconds, got ${JSON.stringify(value)}.`);
  return time;
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

  const configured = config.scenarios?.length ? config.scenarios : [{ name: 'default' }];
  const baseNames = new Set<string>();
  for (const scenario of configured) {
    if (baseNames.has(scenario.name)) throw new ConfigError(`Scenario names must be unique; "${scenario.name}" is used twice.`);
    baseNames.add(scenario.name);
  }
  for (const name of config.matrix?.scenarios ?? []) {
    if (!baseNames.has(name)) throw new ConfigError(`matrix.scenarios: unknown scenario "${name}".`);
  }
  const defaultBrowser = overrides.browser ?? config.browser?.name ?? 'chromium';
  const matrixNotes: string[] = [];
  const expanded =
    overrides.matrix === false
      ? expandMatrix(configured, undefined, { browser: defaultBrowser })
      : expandMatrix(configured, config.matrix, { browser: defaultBrowser }, matrixNotes);

  const scenarios: ResolvedScenario[] = expanded.map(({ config: scenario, base, environment }) => {
    const resolved: ResolvedScenario = {
      name: scenario.name,
      context: scenarioContext(scenario, rootDir),
      cookies: scenario.cookies ?? [],
      initScripts: scenario.initScripts ?? [],
      mocks: scenario.mocks ?? [],
      include: scenario.include ?? [],
      exclude: scenario.exclude ?? [],
      base,
      environment,
      // --browser overrides the browser of every scenario that does not come from the matrix.
      browser: environment['browser'] !== undefined ? (scenario.browser ?? defaultBrowser) : (overrides.browser ?? scenario.browser ?? defaultBrowser),
      cpu: scenario.cpu ?? 1,
      cache: scenario.cache ?? 'cold',
      query: scenario.query ?? {},
    };
    if (scenario.login) resolved.login = scenario.login;
    if (scenario.localStorage) resolved.localStorage = scenario.localStorage;
    if (scenario.sessionStorage) resolved.sessionStorage = scenario.sessionStorage;
    const network = resolveNetwork(scenario.network);
    if (network) resolved.network = network;
    if (scenario.clock !== undefined) resolved.clock = parseClock(scenario.clock, scenario.name);
    if (scenario.randomSeed !== undefined) resolved.randomSeed = scenario.randomSeed;
    if (resolved.cpu > 1 && resolved.browser !== 'chromium') {
      throw new ConfigError(`Scenario "${scenario.name}": cpu slowdown only works in Chromium (the scenario uses ${resolved.browser}).`);
    }
    return resolved;
  });
  const names = new Set<string>();
  for (const scenario of scenarios) {
    if (names.has(scenario.name)) throw new ConfigError(`Scenario names must be unique; "${scenario.name}" is used twice (after expanding the matrix).`);
    names.add(scenario.name);
  }
  for (const name of overrides.scenarios ?? []) {
    if (!names.has(name) && !baseNames.has(name)) {
      throw new ConfigError(`Unknown scenario "${name}". Available: ${[...baseNames].join(', ')}.`);
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
      name: defaultBrowser,
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
      interactions: overrides.interactions ?? config.checks?.interactions ?? false,
      navigation: false,
    },
    interactions: config.interactions ?? [],
    ignore: {
      selectors: [DEFAULT_IGNORE_SELECTOR, ...(config.ignore?.selectors ?? [])],
      attributes: config.ignore?.attributes ?? [],
      textPatterns: config.ignore?.textPatterns ?? [],
      issues: config.ignore?.issues ?? [],
    },
    // On GitHub Actions the annotations and job summary are added unless --reporter chooses the reporters.
    reporters:
      overrides.reporters ??
      (env['GITHUB_ACTIONS'] === 'true'
        ? [...new Set<ReporterName>([...(config.reporters ?? ['list', 'json', 'html']), 'github'])]
        : (config.reporters ?? ['list', 'json', 'html'])),
    outputDir: resolvePath(rootDir, overrides.outputDir ?? config.outputDir ?? '.hydration-proof/report'),
    screenshots: 'off',
    ci: {
      failOn: overrides.failOn ?? config.ci?.failOn ?? 'error',
      newIssuesOnly: overrides.newOnly ?? config.ci?.newIssuesOnly ?? false,
      updateBaseline: overrides.updateBaseline ?? false,
      baseline: resolvePath(rootDir, config.ci?.baseline ?? '.hydration-proof/baseline.json'),
    },
    owners: {
      routes: Object.fromEntries(Object.entries(config.owners?.routes ?? {}).map(([glob, owners]) => [glob, Array.isArray(owners) ? owners : [owners]])),
      codeowners: config.owners?.codeowners ?? true,
    },
    redact:
      config.redact === false
        ? false
        : {
            builtIn: (typeof config.redact === 'object' ? config.redact.builtIn : undefined) ?? true,
            patterns: (typeof config.redact === 'object' ? config.redact.patterns : undefined) ?? [],
            selectors: (typeof config.redact === 'object' ? config.redact.selectors : undefined) ?? [],
          },
    projects: [],
    hooks: {},
    cache: true,
    probes: false,
    repeat: overrides.repeat ?? config.repeat ?? 1,
    matrixNotes,
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
  const navigation = overrides.navigation ?? (config.checks?.navigation === undefined ? false : config.checks.navigation !== false);
  if (navigation) {
    const options = typeof config.checks?.navigation === 'object' ? config.checks.navigation : {};
    resolved.checks.navigation = { prefetch: options.prefetch ?? true, maxRoutes: options.maxRoutes ?? 20 };
    if (options.from !== undefined) resolved.checks.navigation.from = options.from.startsWith('/') ? options.from : `/${options.from}`;
  }
  const probes = overrides.probes ?? (config.probes === undefined ? false : config.probes !== false);
  if (probes) {
    const options = typeof config.probes === 'object' ? config.probes : {};
    resolved.probes = { factors: options.factors, maxPages: options.maxPages ?? 5 };
  }
  if (!Number.isInteger(resolved.repeat) || resolved.repeat < 1) throw new ConfigError(`repeat must be a whole number of at least 1, got ${resolved.repeat}.`);
  if (config.server?.build !== undefined) resolved.server.build = config.server.build;
  if (config.server?.port !== undefined) resolved.server.port = config.server.port;
  if (config.ready?.selector !== undefined) resolved.ready.selector = config.ready.selector;
  if (config.ready?.function !== undefined) resolved.ready.function = config.ready.function;
  const channel = overrides.channel ?? config.browser?.channel;
  if (channel !== undefined) resolved.browser.channel = channel;
  if (config.ci?.maxWarnings !== undefined) resolved.ci.maxWarnings = config.ci.maxWarnings;
  if (config.ci?.budget !== undefined) resolved.ci.budget = config.ci.budget;
  if (config.ci?.history) {
    resolved.ci.history = resolvePath(rootDir, config.ci.history === true ? '.hydration-proof/history.ndjson' : config.ci.history);
  }
  if (overrides.changed !== undefined) resolved.changed = { ref: overrides.changed };
  const projects = (config.projects ?? []).map((entry): ResolvedProject => {
    const spec = typeof entry === 'string' ? { path: entry } : entry;
    const dir = resolvePath(rootDir, spec.path);
    const project: ResolvedProject = { name: spec.name ?? (spec.path.replace(/\/+$/, '').split('/').pop() || spec.path), dir };
    if (spec.config !== undefined) project.config = spec.config;
    return project;
  });
  const projectNames = new Set<string>();
  for (const project of projects) {
    if (projectNames.has(project.name)) throw new ConfigError(`Project names must be unique; "${project.name}" is used twice. Set "name" on one of them.`);
    projectNames.add(project.name);
  }
  for (const wanted of overrides.projects ?? []) {
    if (!projects.some((project) => project.name === wanted || project.dir === resolvePath(rootDir, wanted))) {
      throw new ConfigError(`Unknown project "${wanted}". Available: ${projects.map((project) => project.name).join(', ') || 'none (set "projects" in the config)'}.`);
    }
  }
  resolved.projects = overrides.projects?.length
    ? projects.filter((project) => overrides.projects!.some((wanted) => project.name === wanted || project.dir === resolvePath(rootDir, wanted)))
    : projects;
  return resolved;
}
