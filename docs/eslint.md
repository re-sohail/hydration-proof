# ESLint plugin

`eslint-plugin-hydration-proof` finds the code patterns that cause React hydration mismatches while you type: the clock, random values, browser-only globals, storage, media queries, locale and time zone formatting, unstable ids, environment branches, invalid HTML nesting and misused `suppressHydrationWarning`.

Every report says why the code breaks hydration and what to do instead. Some rules offer [suggestions](#rules) (explicit locale, explicit time zone, removing an unused attribute); nothing is fixed automatically, because each fix changes what your app renders.

## Install

Requires ESLint 9 or 10 (flat config) and Node.js 22.18 or newer.

| npm | pnpm | Yarn | Bun |
| --- | --- | --- | --- |
| `npm install -D eslint-plugin-hydration-proof` | `pnpm add -D eslint-plugin-hydration-proof` | `yarn add -D eslint-plugin-hydration-proof` | `bun add -d eslint-plugin-hydration-proof` |

The plugin has no dependencies of its own.

## Set up

`eslint.config.js` (or `eslint.config.mjs`):

```js
import hydrationProof from 'eslint-plugin-hydration-proof';

export default [
  // ...your other configs
  hydrationProof.configs.recommended,
];
```

Next.js App Router projects use the `next` preset, which skips [Server Components](#server-components):

```js
import hydrationProof from 'eslint-plugin-hydration-proof';

export default [hydrationProof.configs.next];
```

`eslint.config.ts`, with typescript-eslint and the rules limited to component files:

```ts
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import hydrationProof from 'eslint-plugin-hydration-proof';

export default defineConfig([
  tseslint.configs.recommended,
  {
    files: ['**/*.{jsx,tsx}'],
    extends: [hydrationProof.configs.next],
  },
]);
```

The presets apply to `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts` and `.cts` files and enable JSX parsing (`languageOptions.parserOptions.ecmaFeatures.jsx`). TypeScript files need a TypeScript parser, for example from typescript-eslint. ESLint loads `eslint.config.ts` with [`jiti`](https://www.npmjs.com/package/jiti), or natively with `--flag unstable_native_nodejs_ts_config`.

To pick rules yourself, register the plugin and turn rules on by name:

```js
import hydrationProof from 'eslint-plugin-hydration-proof';

export default [
  {
    plugins: { 'hydration-proof': hydrationProof },
    rules: {
      'hydration-proof/no-date-in-render': 'error',
      'hydration-proof/no-locale-without-explicit-locale': ['warn', { defaultLocale: 'en-GB' }],
    },
  },
];
```

## Presets

| Preset | What it enables |
| --- | --- |
| `recommended` | Every rule. Definite mismatches are errors; likely ones (locale, time zone, initial state, list order) are warnings. |
| `next` | `recommended` plus `settings['hydration-proof'].serverComponents: 'next-app'`. |
| `strict` | Every rule as an error, and [`audit-suppress-hydration-warning`](rules/audit-suppress-hydration-warning.md) with `reportAll: true`, so every `suppressHydrationWarning` needs a justification. |

## Rules

| Rule | What it catches | `recommended` | `strict` | Suggestions |
| --- | --- | --- | --- | --- |
| [`no-date-in-render`](rules/no-date-in-render.md) | `Date.now()`, `new Date()`, `performance.now()` in render | error | error | |
| [`no-random-in-render`](rules/no-random-in-render.md) | `Math.random()`, `crypto.randomUUID()`, uuid, nanoid, lodash `random`/`sample`/`uniqueId` in render | error | error | |
| [`no-browser-global-in-render`](rules/no-browser-global-in-render.md) | `window`, `document`, `navigator`, `location`, `innerWidth`, ... in render | error | error | |
| [`no-storage-in-initial-render`](rules/no-storage-in-initial-render.md) | `localStorage`/`sessionStorage` in render and initial state | error | error | |
| [`no-match-media-in-render`](rules/no-match-media-in-render.md) | `matchMedia()` in render and initial state | error | error | |
| [`no-locale-without-explicit-locale`](rules/no-locale-without-explicit-locale.md) | `toLocaleString()`, `localeCompare()`, `Intl.*` without a locale | warn | error | yes |
| [`no-timezone-without-explicit-timezone`](rules/no-timezone-without-explicit-timezone.md) | Date formatting without `timeZone`, local-time getters | warn | error | yes |
| [`no-unstable-id`](rules/no-unstable-id.md) | Random, time-based or counter ids instead of `useId()` | error | error | |
| [`no-global-render-counter`](rules/no-global-render-counter.md) | Module-level variables changed during render | error | error | |
| [`no-window-render-branch`](rules/no-window-render-branch.md) | `typeof window` checks and `isServer` flags that change the output | error | error | |
| [`no-invalid-interactive-nesting`](rules/no-invalid-interactive-nesting.md) | `<div>` in `<p>`, `<a>` in `<a>`, `<button>` in `<button>`, `<tr>` in `<table>`, ... | error | error | |
| [`audit-suppress-hydration-warning`](rules/audit-suppress-hydration-warning.md) | `suppressHydrationWarning` that does nothing or covers too much | error | error (every use) | yes |
| [`no-client-only-initial-state`](rules/no-client-only-initial-state.md) | Browser values in `useState`/`useReducer`/`useRef` initial values | warn | error | |
| [`require-stable-server-snapshot`](rules/require-stable-server-snapshot.md) | `useSyncExternalStore` without a stable `getServerSnapshot` | error | error | |
| [`require-deterministic-list-order`](rules/require-deterministic-list-order.md) | Random or locale-dependent sorting, boolean comparators, `shuffle` | warn | error | yes |

## What counts as render

The rules look at code that runs while React renders a component, because that code runs twice: once on the server and once in the browser during hydration.

- **Components:** functions with a PascalCase name (`function Card()`, `const Card = () => ...`, `Card.Header = function ...`), functions wrapped in `memo()`/`forwardRef()` (also `React.memo`, `React.forwardRef`), default-exported functions that return JSX, and the `render()` method, constructor and instance fields of class components.
- **Hooks:** functions named `useSomething`.
- **Also render:** `useMemo` callbacks, lazy initializers of `useState` and `useReducer`, initial values of `useRef`, immediately invoked functions, and callbacks of array methods called during render (`map`, `flatMap`, `filter`, `reduce`, `forEach`, `some`, `every`, `find`, `findIndex`, `sort`, `toSorted`, ...).
- **Not render:** `useEffect`, `useLayoutEffect` and `useInsertionEffect` callbacks, `useCallback` bodies, event handlers, other nested functions (including render props), other class methods, and module-level code.

Globals are resolved with scope analysis: a parameter or local variable called `window`, `document`, `Date` or `Math` is not the global.

## Server Components

Server Components render once, on the server. Their values are sent to the browser as data and are not computed again, so the clock or `Math.random()` in a Server Component cannot cause a mismatch.

Tell the plugin how to recognise them with a shared setting:

```js
export default [
  {
    settings: {
      'hydration-proof': {
        serverComponents: 'next-app', // default: 'none'
      },
    },
  },
];
```

| Value | Files treated as Server Components |
| --- | --- |
| `'none'` (default) | none |
| `'next-app'` (set by the `next` preset) | files under an `app/` directory (any depth: `app/`, `src/app/`, `apps/web/app/`) that do not start with `'use client'` |

Files that start with `'use server'` are always skipped. `pages/` and every other directory are always checked.

Two rules keep checking Server Components: [`no-invalid-interactive-nesting`](rules/no-invalid-interactive-nesting.md) and [`audit-suppress-hydration-warning`](rules/audit-suppress-hydration-warning.md). React still hydrates the HTML elements a Server Component renders, so invalid nesting breaks hydration there too, and the root layout is where `<html suppressHydrationWarning>` lives.

A file under `app/` without `'use client'` becomes a Client Component when a client file imports it. The plugin cannot see the import graph; add `'use client'` to shared client components, or lint them with `serverComponents: 'none'` in a separate config block.

Other settings:

| Setting | Default | |
| --- | --- | --- |
| `environmentFlags` | `[]` | Extra identifier names that [`no-window-render-branch`](rules/no-window-render-branch.md) treats as "am I in the browser" flags, in addition to `isServer`, `isBrowser`, `isClient`, `canUseDOM`, `isSSR`, `IS_BROWSER`, ... |

## One report per problem

The rules share one analysis, so a construct is reported by exactly one rule:

- A random value, a clock read or a counter that ends up in an id is reported by `no-unstable-id`, not by `no-random-in-render`, `no-date-in-render` or `no-global-render-counter`.
- A `typeof window` check is reported by `no-window-render-branch`; the browser reads it guards are not reported again by `no-browser-global-in-render`. When the check guards `localStorage` or `matchMedia`, only the storage or media query rule reports.
- In `useState`, `useReducer`, `useRef` and class state initializers, browser reads and environment checks belong to `no-client-only-initial-state` (storage and `matchMedia` still to their own rules).
- Random values and `localeCompare` inside `sort` comparators, and lodash's `shuffle`/`sampleSize`, belong to `require-deterministic-list-order`.
- Browser reads, the clock and random values inside `getServerSnapshot` belong to `require-stable-server-snapshot`.

Two combinations are reported by two rules on purpose, because they need two fixes: `date.toLocaleDateString()` lacks both a locale (`no-locale-without-explicit-locale`) and a time zone (`no-timezone-without-explicit-timezone`), and `new Date().getHours()` reads the clock (`no-date-in-render`) and the local time zone (`no-timezone-without-explicit-timezone`). The reports are at different positions.

## With `hydration-proof test`

The plugin and the [`hydration-proof` CLI](cli.md) work together:

| | ESLint plugin | `hydration-proof test` |
| --- | --- | --- |
| Runs | in the editor and in CI, on source code | in CI, against the running app in real browsers |
| Finds | patterns that are known to cause mismatches | mismatches that actually happen, including ones no linter can see: data, CSS-in-JS, browser extensions, CDN rewrites, nesting across components, silent attribute mismatches |
| Explains | the pattern and the fix | the element, the server and client values, the component, the line, and the likely cause |

Use the plugin to stop common mistakes before they are committed, and `hydration-proof test` to prove the pages hydrate. The likely causes the CLI reports (time, timezone, locale, random values, browser storage, media queries, invalid HTML, `suppressHydrationWarning`) map directly to the rules above.

## Other plugins

- **eslint-plugin-react-hooks** (`purity`, part of the React Compiler rules) flags known impure calls such as `Date.now()` and `Math.random()` during render. It overlaps with [`no-date-in-render`](rules/no-date-in-render.md) and [`no-random-in-render`](rules/no-random-in-render.md); with both plugins enabled you get two reports for those calls. Keep both, or turn one off.

## Limitations

- The plugin reads one file at a time. Values passed through props, context or other modules, and nesting across components, are not visible; `hydration-proof test` finds those.
- Only the listed hooks, methods and imports are recognised. A custom `useLocalStorage` hook is analysed where it is defined (it is a hook), not where it is called.
- Render props and other callbacks passed to child components are not treated as render code.
