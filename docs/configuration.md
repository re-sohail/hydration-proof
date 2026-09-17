# Configuration

`hydration-proof` reads `hydration-proof.config.ts` (or `.mts`, `.js`, `.mjs`, `.cjs`, `.json`) from the directory it runs in. TypeScript configs are loaded by Node.js itself, so they must use plain types (no `enum` or `namespace`), and relative imports need their file extension (`./routes.ts`).

```ts
import { defineConfig } from 'hydration-proof';

export default defineConfig({
  // options
});
```

For JSON configs, point `$schema` at `./node_modules/hydration-proof/schema/config.json` to get completion in your editor.

Unknown options are errors, with a suggestion when the name looks like a typo.

## `adapter`

`'auto'` (default), `'next'`, `'react-router'`, `'remix'`, `'astro'`, `'vite'`, `'node'`, `'none'`, the name of a plugin adapter, or an adapter from `defineAdapter()`. With `'auto'`, the adapter is chosen from `package.json`. Adapters know how to build and start the app, where its routes are and which markup the framework adds. See [Frameworks and adapters](adapters.md).

## `plugins`

Plugins add normalizers, cause detectors, route providers, reporters and adapters. See [Plugins](plugins.md).

## `server`

| Option | Default | Description |
| --- | --- | --- |
| `url` | | Test an app that is already running. Nothing is built or started |
| `command` | adapter | Start command. `{port}` is replaced with the chosen port, which is also passed as `PORT` |
| `build` | adapter | Build command, or `false` |
| `buildWhen` | `'if-missing'` | `'always'`, `'if-missing'` (no build output yet) or `'never'` |
| `mode` | `'production'` | `'production'`, `'development'` or `'both'` |
| `devCommand` | adapter | Development server command, used with `mode: 'both'` |
| `port` | free port | Port for the started app |
| `cwd` | config directory | Working directory for the commands |
| `env` | `{}` | Extra environment variables |
| `timeout` | `120000` | Milliseconds to wait for the app to answer |
| `reuseExisting` | `true` (not on CI) | Use an app already listening on `port` |

The started app, and everything it spawned, is stopped when the run ends.

## `routes`

| Option | Default | Description |
| --- | --- | --- |
| `paths` | | Routes to test: paths (`'/pricing'`) or objects (below) |
| `dynamic` | `{}` | Example values for dynamic routes: `{ '/products/[id]': ['1', '42'] }` |
| `include` | all | Globs a route must match |
| `exclude` | `['/api/**']` | Globs of routes to skip |
| `discover` | `true` when no `paths` | Find routes from the framework: the file system plus the build manifests |
| `manifestExamples` | `3` | Most example values taken per dynamic route from the build (pages built with `generateStaticParams` / `getStaticPaths`) |
| `query` | `{}` | Query-string variants per route: `{ '/search': ['?q=shoes', '?q=&page=2'] }` |
| `sitemap` | `false` | Also test the routes in the sitemap: `true` reads `robots.txt` and `/sitemap.xml`, or give a sitemap URL or path |
| `crawl` | `false` | Also test same-origin links found on tested pages: `true`, or `{ depth, limit }` (defaults `2` and `50`) |
| `notFound` | `true` for Next.js | Also load `/hydration-proof-not-found` and check that the not-found page hydrates (it must answer 404) |

Route objects:

```ts
{ path: '/404-page', expectStatus: [404], scenarios: ['default'], ready: { selector: '#app' } }
{ path: '/account', expectRedirect: '/login' }
```

| Field | Description |
| --- | --- |
| `path` | Path to load, with an optional query |
| `pattern` | Route pattern used to group results and in fingerprints. Default: the path without the query |
| `expectStatus` | HTTP statuses that are not errors (e.g. `[404]`) |
| `expectRedirect` | Path the route is expected to end on. Without it, ending on another path is reported as HP9010 |
| `scenarios` | Only test the route in these scenarios |
| `ready` | Per-route `ready` options |
| `navigateFrom` | Page the navigation check starts from for this route |

Globs: `*` matches one path segment, `**` any number (`/blog/**` also matches `/blog`). Dynamic values fill parameters in order; separate values for several parameters with `/`, and a catch-all takes the rest: `'/[lang]/docs/[...slug]': ['en/getting-started/install']`.

### Where routes come from

Every page in the report has a `source`:

| Source | Meaning |
| --- | --- |
| `config` | `routes.paths`, `routes.dynamic` or `--route` |
| `discovered` | Found in `app/` or `pages/` (route groups, parallel routes and private folders are handled; API routes are skipped by the default `exclude`) |
| `manifest` | Example values of a dynamic route, read from the Next.js build output (including i18n locales) |
| `sitemap` | Listed in a sitemap. Sitemap indexes are followed, and absolute URLs are moved to the tested app, so a sitemap that names `https://example.com` still works locally |
| `crawl` | Linked from a tested page. Links are grouped under the most specific known route pattern |
| `not-found` | The not-found probe |

Dynamic routes without example values are skipped, with a note that lists them. `include`, `exclude` and `--grep` apply to routes from every source.

Discovered routes are cached in `.hydration-proof/cache/` (see `cache`).

## `scenarios`

The browser environments every route is tested in. Default: one scenario named `default` that uses this machine's locale and timezone (a server started on this machine renders with the same ones).

| Option | Description |
| --- | --- |
| `name` | Required, unique |
| `locale` | e.g. `'de-DE'` (also sets `Accept-Language`) |
| `timezoneId` | e.g. `'Asia/Karachi'` |
| `colorScheme` | `'light'` (default), `'dark'`, `'no-preference'` |
| `reducedMotion` | `'reduce'` or `'no-preference'` |
| `viewport` | `{ width, height }` or `'mobile'`, `'tablet'`, `'desktop'` |
| `userAgent` | |
| `storageState` | Playwright storage state file (cookies and local storage of a signed-in user) |
| `cookies` | `[{ name, value, domain?, path?, httpOnly?, secure?, sameSite? }]`; without `domain` they apply to the tested app |
| `headers` | Extra request headers |
| `localStorage`, `sessionStorage` | Entries written before any page script runs |
| `initScripts` | Code run before page scripts |
| `login` | `async ({ page, baseUrl }) => {}`: signs in once before the scenario's pages are tested. The cookies and storage it leaves behind are used for every page |
| `mocks` | Answers for browser requests: `[{ url, method?, status?, headers?, body? }]`. `url` is a glob or a RegExp; object bodies are sent as JSON. Requests the server makes are not affected |
| `include` | Only test routes matching these globs in this scenario |
| `exclude` | Skip routes matching these globs in this scenario |
| `query` | Query parameters added to every URL, e.g. `{ currency: 'EUR' }` |
| `browser` | `'chromium'`, `'firefox'` or `'webkit'` for this scenario (default: `browser.name`) |
| `network` | Throttled network: `'fast-3g'`, `'slow-3g'` or `{ downloadKbps, uploadKbps, latencyMs }` |
| `cpu` | Slow down JavaScript by this factor, e.g. `4` (Chromium only) |
| `cache` | `'warm'` loads the page once before testing it, like a returning visitor (default `'cold'`) |
| `clock` | Fixed browser time (ISO date or epoch milliseconds) for `Date.now()` and `new Date()` |
| `randomSeed` | Seed for `Math.random()` and `crypto.getRandomValues()` in the browser |

`clock` and `randomSeed` are diagnostic options: they only change the browser, and the server keeps its real clock, so time-dependent and random output is still found. They make the client values repeatable between runs.

### Signed-in pages

A typical app has public pages, pages for customers and pages for admins. Give each group its own scenario:

```ts
export default defineConfig({
  scenarios: [
    { name: 'guest', exclude: ['/account/**', '/admin/**'] },
    {
      name: 'customer',
      include: ['/account/**'],
      login: async ({ page, baseUrl }) => {
        await page.goto(`${baseUrl}/login`);
        await page.fill('#email', process.env.TEST_USER_EMAIL ?? '');
        await page.fill('#password', process.env.TEST_USER_PASSWORD ?? '');
        await page.click('button[type=submit]');
        await page.waitForURL('**/account');
      },
    },
    // A cookie is enough when the app accepts a test session.
    { name: 'admin', include: ['/admin/**'], cookies: [{ name: 'session', value: process.env.ADMIN_SESSION ?? '' }] },
  ],
});
```

Each login runs once per run (in a browser context with the scenario's settings). A failing login stops the run with exit code 2 and the error message. If a signed-in page still ends on the login page, the page gets an HP9010 warning, which usually means the login did not work. Keep credentials in environment variables, not in the config file.

Other ways to sign in: `storageState` (a file saved by Playwright), `cookies`, or an `authorization` entry in `headers`.

## `matrix`

Tests every scenario in combinations of environments, so problems that only show up in one locale, timezone, theme, screen size or browser are found.

```ts
matrix: {
  locale: ['en-US', 'de-DE', 'ar-EG'],
  timezoneId: ['UTC', 'Asia/Karachi', 'America/Los_Angeles'],
  colorScheme: ['light', 'dark'],
  viewport: ['desktop', 'mobile'],
  browser: ['chromium', 'firefox', 'webkit'],
  // Custom axes: feature flags, tenants, currencies, ...
  axes: {
    checkout: {
      new: { cookies: [{ name: 'flag-checkout', value: 'new' }] },
      old: {},
    },
    tenant: {
      acme: { headers: { 'x-tenant': 'acme' } },
      globex: { query: { tenant: 'globex' } },
    },
  },
},
```

| Option | Default | Description |
| --- | --- | --- |
| `locale`, `timezoneId`, `colorScheme`, `reducedMotion`, `viewport`, `browser` | | Values to test, like the scenario options of the same name |
| `network` | | `'fast'` (no throttling), `'fast-3g'`, `'slow-3g'` or custom values |
| `cpu` | | CPU slowdown factors, e.g. `[1, 4]` (Chromium only) |
| `cache` | | `['cold', 'warm']` |
| `axes` | | Custom axes: axis name → value name → scenario settings (`cookies`, `headers`, `localStorage`, `sessionStorage`, `initScripts`, `query`) |
| `strategy` | `'pairwise'` | `'pairwise'` tests every pair of values at least once, `'full'` every combination, `'sample'` a random subset |
| `max` | `16` | Most environments per scenario |
| `seed` | `1` | Seed for `'sample'` |
| `scenarios` | all | Scenarios the matrix applies to |

The first value of every axis is the baseline and is always tested. Pairwise testing keeps the matrix small: the example above has 3 × 3 × 2 × 2 × 3 × 2 × 2 = 432 combinations, and pairwise needs about 12 of them. With `'full'`, a matrix larger than `max` falls back to pairwise, with a note.

Combinations a browser cannot run are left out, with a note: CPU slowdown needs Chromium, and Firefox and WebKit cannot combine network throttling with a warm cache. Firefox has no mobile emulation, so `'mobile'` there only sets the viewport size and touch. Mocks turn the HTTP cache off, so `'warm'` then only repeats the visit.

Each environment is a scenario named after its values, e.g. `guest (de-DE, Asia/Karachi, firefox)`. `--scenario guest` selects all of them; `--no-matrix` tests the scenarios as configured. The login of a scenario runs once and is shared by its environments.

When a finding appears in some environments and not in others, the report names the values that separate them, e.g. "Only found with locale de-DE" or "Only found with the production build" (with `--mode both`).

## `probes`

`probes: true` (or `--probe`) proves the cause of value mismatches. Pages with text or attribute differences are loaded again with the browser clock and random values fixed, then once more for each factor with exactly that one thing changed:

| Factor | What changes |
| --- | --- |
| `time` | The browser clock moves by 3 days, 7 hours, 11 minutes and 13 seconds |
| `random` | A different seed for `Math.random()` and `crypto.getRandomValues()` |
| `locale` | The server's locale (or another one) |
| `timezone` | The server's timezone (or another one) |
| `theme` | Light ↔ dark |
| `viewport` | Desktop ↔ mobile |
| `storage` | Without the scenario's `localStorage`, `sessionStorage` and `storageState` (only when it has them) |

A finding whose client value changes, or that disappears, when only one factor changes has that cause **proven**. A page that renders differently on an identical reload depends on server data. Options: `{ factors: ['time', 'random'], maxPages: 5 }`. Each probed page costs up to 9 extra page loads, so probes are off by default. They never hide a finding: fixing the clock is only used to compare runs.

## `repeat`

`repeat: 3` (or `--repeat 3`) loads every page three times. Findings that appear in only some runs are marked flaky ("seen in 2 of 3 runs") and still count: an intermittent mismatch is a real bug. Each page gets a flakiness score, the share of runs whose findings differ from the most common result.

## `ready`

When a page counts as settled. `hydration-proof` never waits for "network idle".

| Option | Default | Description |
| --- | --- | --- |
| `quietMs` | `400` | Time without DOM changes or React commits |
| `hydrationTimeout` | `15000` | Maximum time for hydration to finish once React is loaded |
| `timeout` | `30000` | Maximum time per page |
| `selector` | | Element that must exist before the final snapshot |
| `function` | | Page function (as a string) that must return truthy |

## `checks`

| Option | Default | Finds |
| --- | --- | --- |
| `reactErrors` | `true` | Errors and warnings React reports (HP2xxx) |
| `domDiff` | `true` | DOM differences React produced while hydrating, in the root and in every Suspense boundary (HP1xxx), and `<head>` values hydration changed (HP1014) |
| `propsAudit` | `true` | Attributes and text that differ from what React renders on the client, including the ones React never reports, and events handled twice (HP5006) |
| `invalidHtml` | `true` | Markup the browser repairs, duplicate ids and useId collisions between React roots (HP3xxx) |
| `externalChanges` | `true` | Changes made by other scripts before hydration (HP4xxx) |
| `suppressedWarnings` | `'info'` | `'info'` lists differences hidden by `suppressHydrationWarning`; `'strict'` also flags unused suppression; `'off'` hides both |
| `interactions` | `false` | Interactions while the page loads (below) |
| `navigation` | `false` | Client-side navigation compared with direct loads (below) |

### Interaction checks

`checks.interactions: true` (or `--interactions`) loads every page with its scripts held back, like a user on a slow connection, and then:

- types into the first text field, checks the first checkbox, selects text and scrolls, lets the page hydrate, and checks that the text (HP5002), the checkbox (HP5002), focus and selection (HP5003) and the scroll position (HP5007) survived;
- clicks the first button outside forms and links and compares the result with the same click after hydration. A click that only works after hydration is reported as lost (HP5001, a warning: the page looks ready before it is).

Pages without fields, buttons or scrollable content are skipped. Each page costs about six extra page loads.

### Custom interactions

```ts
interactions: [
  {
    route: '/checkout',
    name: 'continue to payment',
    steps: async ({ page }) => {
      await page.getByLabel('Email').fill('test@example.com');
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByText('Payment').waitFor();
    },
  },
  {
    route: '/search',
    name: 'type before the page is ready',
    when: 'before-hydration',
    steps: async ({ page }) => {
      await page.fill('#query', 'shoes');
    },
  },
],
```

| Field | Description |
| --- | --- |
| `route` | Route glob (matched against the path and the route pattern) |
| `name` | Shown in reports |
| `when` | `'after-hydration'` (default), or `'before-hydration'` to run while the page's scripts are held back |
| `scenarios` | Only in these scenarios |
| `steps` | `async ({ page, baseUrl, url }) => {}` with a Playwright page |

An interaction that throws, or that causes an uncaught error on the page, is reported as HP5008.

### Navigation checks

`checks.navigation: true` (or `--navigation`) opens a page, navigates to each route with the app's router (`router.push` in Next.js, App Router and Pages Router) and compares the result with loading the route directly. Both loads use the same fixed browser clock and random seed, and numbers are ignored in the comparison.

- Content that differs after navigation is reported as HP5004 (a warning). Routes that render parallel routes (`@slot` folders) or that an intercepting route can replace are reported as info, since the difference is usually intended.
- An error thrown during navigation, a failed RSC request, or a URL that never changes is reported as HP5005.
- Navigations the framework turns into a full page load (for example to another root layout) are noted in the timeline, not reported.

| Option | Default | Description |
| --- | --- | --- |
| `from` | `'/'` | Page to navigate from (another tested page when the route is `/`) |
| `prefetch` | `true` | Also navigate after the router prefetched the route |
| `maxRoutes` | `20` | Most routes checked per scenario |

A route can name its own starting page with `navigateFrom` (for example to test a modal that an intercepting route shows).

## `ignore`

Ignored findings stay in the report, marked as ignored, and do not fail the run.

| Option | Description |
| --- | --- |
| `selectors` | Elements whose subtree is not compared. `[data-hydration-proof-ignore]` is always included |
| `attributes` | Attribute names or patterns never compared |
| `textPatterns` | A text difference is ignored if both values are equal after removing these patterns (e.g. `/\d{2}:\d{2}/`) |
| `issues` | Rules with `code`, `route` (glob), `fingerprint` and/or `selector`, plus a required `reason` and an optional `expires` date. An expired rule fails the run, so temporary exceptions do not become permanent |

## `hooks`

Code that runs around the test run, after the app is up:

```ts
hooks: {
  // Seed data or create users. May return a teardown function.
  setup: async ({ baseUrl, rootDir }) => {
    await fetch(`${baseUrl}/api/test/seed`, { method: 'POST' });
    return async () => {
      await fetch(`${baseUrl}/api/test/reset`, { method: 'POST' });
    };
  },
  teardown: async ({ baseUrl }) => {},
},
```

`setup` runs once per build mode before any page is tested, and before the scenario logins. Teardown functions always run, even when testing fails. An error in `setup` stops the run.

## `cache`

`true` by default. Routes found in the file system and the build output are remembered in `.hydration-proof/cache/routes.json`. The cache key covers the Next.js build id and the modification times of the route folders, so a new build or a changed route invalidates it. Use `cache: false` or `--no-cache` to always discover again. Sitemap and crawled routes are never cached.

## Other options

| Option | Default | Description |
| --- | --- | --- |
| `browser` | `{ name: 'chromium', headless: true }` | Also `channel` for an installed browser |
| `workers` | half the CPU cores, at most 4 | Pages tested in parallel |
| `retries` | `0` (`1` on CI) | Retries for pages that fail to load |
| `reporters` | `['list', 'json', 'html']` | Output formats |
| `screenshots` | `'failures'` with the html reporter | Screenshots for the HTML report: `'failures'`, `'all'` or `'off'` |
| `outputDir` | `.hydration-proof/report` | Where reports are written |
| `ci.failOn` | `'error'` | Lowest severity that fails the run, or `'never'` |
| `ci.maxWarnings` | | Fail when there are more warnings |
| `ci.baseline` | `.hydration-proof/baseline.json` | Baseline file ([baselines](ci.md#adopting-on-an-existing-app-baselines)) |
| `ci.newIssuesOnly` | `false` | Fail only on findings that are not in the baseline (`--new-only`) |
| `ci.budget` | | Allowed findings per severity, route glob or code ([budgets](ci.md#budgets)) |
| `ci.history` | `false` | Append one line per run to a history file (`true` or a path) ([trends](ci.md#trends)) |
| `owners` | CODEOWNERS | Route owners and CODEOWNERS lookup ([owners](ci.md#owners)) |
| `redact` | on | Remove secrets and personal data from reports: `false`, or `{ builtIn, patterns, selectors }` ([details](ci.md#personal-data-and-secrets)) |
| `projects` | | Monorepo apps to test, each with its own config ([monorepos](ci.md#monorepos)) |
