---
"hydration-proof": minor
---

First release: find React hydration problems in real browsers, locally and in CI.

- `hydration-proof test` builds and starts your app (or uses `--url`), loads every route in Chromium, Firefox or WebKit, and reports hydration problems with the element, the server and client values, and a suggested fix. It exits with code 1 when something is wrong.
- Works without changing your app: hydration-proof connects to React through the DevTools hook, in development and production builds of React 18 and 19.
- Finds text and structure mismatches, including branches React re-rendered, and attribute, class and style mismatches that React 19 never reports in production.
- Finds invalid HTML the browser repairs, DOM changes made by scripts or extensions before hydration, and whitespace rewritten by CDNs.
- Lists differences hidden by `suppressHydrationWarning` as info.
- Next.js App Router and Pages Router: routes are discovered from `app/` and `pages/`, dynamic routes use example values from the config.
- Scenarios for locale, timezone, color scheme, viewport, storage state, cookies, headers and storage.
- Ignore rules by selector, attribute, text pattern or finding, with optional expiry dates.
- `hydration-proof init`, `install` and `doctor` commands; terminal and JSON reports; stable issue codes, fingerprints and exit codes.
