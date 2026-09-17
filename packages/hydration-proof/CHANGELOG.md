# hydration-proof

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
