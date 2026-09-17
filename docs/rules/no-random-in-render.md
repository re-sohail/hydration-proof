# hydration-proof/no-random-in-render

Disallow random values while a component renders.

| Recommended | Strict | Suggestions | Server Components |
| --- | --- | --- | --- |
| error | error | no | skipped |

## What it reports

These calls in [render code](../eslint.md#what-counts-as-render):

- `Math.random()`
- `crypto.randomUUID()` and `crypto.getRandomValues()` (the global, `window.crypto`, or `node:crypto`'s `randomUUID`, `randomBytes`, `randomInt`)
- `v1`, `v4`, `v6` and `v7` imported from `uuid` (named or namespace imports; `v3` and `v5` are deterministic and allowed)
- `nanoid()` from `nanoid` (and `nanoid/non-secure`), and functions created at module level with `customAlphabet()` or `customRandom()`
- `uniqueId`, `random` and `sample` from `lodash`, `lodash-es`, `lodash/<name>` or `lodash.<name>`

Only imports are matched, so a local function called `nanoid` is not reported.

## Why

Every render produces a new value, and the hydration render is a new render:

```text
server HTML:   <div class="card card-0.7281">
client render: <div class="card card-0.1942">
```

Text differences are reported by React and make it render the page again. Attribute differences (`className`, `style`, `data-*`) are worse: React 19 keeps the server value **without reporting it** in production, so the page silently runs with the wrong attribute.

## Incorrect

```jsx
import { v4 as uuid } from 'uuid';
import { sample } from 'lodash';

function Tip({ tips }) {
  return <p>{sample(tips)}</p>;
}

function Card() {
  const [seed] = useState(() => Math.random());
  return <div data-seed={seed} />;
}

function Upload() {
  const key = uuid();
  return <Dropzone key={key} />;
}
```

## Correct

Pick on the server and pass the result down:

```jsx
// app/tips/page.jsx (a Server Component, with the next preset)
export default async function Page() {
  const tips = await getTips();
  return <Tip tip={tips[Math.floor(Math.random() * tips.length)]} />;
}
```

Or render something stable first and randomise after hydration:

```jsx
function Tip({ tips }) {
  const [tip, setTip] = useState(tips[0]);
  useEffect(() => setTip(tips[Math.floor(Math.random() * tips.length)]), [tips]);
  return <p>{tip}</p>;
}

// Event handlers run after hydration.
function Upload() {
  const onDrop = (files) => save(files, crypto.randomUUID());
  return <Dropzone onDrop={onDrop} />;
}
```

For ids, use `useId()` (see [`no-unstable-id`](no-unstable-id.md)).

## Options

This rule has no options.

## When not to use it

When the component is never server-rendered, or when the random value is only used for something that never reaches the DOM and never changes what is rendered.

## Related

- [`no-unstable-id`](no-unstable-id.md) reports random values that end up in ids. Those calls are not reported by this rule.
- [`require-deterministic-list-order`](require-deterministic-list-order.md) reports random sort comparators and lodash's `shuffle`/`sampleSize`. Those are not reported by this rule.
- **eslint-plugin-react-hooks**: its `purity` rule (part of the React Compiler rules) also flags known impure calls such as `Math.random()` during render. This rule explains the hydration consequence, skips Server Components, and also covers `crypto`, uuid, nanoid and lodash helpers. Both can be enabled; you will then see two reports for `Math.random()`. Turn one of them off if you prefer a single report.
