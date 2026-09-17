# hydration-proof/no-match-media-in-render

Disallow evaluating media queries with `matchMedia` while a component renders.

| Recommended | Strict | Suggestions | Server Components |
| --- | --- | --- | --- |
| error | error | no | skipped |

## What it reports

`matchMedia(...)`, `window.matchMedia(...)`, `self.matchMedia(...)` and `globalThis.matchMedia(...)` calls (and references to `matchMedia` that are not a `typeof` check) in [render code](../eslint.md#what-counts-as-render), including state initializers and code behind a `typeof window` check.

## Why

The server has no screen and no user preferences. Code that guards the call renders a fallback on the server and the real answer in the browser:

```text
server HTML:   <nav class="menu-desktop">   (no matchMedia: assumes desktop)
client render: <nav class="menu-mobile">    (matchMedia('(max-width: 600px)').matches)
```

## Incorrect

```jsx
function Menu() {
  const mobile = typeof window !== 'undefined' && window.matchMedia('(max-width: 600px)').matches;
  return mobile ? <MobileMenu /> : <DesktopMenu />;
}

function useReducedMotion() {
  const [reduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  return reduced;
}
```

## Correct

```jsx
// Let CSS decide when possible: both menus are in the HTML.
function Menu() {
  return (
    <>
      <MobileMenu className="only-mobile" />
      <DesktopMenu className="only-desktop" />
    </>
  );
}

// Or subscribe with a server snapshot.
function useMediaQuery(query) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
```

`useSyncExternalStore` renders the server snapshot during hydration and then switches to the real value, so hydration matches.

## Options

This rule has no options.

## When not to use it

In components that are never server-rendered.

## Related

- [`require-stable-server-snapshot`](require-stable-server-snapshot.md) makes sure `getServerSnapshot` does not call `matchMedia`.
- [`no-window-render-branch`](no-window-render-branch.md) reports `typeof window.matchMedia` checks.
