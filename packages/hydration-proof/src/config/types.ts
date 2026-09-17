// The configuration accepted by `hydration-proof.config.ts`.
// Every option is optional; see `resolveConfig` for defaults.

import type { Severity } from '../issues/registry.ts';

export type BrowserName = 'chromium' | 'firefox' | 'webkit';
export type BuildMode = 'production' | 'development';
export type ReporterName = 'list' | 'json' | 'html' | 'junit' | 'sarif' | 'github' | 'gitlab';
export type ColorScheme = 'light' | 'dark' | 'no-preference';

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
  viewport?: { width: number; height: number } | 'mobile' | 'tablet' | 'desktop';
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

export interface CiConfig {
  /** Lowest severity that makes the run fail. Default `"error"`. */
  failOn?: Severity | 'never';
  /** Fail when more warnings than this are found. */
  maxWarnings?: number;
  /** Baseline file of accepted issues. */
  baseline?: string;
  /** Only fail on issues that are not in the baseline. */
  newIssuesOnly?: boolean;
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
  /** Framework adapter. Default `"auto"`. */
  adapter?: 'auto' | 'next' | 'none';
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
}

/** Identity helper that gives `hydration-proof.config.ts` type checking and completion. */
export function defineConfig(config: HydrationProofConfig): HydrationProofConfig {
  return config;
}
