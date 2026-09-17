# hydration-proof/require-stable-server-snapshot

Require `useSyncExternalStore` to have a `getServerSnapshot` that returns the same value on the server and during hydration.

| Recommended | Strict | Suggestions | Server Components |
| --- | --- | --- | --- |
| error | error | no | skipped |

## What it reports

- `useSyncExternalStore(subscribe, getSnapshot)` without a third argument (or with `undefined`), including `React.useSyncExternalStore` and the `use-sync-external-store/shim` export.
- Inside `getServerSnapshot` — an inline function, or a function declared in the same file and passed by name — any read of a browser-only global, `localStorage`/`sessionStorage`, `matchMedia`, the clock (`Date.now()`, `new Date()`, ...), random values (`Math.random()`, ...) and environment checks (`typeof window`).

Functions nested inside `getServerSnapshot` and functions imported from other files are not inspected.

## Why

During server rendering React calls `getServerSnapshot`; without it, rendering the component on the server fails and React renders it again in the browser. During hydration React calls `getServerSnapshot` again, in the browser, and expects the value the server used. Only after hydration does it switch to `getSnapshot`:

```text
server:     getServerSnapshot() → typeof window === 'undefined' → 'light'
hydration:  getServerSnapshot() → typeof window === 'undefined' → 'dark'   (mismatch)
```

So `getServerSnapshot` must be a pure function of data both sides have.

## Incorrect

```jsx
function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine);
}

function useTheme() {
  return useSyncExternalStore(
    subscribeToStorage,
    () => localStorage.getItem('theme'),
    () => localStorage.getItem('theme') ?? 'light',
  );
}

const getWidth = () => window.innerWidth;

function useWidth() {
  return useSyncExternalStore(subscribeToResize, getWidth, getWidth);
}
```

## Correct

```jsx
function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

function useTheme(serverTheme) {
  return useSyncExternalStore(
    subscribeToStorage,
    () => localStorage.getItem('theme') ?? serverTheme,
    () => serverTheme, // read from a cookie on the server and passed as a prop
  );
}

const getWidth = () => window.innerWidth;
const getServerWidth = () => 1024;

function useWidth() {
  return useSyncExternalStore(subscribeToResize, getWidth, getServerWidth);
}
```

## Options

This rule has no options.

## When not to use it

When the store is only used in components that are never server-rendered.

## Related

- [`no-client-only-initial-state`](no-client-only-initial-state.md), [`no-storage-in-initial-render`](no-storage-in-initial-render.md) and [`no-match-media-in-render`](no-match-media-in-render.md) recommend `useSyncExternalStore` with a server snapshot as a fix.
