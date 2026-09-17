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
| `discover` | `true` when no `paths` | Find static routes from the framework |

Route objects:

```ts
{ path: '/404-page', expectStatus: [404], scenarios: ['default'], ready: { selector: '#app' } }
```

Globs: `*` matches one path segment, `**` any number (`/blog/**` also matches `/blog`). Dynamic values fill parameters in order; separate values for several parameters with `/`, and a catch-all takes the rest: `'/[lang]/docs/[...slug]': ['en/getting-started/install']`.

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
