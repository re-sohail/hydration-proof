# hydration-proof/no-global-render-counter

Disallow changing module-level variables while a component renders.

| Recommended | Strict | Suggestions | Server Components |
| --- | --- | --- | --- |
| error | error | no | skipped |

## What it reports

Writes (`++`, `--`, `=`, `+=`, `??=`, destructuring assignments) to a module-level `let` or `var` from [render code](../eslint.md#what-counts-as-render). Writes at module level, in effects and in event handlers are fine, and so is mutating an object (`cache.set(...)`) — only reassigning the variable is reported.

## Why

A module is loaded once per server process and once per browser tab. On the server the variable keeps its value across every request and every user; in the browser it starts from the initial value:

```text
server HTML (request 1,000): <p>Item #3001</p>
client render:               <p>Item #1</p>
```

React Strict Mode and concurrent rendering also render components more than once, so the value drifts even in the browser.

## Incorrect

```jsx
let renderCount = 0;

function Item({ name }) {
  renderCount += 1;
  return <p>Item #{renderCount}: {name}</p>;
}

let lastUser;

function useUser(user) {
  lastUser = user;
  return lastUser;
}
```

## Correct

```jsx
function List({ items }) {
  return items.map((item, index) => <p key={item.id}>Item #{index + 1}: {item.name}</p>);
}

function useUser(user) {
  const lastUser = useRef(user);
  useEffect(() => {
    lastUser.current = user;
  }, [user]);
  return user;
}
```

Use `useId()` for ids and `useRef` for values that should survive re-renders of one component.

## Options

```js
{
  'hydration-proof/no-global-render-counter': ['error', { allow: ['cache'] }],
}
```

- `allow` (string array, default `[]`): module-level variables that may be written during render, for example a deliberate memoisation cache whose value is the same on both sides.

## When not to use it

When the module is only ever evaluated in the browser.

## Related

- [`no-unstable-id`](no-unstable-id.md) reports counters that are used for ids, with a message that points to `useId()`. Those writes are not reported by this rule.
