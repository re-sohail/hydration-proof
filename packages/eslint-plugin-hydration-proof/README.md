# eslint-plugin-hydration-proof

Stop React hydration mismatches before they are committed.

ESLint rules for the code that renders differently on the server and in the browser: the clock, random values, `window` and `localStorage`, media queries, locale and time zone formatting, unstable ids, `typeof window` branches, invalid HTML nesting and misused `suppressHydrationWarning`. Every report says why it breaks hydration and what to do instead.

**[Documentation](https://hydration.jscrate.dev/docs/eslint)** · [Rules](https://github.com/re-sohail/hydration-proof/blob/main/docs/eslint.md#rules) · [hydration-proof CLI](https://www.npmjs.com/package/hydration-proof)

```tsx
// app/dashboard/LastLogin.tsx
'use client';

export function LastLogin({ at }: { at: number }) {
  const seen = Date.now() - at;
  return (
    <p>
      Signed in at {new Date(at).toLocaleTimeString('en-US')}
      <div className="ago">{Math.round(seen / 60000)} minutes ago</div>
    </p>
  );
}
```

```text
$ npx eslint .

app/dashboard/LastLogin.tsx
  4:16  error    `Date.now()` reads the clock during render. The server renders one time and the browser another while hydrating, so the output does not match. Pass the time from the server (props or data), or read it in useEffect after hydration                          hydration-proof/no-date-in-render
  7:34  warning  `new Date(at).toLocaleTimeString('en-US')` formats the date in the time zone of whichever runtime renders it. Servers usually run in UTC and browsers in the visitor's zone, so the text does not match during hydration. Pass an explicit `timeZone` option   hydration-proof/no-timezone-without-explicit-timezone
  8:7   error    `<div>` cannot be inside `<p>`. The browser closes the `<p>` before the `<div>` while parsing the server HTML, so the DOM no longer matches what React rendered and hydration fails. Use a `<div>` instead of the `<p>`, or a `<span>` instead of the `<div>`  hydration-proof/no-invalid-interactive-nesting

✖ 3 problems (2 errors, 1 warning)
```

## Install

```bash
npm install -D eslint-plugin-hydration-proof
```

Works with npm, pnpm, Yarn and Bun. Requires ESLint 9 or 10 (flat config) and Node.js 22.18 or newer. The plugin has no dependencies.

## Use it

```js
// eslint.config.js
import hydrationProof from 'eslint-plugin-hydration-proof';

export default [
  // Next.js App Router: skips Server Components (files in app/ without 'use client')
  hydrationProof.configs.next,
];
```

Other React apps use `hydrationProof.configs.recommended`. The presets cover `.js`, `.jsx`, `.ts` and `.tsx` files (and their `.m`/`.c` variants); TypeScript files need `@typescript-eslint/parser`.

| Preset | |
| --- | --- |
| `recommended` | Every rule. Definite mismatches are errors, likely ones are warnings. |
| `next` | `recommended`, and App Router files without `'use client'` are treated as Server Components. |
| `strict` | Every rule as an error, and every `suppressHydrationWarning` must be justified. |

## Rules

| Rule | Catches | Suggestions |
| --- | --- | --- |
| `no-date-in-render` | `Date.now()`, `new Date()`, `performance.now()` | |
| `no-random-in-render` | `Math.random()`, `crypto.randomUUID()`, uuid, nanoid, lodash | |
| `no-browser-global-in-render` | `window`, `document`, `navigator`, `location`, `innerWidth` | |
| `no-storage-in-initial-render` | `localStorage` and `sessionStorage`, also in initial state | |
| `no-match-media-in-render` | `matchMedia()`, also in initial state | |
| `no-locale-without-explicit-locale` | `toLocaleString()`, `localeCompare()`, `Intl.*` without a locale | yes |
| `no-timezone-without-explicit-timezone` | date formatting without `timeZone`, `getHours()` and friends | yes |
| `no-unstable-id` | random, time or counter ids instead of `useId()` | |
| `no-global-render-counter` | module-level variables changed during render | |
| `no-window-render-branch` | `typeof window` checks and `isServer` flags that change the output | |
| `no-invalid-interactive-nesting` | `<div>` in `<p>`, `<a>` in `<a>`, `<button>` in `<button>`, `<tr>` in `<table>` | |
| `audit-suppress-hydration-warning` | `suppressHydrationWarning` that does nothing or covers too much | yes |
| `no-client-only-initial-state` | browser values in `useState`, `useReducer`, `useRef` initial values | |
| `require-stable-server-snapshot` | `useSyncExternalStore` without a stable `getServerSnapshot` | |
| `require-deterministic-list-order` | random or locale-dependent sorting, boolean comparators, `shuffle` | yes |

Only code that runs during render is checked: component and hook bodies, `useMemo`, state initializers and array callbacks. Effects, event handlers and callbacks are not. Local variables called `window` or `Date` are not mistaken for the globals, and each construct is reported by one rule (two only when it needs two separate fixes, such as a missing locale and a missing time zone). Suggestions are never applied automatically.

Details and examples for every rule: [docs/eslint.md](https://github.com/re-sohail/hydration-proof/blob/main/docs/eslint.md).

## With hydration-proof

A linter sees one file at a time. [`hydration-proof`](https://www.npmjs.com/package/hydration-proof) loads your pages in real browsers and reports the mismatches that actually happen, including the ones no linter can see (data, CSS-in-JS, browser extensions, nesting across components, silent attribute mismatches in production). Use both: the plugin while you write code, `hydration-proof test` in CI.

## License

MIT © [Sohail Khan](https://me.jscrate.dev)
