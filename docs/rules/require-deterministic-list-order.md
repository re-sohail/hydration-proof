# hydration-proof/require-deterministic-list-order

Require list ordering during render to be the same on the server and in the browser.

| Recommended | Strict | Suggestions | Server Components |
| --- | --- | --- | --- |
| warn | error | yes | skipped |

## What it reports

In [render code](../eslint.md#what-counts-as-render):

- `sort`/`toSorted` comparators that use random values (`() => Math.random() - 0.5`);
- `localeCompare` without an explicit locale inside a `sort`/`toSorted` comparator. A suggestion adds the `defaultLocale` option (`'en-US'` by default);
- comparators that return a boolean (`(a, b) => a > b`). When both sides are simple values, a suggestion rewrites the comparator to return `1`, `-1` or `0`;
- lodash's `shuffle` and `sampleSize` (from `lodash`, `lodash-es`, `lodash/<name>` or `lodash.<name>`).

`sort()` without a comparator is fine: the default order compares strings by UTF-16 code units, which is the same everywhere.

## Why

The server and the browser must render list items in the same order:

- random comparators and shuffle helpers give a different order on each render;
- `localeCompare` without a locale sorts with the runtime's default locale (`'ä'` sorts differently in German and Swedish);
- a comparator must return a negative number, zero or a positive number. A boolean is `1` or `0`, never negative, and each JavaScript engine (V8 on the server, JavaScriptCore in Safari) handles that inconsistency differently.

```text
server HTML:   <li>Anna</li><li>Émile</li><li>Zoë</li>
client render: <li>Anna</li><li>Zoë</li><li>Émile</li>
```

## Incorrect

```jsx
import { shuffle } from 'lodash';

function Featured({ products }) {
  return shuffle(products).map((product) => <Product key={product.id} {...product} />);
}

function Names({ names }) {
  return names.toSorted((a, b) => a.localeCompare(b)).map((name) => <li key={name}>{name}</li>);
}

function Scores({ scores }) {
  return [...scores].sort((a, b) => a.points < b.points).map((s) => <li key={s.id}>{s.points}</li>);
}
```

## Correct

```jsx
function Featured({ products, seed }) {
  // Shuffled on the server (or with a seed from the server), passed as a prop.
  return products.map((product) => <Product key={product.id} {...product} />);
}

function Names({ names, locale }) {
  return names.toSorted((a, b) => a.localeCompare(b, locale)).map((name) => <li key={name}>{name}</li>);
}

function Scores({ scores }) {
  return [...scores].sort((a, b) => b.points - a.points).map((s) => <li key={s.id}>{s.points}</li>);
}
```

## Options

```js
{
  'hydration-proof/require-deterministic-list-order': ['warn', { defaultLocale: 'de-DE' }],
}
```

- `defaultLocale` (string, default `'en-US'`): the locale the `localeCompare` suggestion inserts.

## When not to use it

When lists are only rendered in the browser.

## Related

- [`no-random-in-render`](no-random-in-render.md) and [`no-locale-without-explicit-locale`](no-locale-without-explicit-locale.md) leave calls inside sort comparators, and `shuffle`/`sampleSize`, to this rule.
