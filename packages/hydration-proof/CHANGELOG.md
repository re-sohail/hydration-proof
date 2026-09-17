# hydration-proof

## 0.9.0

### Minor Changes

- Hardening: security, compatibility and a regression gate.
  
  - **Scripts and source maps are only fetched from the app's own origin.** A page can name any URL in a `sourceMappingURL` comment, so without this, testing a page you do not control could make your CI runner fetch from a host of that page's choosing. Add `sourceOrigins: ['https://cdn.example.com']` for apps that serve their bundles from a CDN; the run notes every origin it refused, and findings are still reported without a source location.
  - **`hydration-proof migrate`** reports the options this version renamed or replaced and, with `--write`, applies the renames that are safe (only when a key appears exactly once in the file, so a `start` inside `projects` or a `"[data-start]"` selector is never touched). The rest is listed as changes to make by hand.
  - **A regression gate.** `fixtures/captures/` holds a real browser capture of every fixture page; replaying them through the analysis needs no browser and takes under a second, so every pull request and every Node version and OS in the matrix now catches a false positive on a correct page or a lost detection on a broken one.
  - **Faster:** everything after hydration shares one activity poller, so waiting for effects to settle counts towards `ready.quietMs` instead of restarting it. About 10% less time per page, and the quiet period is now measured from the last actual DOM change.
  - **Documented:** [security](https://hydration.jscrate.dev/docs/security) (what leaves your machine, redaction, the local dashboard's token and `Host`/`Origin` checks) and an `examples/` directory with copy-paste configs for Next.js, logins, environment matrices, CI, monorepos, plugins and an existing Playwright setup.
  - The smoke-install matrix covers npm, pnpm, Yarn Classic, Yarn Berry (Plug'n'Play) and Bun; a compatibility workflow runs the fixture suite against other Next.js versions and against React 18.3 and 19.0–19.3.

## 0.8.0

### Minor Changes

- 7cd8f68: Framework adapters, developer tools and plugins.
  
  - **Adapters** for React Router (framework mode), Remix, Astro (every island is its own root; pages without React are fine), Vite SSR and custom Node servers, next to Next.js. They build and start the app, discover routes (`react-router routes`, `remix routes`, `src/pages`), ignore framework markup and navigate with the app's router for navigation checks. `adapter` accepts their names.
  - **`defineAdapter`** (public adapter API) for any other framework: commands, route discovery, normalizers, ignored attributes, client navigation.
  - **Plugins** (`plugins`, `definePlugin`): normalizers, cause detectors, route providers, reporters and adapters.
  - **`hydration-proof dev`**: a browser window with an overlay that checks every page you open; highlight the element, open the source line in your editor, copy a Markdown report, re-run.
  - **`hydration-proof test --watch`**: keeps the development server running and re-tests the routes each change affects.
  - **`hydration-proof ui`**: a local dashboard (127.0.0.1, token-protected) to run tests, follow their output and read the latest report.
  - `init` recognizes the new frameworks.
  - Inline script contents are no longer compared (frameworks render different code on each side), and inserted or removed scripts are not reported.
  - Card numbers are only redacted when they have a card network prefix and length (timestamps were redacted before).

## 0.7.0

### Minor Changes

- 7b5c57b: CI and team workflows.
  
  - **CI formats**: `junit` (one test case per page), `sarif` (SARIF 2.1.0 for GitHub code scanning, with stable fingerprints), `github` (annotations plus a job summary; added automatically on GitHub Actions) and `gitlab` (Code Quality report).
  - **Baselines**: `hydration-proof baseline` records the current findings; `test --new-only` (or `ci.newIssuesOnly`) fails only on new ones. Entries keep their first-seen date, and hand-written `reason` and `expires` fields are kept; expired entries fail the run. `--update-baseline` refreshes the file. The baseline has a JSON schema.
  - **Budgets** (`ci.budget`): allowed findings per severity, per route glob and per issue code.
  - **Owners** (`owners`): route owners from the config and CODEOWNERS entries of source files, shown in every report and filterable in the HTML report.
  - **Changed routes** (`--changed [ref]`): only the routes the changed files can affect, from an import graph of your sources (path aliases and workspace packages included).
  - **Report merging** (`hydration-proof merge-reports`): combines the reports of `--shard` jobs, including screenshots, and applies the CI policy.
  - **Monorepos** (`projects`, `--project`): test several apps, each with its own config, and get one combined report.
  - **Trends** (`ci.history`): one NDJSON line per run; the HTML report shows the last 30 runs.
  - **Redaction** (on by default, `redact`): emails, tokens, JWTs, API keys, card numbers and secret URL parameters are removed from all reports; custom patterns; elements can be blacked out in screenshots.
  - **`init --ci github|gitlab`** writes a workflow for your package manager.
  - Reports record the git commit and branch.
  - The package size budget is now 800 KB unpacked / 250 KB gzipped.

## 0.6.0

### Minor Changes

- Streaming, navigation and interaction checks.
  
  - **Suspense and streaming**: every boundary that hydrates later is compared on its own, so a mismatch inside one streamed boundary is reported for that boundary only.
  - **Document checks**: `<head>` values that hydration adds or changes (HP1014; React 19 adds a second `<title>` or `<meta>` instead of fixing the server one), duplicate ids (HP3003), and useId collisions between React roots without an `identifierPrefix` (HP3004, new).
  - **Events handled twice** (HP5006, new): an element with a React handler that a script listener or an inline `on*` attribute also handles.
  - **Navigation checks** (`checks.navigation`, `--navigation`): each route is reached with the app's router (Next.js App Router and Pages Router), with and without prefetch, and compared with loading it directly. Content that differs (HP5004, new) and navigations that throw, fail their RSC request or never finish (HP5005, new) are reported. Parallel and intercepting routes are recognized, and their expected differences are reported as info. Routes can set `navigateFrom`.
  - **Interaction checks** (`checks.interactions`, `--interactions`): the page's scripts are held back while the tool types, checks a box, selects text, scrolls and clicks. Lost input (HP5002), lost focus or selection (HP5003), scroll jumps (HP5007, new) and clicks that did nothing (HP5001, now a warning) are reported.
  - **Custom interactions** (`interactions`): Playwright steps per route, before or after hydration; failures and page errors are reported as HP5008 (new).
  - **Server Action form state**: mismatches inside forms the server rendered with `useActionState` results (`<!--F!-->`) get their own cause.
  - **Timeline**: script loads and RSC requests, and the steps of navigation checks.
  - The package size budget is now 600 KB unpacked / 150 KB gzipped (the Node code ships unminified for readable stack traces).

## 0.5.0

No changes in this release.

## 0.4.0

### Minor Changes

- Find problems that only happen in some environments, and prove what causes them.
  
  - **Environment matrix** (`matrix`): test every scenario in combinations of locales, timezones, color schemes, reduced motion, viewports, browsers (Chromium, Firefox and WebKit in one run), network speeds, CPU slowdown, cold and warm cache, and custom axes such as feature flags, tenants or currencies. Pairwise selection (default) covers every pair of values with a small number of runs; `full` and `sample` strategies and a `max` limit keep the matrix under control, and combinations a browser cannot run are skipped with a note. `--no-matrix` turns it off for quick runs.
  - **"Only in ..." labels**: when a finding appears in some environments and not others, the report names the values that separate them ("Only found with locale de-DE", "Only found with the production build").
  - **Probes** (`probes`, `--probe`): pages with value mismatches are loaded again with the browser clock and random values fixed, then with exactly one thing changed (clock, random seed, locale, timezone, theme, viewport, storage). Causes confirmed this way are marked as proven; values that change between identical reloads are attributed to server data.
  - **Repeat runs** (`repeat`, `--repeat n`): findings that appear in only some runs are marked flaky, and each page gets a flakiness score.
  - **Scenario options**: `browser`, `network`, `cpu`, `cache`, `query`, and the diagnostic `clock` and `randomSeed` (the server keeps its real clock, so unstable values are still found).
  - The HTML report shows the environment of each page, the other environments of the same route, probe results and flaky findings.

## 0.3.0

### Minor Changes

- Test the whole app, including signed-in areas.
  
  - **More routes**: dynamic pages the build pre-rendered are tested automatically (`routes.manifestExamples`), plus the not-found page (`routes.notFound`). `routes.query` adds query-string variants, `--sitemap` / `routes.sitemap` reads `robots.txt`, sitemaps and sitemap indexes, and `--crawl` / `routes.crawl` follows same-origin links. Every page records where its route came from.
  - **Signed-in pages**: a scenario's `login` function signs in once and its cookies and storage are used for every page. Scenarios can `include` / `exclude` routes, so public, customer and admin areas are tested in one run. A page that ends on another URL is reported as HP9010 (set `expectRedirect` when that is intended).
  - **API mocks**: `mocks` answer browser requests with fixed data.
  - **Hooks**: `hooks.setup` (which may return a teardown) and `hooks.teardown` run once the app is up, for seeding data or creating users.
  - **CI**: `--shard i/n` splits pages across parallel jobs without overlap. Discovered routes are cached per build (`cache`, `--no-cache`).
  - **Server logs**: error and warning lines the app server printed while a page loaded are attached to the page.
  - **Production source locations**: with browser source maps, issues now point at the component that rendered the element even when React's production component stack leaves it out. When no location can be shown, the report says whether source maps were missing or only framework code could be mapped.

## 0.2.0

### Minor Changes

- Findings now explain themselves.
  
  - **Likely cause** for every finding, with a confidence score: time, timezone, locale, random values, browser-only APIs, localStorage, media queries, dark/light theme, differing data, invalid HTML, CSS-in-JS class names, browser extensions, scripts that run before hydration, and CDN rewrites. Each cause comes with its own fix.
  - **Component and source line**: in development builds the report shows the file, line and code where the element was created (React 18 and 19, webpack and Turbopack, including monorepo workspace packages). In production builds the component stack is mapped through browser source maps when they are available; otherwise the report says why the location is unknown.
  - **HTML report** (`report.html`, on by default): filters, server and client values side by side with the differences highlighted, the element on each side, code frames, screenshots with the affected elements outlined, and a timeline of the page.
  - **`--mode both`** tests the production build and the development server in one run and marks issues found in only one of them.
  - **`suppressHydrationWarning` audit**: structural differences under a suppressed element (HP6002), mismatches in descendants the suppression does not cover, and suppression that hides a difference that does not look intentional are reported.
  - Next.js development overlays and React DevTools-style tooling roots are ignored; Suspense boundaries React leaves for later no longer cause timeouts.
  - New config options: `server.mode: 'both'`, `server.devCommand`, `screenshots`.

## 0.1.0

### Minor Changes

- 23f4593: First release: find React hydration problems in real browsers, locally and in CI.
  
  - `hydration-proof test` builds and starts your app (or uses `--url`), loads every route in Chromium, Firefox or WebKit, and reports hydration problems with the element, the server and client values, and a suggested fix. It exits with code 1 when something is wrong.
  - Works without changing your app: hydration-proof connects to React through the DevTools hook, in development and production builds of React 18 and 19.
  - Finds text and structure mismatches, including branches React re-rendered, and attribute, class and style mismatches that React 19 never reports in production.
  - Finds invalid HTML the browser repairs, DOM changes made by scripts or extensions before hydration, and whitespace rewritten by CDNs.
  - Lists differences hidden by `suppressHydrationWarning` as info.
  - Next.js App Router and Pages Router: routes are discovered from `app/` and `pages/`, dynamic routes use example values from the config.
  - Scenarios for locale, timezone, color scheme, viewport, storage state, cookies, headers and storage.
  - Ignore rules by selector, attribute, text pattern or finding, with optional expiry dates.
  - `hydration-proof init`, `install` and `doctor` commands; terminal and JSON reports; stable issue codes, fingerprints and exit codes.
