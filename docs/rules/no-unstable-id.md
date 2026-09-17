# hydration-proof/no-unstable-id

Disallow ids built from random values, the clock or module-level counters.

| Recommended | Strict | Suggestions | Server Components |
| --- | --- | --- | --- |
| error | error | no | skipped |

## What it reports

Values that change between renders and end up in an id:

- **Sources:** everything [`no-random-in-render`](no-random-in-render.md) and [`no-date-in-render`](no-date-in-render.md) recognise (`Math.random()`, `crypto.randomUUID()`, uuid, nanoid, lodash's `uniqueId`, `Date.now()`, `new Date()`, ...), and module-level `let`/`var` counters changed during render (`nextId++`).
- **Id attributes:** `id`, `htmlFor`, `for`, `aria-labelledby`, `aria-describedby`, `aria-controls`, `aria-owns`, `aria-activedescendant`, `aria-details`, `aria-errormessage`, `list` and `popoverTarget` on any element; `name` on `input`, `select`, `textarea`, `button`, `fieldset` and `output`; and props ending in `Id` on components (`labelId`, `triggerId`).
- **Id state:** `useState` and `useRef` whose variable is named like an id (`id`, `inputId`, `idRef`).

The value is followed through local variables, `useState`, `useRef` and `useMemo` initializers, template literals, class fields (`this.id`) and module-level constants. The report is on the call (or counter update) that makes the value unstable.

## Why

The id rendered on the server is not the id rendered during hydration:

```text
server HTML:   <label for="field-0.4211">Email</label><input id="field-0.4211">
client render: <label for="field-0.8390">Email</label><input id="field-0.8390">
```

React keeps the server's attributes without a warning in production, so the page works until another render updates some attributes but not others. Labels then point at nothing and screen readers lose the connection. A module-level counter is worse: the server keeps counting across requests (`field-5731`) while every browser starts at `field-1`.

`useId()` produces the same id on the server and during hydration, because it is derived from the component's position in the tree.

## Incorrect

```jsx
import { nanoid } from 'nanoid';

let nextId = 0;

function EmailField() {
  const id = `email-${nextId++}`;
  return (
    <>
      <label htmlFor={id}>Email</label>
      <input id={id} type="email" />
    </>
  );
}

function Tooltip({ children }) {
  const [tooltipId] = useState(() => nanoid());
  return <span aria-describedby={tooltipId}>{children}</span>;
}
```

## Correct

```jsx
function EmailField() {
  const id = useId();
  return (
    <>
      <label htmlFor={id}>Email</label>
      <input id={id} type="email" />
    </>
  );
}

function Tooltip({ children }) {
  const tooltipId = useId();
  return <span aria-describedby={tooltipId}>{children}</span>;
}
```

For list items, combine `useId()` with a stable key from your data: `` `${id}-${item.id}` ``.

## Options

This rule has no options.

## When not to use it

In components that are never server-rendered. Otherwise there is no reason to turn it off: `useId()` exists in React 18 and 19.

## Related

This rule takes precedence over [`no-random-in-render`](no-random-in-render.md), [`no-date-in-render`](no-date-in-render.md), [`no-global-render-counter`](no-global-render-counter.md) and [`require-deterministic-list-order`](require-deterministic-list-order.md): a value reported here is not reported by them.
