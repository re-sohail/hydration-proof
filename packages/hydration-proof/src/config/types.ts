// The configuration accepted by `hydration-proof.config.ts`.
// Every option is optional; see `resolveConfig` for defaults.

import type { Adapter } from '../adapters/types.ts';
import type { Severity } from '../issues/registry.ts';
import type { HydrationProofPlugin } from '../plugins/index.ts';

export type BrowserName = 'chromium' | 'firefox' | 'webkit';
export type BuildMode = 'production' | 'development';
export type ReporterName = 'list' | 'json' | 'html' | 'junit' | 'sarif' | 'github' | 'gitlab';
export type ColorScheme = 'light' | 'dark' | 'no-preference';
export type ViewportOption = { width: number; height: number } | 'mobile' | 'tablet' | 'desktop';
/** Throttled network: a preset or custom values. `fast` means no throttling. */
export type NetworkProfile = 'fast' | 'fast-3g' | 'slow-3g' | { name?: string; downloadKbps: number; uploadKbps: number; latencyMs: number };
export type CacheState = 'cold' | 'warm';
/** What a probe run changes to prove a cause. */
export type ProbeFactor = 'time' | 'random' | 'locale' | 'timezone' | 'theme' | 'viewport' | 'storage';

export interface ServerConfig {
  /** Command that starts the app. `{port}` is replaced with the chosen port. Defaults to the adapter's start command. */
  command?: string;
  /** Command that builds the app for production. `false` never builds. Defaults to the adapter's build command. */
  build?: string | false;
  /** Build before testing: always, only when no build output exists, or never. Default `"if-missing"`. */
  buildWhen?: 'always' | 'if-missing' | 'never';
  /** URL of an app that is already running. When set, nothing is started. */
  url?: string;
  /** Port for the started app. Default: a free port. */
  port?: number;
  /** Working directory for the commands. Default: the config file's directory. */
  cwd?: string;
  /** Extra environment variables for the app. */
  env?: Record<string, string>;
  /** Milliseconds to wait for the app to answer. Default 120000. */
  timeout?: number;
  /** Use an app already listening on the URL instead of starting one. Default `true` outside CI. */
  reuseExisting?: boolean;
  /** Test the production build, the dev server, or both (and compare). Default `"production"`. */
  mode?: BuildMode | 'both';
  /** Development server command when both modes are tested. Defaults to the adapter's dev command. */
  devCommand?: string;
}

export interface RouteEntry {
  /** Path, e.g. `/pricing` or `/products/42?tab=reviews`. */
  path: string;
  /** The final URL (path) the route must redirect to. Other redirects are reported. */
  expectRedirect?: string;
  /** Route pattern used for grouping and fingerprints. Defaults to the path without query. */
  pattern?: string;
  /** HTTP statuses that are not errors for this route (e.g. `[404]`). */
  expectStatus?: number[];
  /** Only test in these scenarios. */
  scenarios?: string[];
  /** Per-route readiness overrides. */
  ready?: ReadyConfig;
  /** Page the navigation check starts from for this route (default: `checks.navigation.from`). */
  navigateFrom?: string;
}

export interface RoutesConfig {
  /** Routes to test. Strings are paths. Default `["/"]` when discovery is off. */
  paths?: (string | RouteEntry)[];
  /** Example values for dynamic segments, e.g. `{ "/products/[id]": ["1", "42"] }`. */
  dynamic?: Record<string, string[]>;
  /** Glob patterns (`*`, `**`) a route must match. */
  include?: string[];
  /** Glob patterns of routes to skip. */
  exclude?: string[];
  /** Find routes from the framework (Next.js app/ and pages/, plus build manifests). Default `true` when `paths` is empty. */
  discover?: boolean;
  /** Query-string variants per route pattern, e.g. `{ "/search": ["?q=shoes", "?q=&page=2"] }`. */
  query?: Record<string, string[]>;
  /** Read routes from the sitemap: `true` for /sitemap.xml (and robots.txt), or a sitemap URL/path. */
  sitemap?: boolean | string;
  /** Follow same-origin links found on tested pages. */
  crawl?: boolean | CrawlConfig;
  /** Also test a URL that does not exist, to check the not-found page hydrates. Default `true` for Next.js. */
  notFound?: boolean;
  /** Most example values taken per dynamic route from build manifests. Default 3. */
  manifestExamples?: number;
}

export interface CrawlConfig {
  /** Link depth from the start routes. Default 2. */
  depth?: number;
  /** Maximum number of crawled routes. Default 50. */
  limit?: number;
}

export interface MockConfig {
  /** URL glob (`**` and `*`) or RegExp of browser requests to answer. */
  url: string | RegExp;
  method?: string;
  status?: number;
  headers?: Record<string, string>;
  /** Response body; objects are sent as JSON. */
  body?: unknown;
}

export interface LoginContext {
  /** A Playwright page in the scenario's browser context. */
  page: import('playwright-core').Page;
  baseUrl: string;
}

export interface CookieConfig {
  name: string;
  value: string;
  /** Defaults to the tested origin. */
  domain?: string;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface ScenarioConfig {
  name: string;
  /** BCP 47 locale for the browser (also sets Accept-Language). */
  locale?: string;
  /** IANA timezone for the browser, e.g. `Asia/Karachi`. */
  timezoneId?: string;
  colorScheme?: ColorScheme;
  reducedMotion?: 'reduce' | 'no-preference';
  /** Viewport size, or a preset. */
  viewport?: ViewportOption;
  userAgent?: string;
  /** Playwright storage state file (cookies and localStorage), e.g. a logged-in user. */
  storageState?: string;
  cookies?: CookieConfig[];
  /** Extra request headers. */
  headers?: Record<string, string>;
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  /** Scripts run before page scripts (code strings). */
  initScripts?: string[];
  /**
   * Sign in once before this scenario's pages are tested. The cookies and
   * storage it leaves behind are used for every page.
   */
  login?: (context: LoginContext) => Promise<void>;
  /** Answers for browser requests (API fixtures). Server-side requests are not affected. */
  mocks?: MockConfig[];
  /** Only test routes matching these globs in this scenario. */
  include?: string[];
  /** Skip routes matching these globs in this scenario. */
  exclude?: string[];
  /** Query parameters added to every URL (e.g. `{ currency: 'EUR' }`). */
  query?: Record<string, string>;
  /** Browser for this scenario. Default: `browser.name`. */
  browser?: BrowserName;
  /** Throttle the network (Chromium natively; other browsers delay subresources). */
  network?: NetworkProfile;
  /** Slow down JavaScript by this factor (Chromium only). */
  cpu?: number;
  /** `warm` loads the page once before testing it, like a returning visitor. Default `cold`. */
  cache?: CacheState;
  /**
   * Fixed browser time (ISO string or epoch ms) for `Date.now()` / `new Date()`.
   * A diagnostic option: the server keeps its real clock, so time-dependent
   * output is still found.
   */
  clock?: string | number;
  /** Seed for `Math.random()` and `crypto.getRandomValues()` in the browser (diagnostic, like `clock`). */
  randomSeed?: number;
}

/** Scenario settings one value of a custom matrix axis applies (feature flags, tenants, currencies, ...). */
export interface ScenarioVariant {
  cookies?: CookieConfig[];
  headers?: Record<string, string>;
  localStorage?: Record<string, string>;
  sessionStorage?: Record<string, string>;
  initScripts?: string[];
  query?: Record<string, string>;
}

export interface MatrixConfig {
  /** Locales to test, e.g. `['en-US', 'de-DE', 'ar-EG']`. */
  locale?: string[];
  /** Timezones to test, e.g. `['UTC', 'Asia/Karachi', 'America/Los_Angeles']`. */
  timezoneId?: string[];
  colorScheme?: ColorScheme[];
  reducedMotion?: ('reduce' | 'no-preference')[];
  viewport?: ViewportOption[];
  browser?: BrowserName[];
  network?: NetworkProfile[];
  /** CPU slowdown factors (Chromium only); `1` is no slowdown. */
  cpu?: number[];
  cache?: CacheState[];
  /**
   * Custom axes: axis name → value name → scenario settings.
   * `{ flags: { 'new-checkout': { cookies: [{ name: 'flag', value: 'on' }] }, 'old-checkout': {} } }`
   */
  axes?: Record<string, Record<string, ScenarioVariant>>;
  /** `pairwise` (default) covers every pair of values, `full` every combination, `sample` a random subset. */
  strategy?: 'pairwise' | 'full' | 'sample';
  /** Most environments per scenario. Default 16. */
  max?: number;
  /** Seed for `sample`. Default 1. */
  seed?: number;
  /** Scenarios the matrix applies to. Default: all. */
  scenarios?: string[];
}

export interface ProbesConfig {
  /** What to vary. Default: all that apply. */
  factors?: ProbeFactor[];
  /** Most pages probed per run. Default 5. */
  maxPages?: number;
}

export interface HookContext {
  baseUrl: string;
  rootDir: string;
}

export interface HooksConfig {
  /** Runs once after the app is up and before any page is tested (seed a database, create users). May return a teardown function. */
  setup?: (context: HookContext) => Promise<void | (() => Promise<void> | void)> | void | (() => Promise<void> | void);
  /** Runs once after all pages are tested. */
  teardown?: (context: HookContext) => Promise<void> | void;
}

export interface InteractionContext {
  /** The page, already loaded (and hydrated, unless `when` is `before-hydration`). */
  page: import('playwright-core').Page;
  baseUrl: string;
  /** The URL that was loaded. */
  url: string;
}

export interface InteractionConfig {
  /** Route glob the interaction runs on, e.g. `/checkout` or `/products/**`. */
  route: string;
  /** Shown in reports. */
  name?: string;
  /**
   * `after-hydration` (default): run once the page is interactive.
   * `before-hydration`: run while the page's scripts are still held back, like a user on a slow connection.
   */
  when?: 'before-hydration' | 'after-hydration';
  /** Only in these scenarios. */
  scenarios?: string[];
  steps: (context: InteractionContext) => Promise<void>;
}

export interface NavigationConfig {
  /** Page to navigate from. Default `/` (another tested route when the target is `/`). */
  from?: string;
  /** Also navigate after the router prefetched the route. Default true. */
  prefetch?: boolean;
  /** Most routes checked per scenario. Default 20. */
  maxRoutes?: number;
}

export interface ReadyConfig {
  /** Quiet time (ms) without DOM changes or React commits before the page counts as settled. Default 400. */
  quietMs?: number;
  /** Maximum time (ms) per page. Default 30000. */
  timeout?: number;
  /** Maximum time (ms) for hydration to finish once React is loaded. Default 15000. */
  hydrationTimeout?: number;
  /** A selector that must exist before the final snapshot. */
  selector?: string;
  /** Page function source that must return truthy before the final snapshot. */
  function?: string;
}

export interface ChecksConfig {
  /** Collect React hydration errors and warnings. Default true. */
  reactErrors?: boolean;
  /** Compare the DOM before and after hydration. Default true. */
  domDiff?: boolean;
  /** Compare attributes and text with what React renders on the client. Default true. */
  propsAudit?: boolean;
  /** Check the server HTML for markup the browser has to repair. Default true. */
  invalidHtml?: boolean;
  /** Detect changes made by other scripts before hydration. Default true. */
  externalChanges?: boolean;
  /** How to treat suppressHydrationWarning: report suppressed differences as info, or also flag unused suppression. Default `"info"`. */
  suppressedWarnings?: 'off' | 'info' | 'strict';
  /** Type, click, focus and scroll while the page loads and check nothing is lost. Default false. */
  interactions?: boolean;
  /** Compare client-side navigation to each route with loading it directly (Next.js). Default false. */
  navigation?: boolean | NavigationConfig;
}

export interface IgnoreRule {
  /** Issue code, e.g. `HP1004`. */
  code?: string;
  /** Route glob. */
  route?: string;
  /** Exact issue fingerprint from a report. */
  fingerprint?: string;
  /** CSS selector prefix the issue must point at. */
  selector?: string;
  /** Why this is ignored. Shown in reports. */
  reason: string;
  /** ISO date after which the rule stops applying (and CI fails). */
  expires?: string;
}

export interface IgnoreConfig {
  /** Elements whose subtree is not compared. `[data-hydration-proof-ignore]` is always included. */
  selectors?: string[];
  /** Attribute names (or patterns) that are never compared. */
  attributes?: (string | RegExp)[];
  /** Text differences are ignored when both values are equal after removing these patterns. */
  textPatterns?: RegExp[];
  /** Ignore specific findings. */
  issues?: IgnoreRule[];
}

export interface BudgetLimits {
  error?: number;
  warning?: number;
  info?: number;
}

export interface BudgetConfig extends BudgetLimits {
  /** Limits for the findings of routes matching each glob. */
  routes?: Record<string, BudgetLimits>;
  /** Limits per issue code, e.g. `{ HP1004: 3 }`. */
  codes?: Record<string, number>;
}

export interface CiConfig {
  /** Lowest severity that makes the run fail. Default `"error"`. */
  failOn?: Severity | 'never';
  /** Fail when more warnings than this are found. */
  maxWarnings?: number;
  /** Baseline file of accepted issues. Default `.hydration-proof/baseline.json`. */
  baseline?: string;
  /** Only fail on issues that are not in the baseline. */
  newIssuesOnly?: boolean;
  /**
   * Hydration error budget: how many findings of a severity (in total, per
   * route glob or per code) are allowed before the run fails.
   */
  budget?: BudgetConfig;
  /** Append a line per run to a history file for trends: `true` for `.hydration-proof/history.ndjson`, or a path. */
  history?: boolean | string;
}

export interface OwnersConfig {
  /** Route glob → owners, e.g. `{ '/checkout/**': ['@acme/payments'] }`. */
  routes?: Record<string, string | string[]>;
  /** Owners of source files from CODEOWNERS: `true` (default) looks in .github/, docs/ and the repository root; or a path. */
  codeowners?: boolean | string;
}

export interface RedactConfig {
  /** Remove emails, tokens, card numbers and secret URL parameters. Default true. */
  builtIn?: boolean;
  /** More text to remove from reports. */
  patterns?: RegExp[];
  /** Elements to black out in screenshots. */
  selectors?: string[];
}

export interface ProjectConfig {
  /** Folder of the project (with its own hydration-proof config). */
  path: string;
  /** Name shown in reports. Default: the folder name. */
  name?: string;
  /** Config file inside the folder. Default: found automatically. */
  config?: string;
}

export interface BrowserConfig {
  name?: BrowserName;
  /** Installed browser channel, e.g. `chrome` or `msedge`. */
  channel?: string;
  headless?: boolean;
}

export interface HydrationProofConfig {
  $schema?: string;
  /** Config format version. */
  configVersion?: 1;
  /**
   * Framework adapter: `"auto"` (default, detected from package.json), `"next"`,
   * `"react-router"`, `"remix"`, `"astro"`, `"vite"`, `"node"`, `"none"`, the
   * name of a plugin adapter, or an adapter from `defineAdapter()`.
   */
  adapter?: 'auto' | 'next' | 'react-router' | 'remix' | 'astro' | 'vite' | 'node' | 'none' | (string & {}) | Adapter;
  /** Plugins: adapters, normalizers, cause detectors, reporters and route providers. */
  plugins?: HydrationProofPlugin[];
  server?: ServerConfig;
  routes?: RoutesConfig;
  /** Environments every route is tested in. Default: one scenario named `default` (en-US, UTC, light). */
  scenarios?: ScenarioConfig[];
  ready?: ReadyConfig;
  browser?: BrowserConfig;
  /** Pages tested in parallel. Default: half the CPU cores, at most 4. */
  workers?: number;
  /** Retries for pages that failed to load. Default 0 (1 on CI). */
  retries?: number;
  checks?: ChecksConfig;
  ignore?: IgnoreConfig;
  reporters?: ReporterName[];
  /** Where reports are written. Default `.hydration-proof/report`. */
  outputDir?: string;
  /** Screenshots for the HTML report: of failing pages (default when the html reporter is on), all pages, or none. */
  screenshots?: 'failures' | 'all' | 'off';
  ci?: CiConfig;
  hooks?: HooksConfig;
  /** Cache discovered routes between runs (keyed by build). Default true. */
  cache?: boolean;
  /** Test every scenario in combinations of environments. */
  matrix?: MatrixConfig;
  /**
   * Prove causes: pages with value mismatches are loaded again with one thing
   * changed (clock, random seed, locale, timezone, theme, viewport, storage).
   * Default false.
   */
  probes?: boolean | ProbesConfig;
  /** Load every page this many times and report flaky issues. Default 1. */
  repeat?: number;
  /** Custom interactions to run on routes (before or after hydration). */
  interactions?: InteractionConfig[];
  /** Who owns findings: route owners and CODEOWNERS. */
  owners?: OwnersConfig;
  /** Remove secrets and personal data from reports. Default true. */
  redact?: boolean | RedactConfig;
  /** Monorepo: test these projects (each has its own config) in one run. */
  projects?: (string | ProjectConfig)[];
}

/** Identity helper that gives `hydration-proof.config.ts` type checking and completion. */
export function defineConfig(config: HydrationProofConfig): HydrationProofConfig {
  return config;
}
