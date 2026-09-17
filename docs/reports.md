# Reports

Reports are written to `.hydration-proof/report/` (see `outputDir`).

## Terminal (`list`)

One line per page while testing, the most important issues of failing pages with the server and client values, the likely cause, the source location and the first suggested fix, and a summary.

## JSON (`json`)

`report.json` contains everything: run information, a summary, every page and every issue. Its format is described by `node_modules/hydration-proof/schema/report.json` and only changes in a compatible way within `schemaVersion: 1`.

Every page records where its route came from (`source`: `config`, `discovered`, `manifest`, `sitemap`, `crawl` or `not-found`) and, when the tool started the app, the error and warning lines the server printed while the page loaded (`serverLogs`).

Every issue has a `fingerprint` that stays the same across runs as long as the problem is the same (same code, route pattern, element and attribute), which is what ignore rules and baselines use.

## HTML (`html`)

`report.html` is a single file you can open locally or publish as a CI artifact. It shows:

- a summary and filters (page status, issue severity, cause, kind, scenario, text search, ignored issues)
- per page: the issues with server and client values side by side (differences highlighted), the element on each side, the component, the source code, evidence and fixes, plus the server log lines printed while the page loaded
- screenshots of the page after hydration and of the server HTML without scripts, with the affected elements outlined (`screenshots: 'failures'` by default)
- a timeline of what happened on the page: React loading, hydration commits, React errors, scripts changing the DOM, streamed content

Deep links such as `report.html#page=…&issue=…` open a specific finding. The page makes no network requests.

## Source locations

Issues point at the code that rendered the element when it can be proven:

- **Development builds** (`--mode development`): the exact file and line where the element was created.
- **Production builds with browser source maps** (`productionBrowserSourceMaps: true` in Next.js): the component that rendered the element. Its code is found in the loaded scripts and mapped back through the source maps.
- Otherwise the issue says why no location is shown (`sourceUnavailableReason`), for example when the scripts have no source maps, or when only framework code could be mapped (elements rendered by Server Components have no client code).
