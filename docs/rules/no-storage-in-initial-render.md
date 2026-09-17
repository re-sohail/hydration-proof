# hydration-proof/no-storage-in-initial-render

Disallow reading `localStorage` or `sessionStorage` while a component renders, including state initializers.

| Recommended | Strict | Suggestions | Server Components |
| --- | --- | --- | --- |
| error | error | no | skipped |

## What it reports

Any read of `localStorage` or `sessionStorage` (bare, or through `window.`, `self.`, `globalThis.`) in [render code](../eslint.md#what-counts-as-render), including the initial values of `useState`, `useReducer`, `useRef` and class component state. Reads behind a `typeof window !== 'undefined'` check are reported too: the check keeps the server from crashing, but the two renders still differ. `typeof localStorage` on its own is an environment check and belongs to [`no-window-render-branch`](no-window-render-branch.md).

## Why

The server has no storage, so it renders the default. The browser renders the stored value during hydration:

```text
server HTML:   <html class="light">   (no stored theme)
client render: <html class="dark">    (localStorage.theme === 'dark')
```

React 19 keeps the server's `class="light"` without a warning in production, so the page stays in the wrong theme until something re-renders it. A text difference makes React discard the server HTML and render again.

## Incorrect

```jsx
function ThemeToggle() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') ?? 'light');
  return <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme}</button>;
}

function Draft() {
  const saved = typeof window !== 'undefined' ? sessionStorage.getItem('draft') : '';
  return <textarea defaultValue={saved} />;
}
```

## Correct

```jsx
// Start from the default, then load the stored value.
function ThemeToggle() {
  const [theme, setTheme] = useState('light');
  useEffect(() => {
    setTheme(localStorage.getItem('theme') ?? 'light');
  }, []);
  return <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme}</button>;
}

// Or subscribe to storage with a server snapshot.
function useStoredTheme() {
  return useSyncExternalStore(
    subscribeToStorage,
    () => localStorage.getItem('theme') ?? 'light',
    () => 'light',
  );
}
```

For a theme that must be right before the first paint, store it in a cookie and read it on the server, or set the class with an inline script before React loads and put `suppressHydrationWarning` on `<html>`.

## Options

This rule has no options.

## When not to use it

In components that are never server-rendered.

## Related

- [`no-client-only-initial-state`](no-client-only-initial-state.md) covers other browser values in initial state.
- [`require-stable-server-snapshot`](require-stable-server-snapshot.md) reports storage reads inside `getServerSnapshot`.
