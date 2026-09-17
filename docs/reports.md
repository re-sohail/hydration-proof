# Reports

Reports are written to `.hydration-proof/report/` (see `outputDir`).

## Terminal (`list`)

One line per page while testing, the most important issues of failing pages with the server and client values, the likely cause, the source location and the first suggested fix, and a summary.

## JSON (`json`)

`report.json` contains everything: run information, a summary, every page and every issue. Its format is described by `node_modules/hydration-proof/schema/report.json` and only changes in a compatible way within `schemaVersion: 1`.

Every issue has a `fingerprint` that stays the same across runs as long as the problem is the same (same code, route pattern, element and attribute), which is what ignore rules and baselines use.

## HTML (`html`)

`report.html` is a single file you can open locally or publish as a CI artifact. It shows:

- a summary and filters (page status, issue severity, cause, kind, scenario, text search, ignored issues)
- per page: the issues with server and client values side by side (differences highlighted), the element on each side, the component, the source code, evidence and fixes
- screenshots of the page after hydration and of the server HTML without scripts, with the affected elements outlined (`screenshots: 'failures'` by default)
- a timeline of what happened on the page: React loading, hydration commits, React errors, scripts changing the DOM, streamed content

Deep links such as `report.html#page=…&issue=…` open a specific finding. The page makes no network requests.
