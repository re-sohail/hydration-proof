# hydration-proof/no-window-render-branch

Disallow rendering different output depending on whether the code runs on the server or in the browser.

| Recommended | Strict | Suggestions | Server Components |
| --- | --- | --- | --- |
| error | error | no | skipped |

## What it reports

In [render code](../eslint.md#what-counts-as-render):

- `typeof X` compared with a string (`typeof window !== 'undefined'`, `'undefined' == typeof document`, `typeof window.matchMedia === 'function'`), where `X` is a browser-only global such as `window`, `document`, `navigator`, `localStorage`, `sessionStorage`, `matchMedia`, `IntersectionObserver` or `requestAnimationFrame`.
- `'window' in globalThis` and similar `in` checks on the global object.
- `globalThis.window` / `globalThis.document` used as a condition.
- Environment flags used as the condition of `if`, `? :`, `&&`, `||` or `??`: `isServer`, `isBrowser`, `isClient`, `canUseDOM`, `canUseDom`, `isSSR`, `IS_BROWSER`, `IS_SERVER`, `IS_CLIENT` (imports, module-level constants or globals, also as properties such as `ExecutionEnvironment.canUseDOM`), `process.browser` and `import.meta.env.SSR`.

Local variables and props are not flags: `const isClient = useIsClient()` is the recommended pattern and is not reported. A local assigned from a check (`const isClient = typeof window !== 'undefined'`) is reported once, at the check.

Not reported here:

- checks in effects, event handlers and other code that runs after hydration;
- checks in the initial value of `useState`, `useReducer`, `useRef` or class state — [`no-client-only-initial-state`](no-client-only-initial-state.md) reports those;
- checks that guard a `localStorage`/`sessionStorage` read or a `matchMedia` call — [`no-storage-in-initial-render`](no-storage-in-initial-render.md) and [`no-match-media-in-render`](no-match-media-in-render.md) report the read.

Browser reads behind a reported check (`typeof window !== 'undefined' ? window.innerWidth : 0`) are not reported again by [`no-browser-global-in-render`](no-browser-global-in-render.md).

## Why

The check is `false` on the server and `true` during hydration, so the two renders take different branches:

```text
server HTML:   <div class="chart-placeholder"></div>
client render: <canvas class="chart"></canvas>
```

React reports the mismatch and renders the whole page again on the client, which defeats server rendering.

## Incorrect

```jsx
function Chart({ data }) {
  if (typeof window === 'undefined') return <div className="chart-placeholder" />;
  return <Canvas data={data} />;
}

function Greeting() {
  const isBrowser = typeof window !== 'undefined';
  return <p>{isBrowser ? `Hello from ${window.location.hostname}` : 'Hello'}</p>;
}
```

## Correct

```jsx
function useIsClient() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

function Chart({ data }) {
  const isClient = useIsClient();
  if (!isClient) return <div className="chart-placeholder" />;
  return <Canvas data={data} />;
}

function Greeting() {
  const [host, setHost] = useState(null);
  useEffect(() => setHost(window.location.hostname), []);
  return <p>{host ? `Hello from ${host}` : 'Hello'}</p>;
}
```

Both render the server's output during hydration and switch after it. With Next.js, `next/dynamic` with `ssr: false` is another way to render a component only in the browser.

## Options

This rule has no options. Add your own flag names with the shared setting:

```js
{
  settings: { 'hydration-proof': { environmentFlags: ['__SERVER__', 'isNode'] } },
}
```

## When not to use it

In code that is never server-rendered.

## Related

- [`no-browser-global-in-render`](no-browser-global-in-render.md)
- [`require-stable-server-snapshot`](require-stable-server-snapshot.md) reports checks inside `getServerSnapshot`.
