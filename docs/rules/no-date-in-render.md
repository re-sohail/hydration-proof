# hydration-proof/no-date-in-render

Disallow reading the current time while a component renders.

| Recommended | Strict | Suggestions | Server Components |
| --- | --- | --- | --- |
| error | error | no | skipped |

## What it reports

These calls in [render code](../eslint.md#what-counts-as-render):

- `Date.now()`
- `new Date()` and `Date()` without arguments
- `performance.now()`
- `Temporal.Now.*()`

It also finds them through `window.`, `self.` and `globalThis.`, and ignores local variables that happen to be called `Date` or `performance`. Dates built from explicit values (`new Date(post.publishedAt)`) are fine.

## Why

The server renders the component at one moment, and the browser renders it again when it hydrates, a few hundred milliseconds (or, with a cached page, days) later:

```text
server HTML:   <p>Rendered at 1767225600000</p>
client render: <p>Rendered at 1767225600412</p>
```

React finds different text, reports a hydration error and, in React 19, throws the server HTML away and renders the page again on the client.

## Incorrect

```jsx
function Footer() {
  return <p>© {new Date().getFullYear()}</p>;
}

function Countdown({ endsAt }) {
  const left = endsAt - Date.now();
  return <span>{Math.round(left / 1000)}s</span>;
}

function Timer() {
  const [start] = useState(() => performance.now());
  return <Elapsed since={start} />;
}
```

## Correct

Pass the time from a Server Component, so both renders use the same value:

```jsx
// app/sale/page.jsx (a Server Component, with the next preset)
export default async function Page() {
  return <Countdown endsAt={deadline} now={Date.now()} />;
}
```

Or render a placeholder and read the clock after hydration:

```jsx
function Countdown({ endsAt }) {
  const [now, setNow] = useState(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (now === null) return <span>–</span>;
  return <span>{Math.round((endsAt - now) / 1000)}s</span>;
}

// Explicit dates are deterministic.
export function Published({ at }) {
  return <time dateTime={at}>{new Date(at).toISOString().slice(0, 10)}</time>;
}
```

Reading the clock in event handlers, effects and `useCallback` callbacks is fine: they run after hydration.

## Options

This rule has no options.

## When not to use it

When the component is never server-rendered (a client-only app, or a component loaded with `next/dynamic` and `ssr: false`), or when the output is wrapped in an element with `suppressHydrationWarning` on purpose (for example a live clock).

## Related

- [`no-unstable-id`](no-unstable-id.md) reports the clock when the value ends up in an `id` (or `htmlFor`, `aria-*`, `name`). Those calls are not reported by this rule.
- [`no-timezone-without-explicit-timezone`](no-timezone-without-explicit-timezone.md) reports `new Date().getHours()` for the time zone; this rule reports the `new Date()` in it. They are different problems.
- [`require-stable-server-snapshot`](require-stable-server-snapshot.md) reports the clock inside `getServerSnapshot`.
- **eslint-plugin-react-hooks**: its `purity` rule (part of the React Compiler rules) also flags known impure calls such as `Date.now()` during render, because they make renders unpredictable. This rule explains the hydration consequence, skips Server Components, covers `performance.now()` and `Temporal.Now`, and hands ids to `no-unstable-id`. Both can be enabled; you will then see two reports for the same call. Turn one of them off if you prefer a single report.
