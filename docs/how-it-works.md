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

- **The component and the source line.** In development builds React records where each element was created; hydration-proof maps that position through the page's source maps to your file and line, and shows the code. React 18 uses the `__source` information the compiler adds. For elements created inside libraries (styled-components, UI kits), the location of the component that used them is shown. In production builds, the component stack of React's error is mapped instead when browser source maps are available.
- **The likely cause**, from the values that differ, the code around that line, the scenario, and the stage where the difference started. See [causes](causes.md).
- **What to do about it**: advice for the cause, plus the general advice for the issue code.

When a location cannot be proven, the report says so instead of guessing.

## Development and production

`--mode both` starts the app twice: a production build and the development server. Development builds give component names and exact source lines; production builds show what users get (React 19 production does not report attribute mismatches at all). Issues found in only one mode are marked.

## What it does not change

Your application code and build are not modified. The runtime exists only in the test browser.
