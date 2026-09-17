# How it works

`hydration-proof` drives a real browser with Playwright. Before any script of the page runs, it injects a small runtime (about 20 KB) that stays out of the way of the app.

## Connecting to React

React looks for `__REACT_DEVTOOLS_GLOBAL_HOOK__` when it loads, in development and in production builds. The runtime provides that hook (or wraps an existing one, so React DevTools and Fast Refresh keep working) and is told about every renderer and every commit.

Inside a commit, React calls the hook *before* it reports recoverable errors, which lets the runtime capture those errors with their component stack even when the app (or Next.js) provides its own handler.

## The stages

| Stage | How it is captured |
| --- | --- |
| 1. Server HTML | The body of the document response the browser received, read from the same navigation (never fetched twice) |
| 2. Parsed HTML | The same bytes loaded again in a page where scripts are blocked by a Content Security Policy. This is the browser's own parser, so repairs, `<noscript>` and `<template>` behave exactly as in the real page |
| 3. Pre-hydration DOM | Rebuilt by undoing the DOM mutations recorded during React's hydration commit |
| 4. Hydrated DOM | Serialized inside the hydration commit (after layout effects), with the props React renders for each element |
| 5. After effects | The first quiet moment after the hydration commit's effects |
| 6. Stable | When the page stays quiet for `ready.quietMs` |

Every node gets an identity, so the comparison knows whether React reused a node or replaced it.

## The comparisons

| Compared | Finds |
| --- | --- |
| 1 → 2 | Invalid nesting the browser repaired (checked with React's own nesting rules) |
| 2 → 3 | Changes by other scripts and browser extensions before React hydrated (React's streaming moves are undone first) |
| 3 → 4 | Branches React threw away and rendered again, with the exact text, attribute and element differences inside them |
| 3 ↔ React props | Attributes, styles and text that differ from what React renders, which React 19 does not report or fix in production |

Findings from different comparisons are merged, so one bug is reported once, with React's own error attached as evidence.

## Explaining a finding

For every finding, hydration-proof looks up:

- **The component and the source line.** In development builds React records where each element was created; hydration-proof maps that position through the page's source maps to your file and line, and shows the code. React 18 uses the `__source` information the compiler adds. For elements created inside libraries (styled-components, UI kits), the location of the component that used them is shown. In production builds, the code of the component that rendered the element is found in the loaded scripts and mapped through the browser source maps, when they are available.
- **The likely cause**, from the values that differ, the code around that line, the scenario, and the stage where the difference started. See [causes](causes.md).
- **What to do about it**: advice for the cause, plus the general advice for the issue code.

When a location cannot be proven, the report says so instead of guessing.

## Proving a cause

The likely cause is an informed guess. `--probe` turns it into proof: the page is loaded again with the browser clock and random values fixed, then once for each factor with exactly one thing changed (the clock, the random seed, the locale, the timezone, the theme, the viewport, or browser storage). If the client value changes, or the finding disappears, with only one factor changed, that factor is the cause. An identical reload that renders differently points at server data. The server is never changed, so fixing the clock in the browser does not hide a time-dependent value.

## Environments and flaky findings

The `matrix` option tests scenarios in combinations of locales, timezones, themes, viewports, browsers, network and CPU speeds, cache states and custom axes (feature flags, tenants). Pairwise selection keeps the number of combinations small while every pair of values is tested at least once. Afterwards, for each route, the environment values that separate the pages with a finding from the pages without it are reported ("only with locale de-DE").

`--repeat` loads every page several times. Findings that come and go are marked flaky, and each page gets a flakiness score.

## Streaming, Suspense and navigation

Pages that stream HTML hydrate in steps: the root first, then every Suspense boundary when its content and code arrive. Each of these commits is compared on its own, so a mismatch inside one boundary is reported for that boundary, and content React reveals from the stream is not mistaken for a mismatch. A boundary the server could not render, or that React switched to client rendering, is reported with React's error.

The whole document is checked too: `<head>` values that hydration adds or changes (React 19 adds a new `<title>` or `<meta>` instead of fixing the server one), duplicate ids, and useId collisions between several React roots on one page.

With `checks.navigation`, routes are also reached through the app's router, and the result is compared with a direct load; RSC requests are recorded in the timeline. With `checks.interactions`, the page's scripts are held back while the tool types, clicks and scrolls, so what a user does before the page is interactive is checked as well.

## Development and production

`--mode both` starts the app twice: a production build and the development server. Development builds give component names and exact source lines; production builds show what users get (React 19 production does not report attribute mismatches at all). Issues found in only one mode are marked.

## What it does not change

Your application code and build are not modified. The runtime exists only in the test browser.
