# Troubleshooting

## "chromium is not installed"

Run `npx hydration-proof install` (add `--with-deps` on Linux CI). It installs the browser for the Playwright version hydration-proof uses.

## "Nothing answers at …" / the app does not start

- Check `server.command` works on its own. `{port}` is replaced with the port hydration-proof chose; the port is also in the `PORT` environment variable.
- Increase `server.timeout` for slow builds.
- With `--url`, start the app first.

## Next.js development mode

`hydration-proof` opens the dev server on `localhost`, because Next.js blocks development resources for other hosts. If you test a dev server through another host name, add it to `allowedDevOrigins` in `next.config`.

## A difference that is intentional

Mark the element with `data-hydration-proof-ignore`, add a selector to `ignore.selectors`, or add an `ignore.issues` rule with a reason. For values that differ on purpose (timestamps), render them after mount or use `suppressHydrationWarning` on that element; `hydration-proof` then lists them as info.

## A page keeps changing and never settles

Pages with animations, polling or live data may never be quiet. Set `ready.selector` or `ready.function`, or lower `ready.quietMs`.

## Signed-in pages end on the login page (HP9010)

The scenario's `login` did not leave a working session. Run with `--headed --workers 1` to watch it, check that it waits for the page after signing in (`page.waitForURL`), and check that the session cookie is not limited to another domain. If a route is supposed to redirect, set `expectRedirect` on it.

## "The login of scenario … failed" / "The setup hook failed"

The `login` function or the `setup` hook threw; the message follows. Both run after the app is up, with the same base URL the pages use (`baseUrl`).

## Some dynamic routes are skipped

Dynamic routes are only tested with example values: from `routes.dynamic`, or from pages the build pre-rendered. Add values under `routes.dynamic`, or list the URLs in a sitemap and turn on `routes.sitemap`.

## Routes are missing after adding a page

Discovered routes are cached until the build or a route folder changes. Run with `--no-cache` if a change was missed.

## No source location in production

The issue's `sourceUnavailableReason` says why. Enable browser source maps (`productionBrowserSourceMaps: true` in Next.js) to get the component, or run with `--mode development` for the exact line. Elements rendered by Server Components have no client code to point at.

## The matrix is too slow

Every environment loads every route. Use the default `strategy: 'pairwise'`, lower `matrix.max`, limit the matrix to some scenarios with `matrix.scenarios`, or run quick local checks with `--no-matrix`. In CI, split the pages with `--shard`.

## Slow network in Firefox or WebKit

Only Chromium can throttle the network. In Firefox and WebKit, every request except the page itself is delayed by the latency instead, which turns the HTTP cache off. CPU slowdown is Chromium only.

## A cause is "not proven"

Probes prove a cause when a finding changes with exactly one factor. When the page renders differently on identical reloads, the value comes from the server or an API (for example a counter or the current time on the server), which the browser cannot control. Send the data the server rendered with to the client.

## Navigation checks report differences

Client navigation keeps state that a direct load does not have: module variables, context in layouts, parallel route slots. If the difference is intended (a modal from an intercepting route, a slot that keeps its page), add an ignore rule for the route with `code: 'HP5004'`. To start from another page, set `checks.navigation.from` or `navigateFrom` on the route.

## Interaction checks find a lost click

A server-rendered button is visible before React can handle its clicks. Show the control as disabled or loading until the page is interactive, or make it work without JavaScript. If that is acceptable for your app, ignore HP5001.

## Component names are single letters

Production builds minify component names. Run with `--mode development` to see real component names.

## TypeScript config errors

The config is loaded by Node.js directly. Use plain types (no `enum`), include file extensions in relative imports, or rename the file to `.mjs`.
