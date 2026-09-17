# hydration-proof/no-browser-global-in-render

Disallow reading browser-only globals such as `window` and `document` while a component renders.

| Recommended | Strict | Suggestions | Server Components |
| --- | --- | --- | --- |
| error | error | no | skipped |

## What it reports

Reads in [render code](../eslint.md#what-counts-as-render) of `window`, `self`, `document`, `navigator`, `location`, `history`, `screen`, `innerWidth`, `innerHeight`, `outerWidth`, `outerHeight`, `devicePixelRatio`, `visualViewport`, `scrollX`, `scrollY`, `pageXOffset` and `pageYOffset`, directly or through `window.`, `self.` or `globalThis.` (`globalThis.window.innerWidth`). Any other property read through `window` or `self` (`window.__STATE__`) is reported too.

The rule uses scope analysis: a prop, parameter or local variable called `window` or `location` is not the global and is not reported. Globals that exist on the server as well (`Date`, `Math`, `Intl`, `crypto`, `performance`) are left to the rules for them.

Not reported here, because a more specific rule does:

- `typeof window` and reads behind a `typeof window` / `isBrowser` check: [`no-window-render-branch`](no-window-render-branch.md) reports the check.
- `localStorage` and `sessionStorage`: [`no-storage-in-initial-render`](no-storage-in-initial-render.md).
- `matchMedia`: [`no-match-media-in-render`](no-match-media-in-render.md).
- Initial values of `useState`, `useReducer`, `useRef` and class state: [`no-client-only-initial-state`](no-client-only-initial-state.md).

## Why

On the server these globals do not exist, so the code either throws (`ReferenceError: window is not defined`) or, behind a check, renders something else than the browser:

```text
server HTML:   <aside class="sidebar">        (no window: server rendering failed and fell back, or used a default)
client render: <aside class="sidebar wide">   (window.innerWidth is 1440)
```

## Incorrect

```jsx
function Sidebar() {
  const wide = window.innerWidth > 1024;
  return <aside className={wide ? 'sidebar wide' : 'sidebar'} />;
}

function Language() {
  return <p>{navigator.language}</p>;
}

function useCurrentPath() {
  return location.pathname;
}
```

## Correct

```jsx
// Read browser values after hydration.
function Sidebar() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const update = () => setWide(window.innerWidth > 1024);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return <aside className={wide ? 'sidebar wide' : 'sidebar'} />;
}

// Or subscribe with a server snapshot.
function useOnline() {
  return useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
}

// Use the framework's router instead of location.
function useCurrentPath() {
  return usePathname();
}
```

## Options

This rule has no options.

## When not to use it

In components that only render in the browser (for example loaded with `next/dynamic` and `ssr: false`, or rendered inside a client-only boundary). Consider an `eslint-disable` comment on those files rather than turning the rule off everywhere.

## Related

- [`no-window-render-branch`](no-window-render-branch.md)
- [`no-client-only-initial-state`](no-client-only-initial-state.md)
- [`require-stable-server-snapshot`](require-stable-server-snapshot.md)
