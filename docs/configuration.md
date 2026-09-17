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

`'auto'` (default), `'next'` or `'none'`. The Next.js adapter is chosen automatically when `next` is a dependency. It knows how to build and start the app and discovers routes from `app/` and `pages/`.

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

All `true` by default.

| Option | Finds |
| --- | --- |
| `reactErrors` | Errors and warnings React reports (HP2xxx) |
| `domDiff` | DOM differences React produced while hydrating (HP1xxx) |
| `propsAudit` | Attributes and text that differ from what React renders on the client, including the ones React never reports |
| `invalidHtml` | Markup the browser repairs (HP3xxx) |
| `externalChanges` | Changes made by other scripts before hydration (HP4xxx) |
| `suppressedWarnings` | `'info'` (default) lists differences hidden by `suppressHydrationWarning`; `'strict'` also flags unused suppression; `'off'` hides both |

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
