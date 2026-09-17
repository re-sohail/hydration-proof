# hydration-proof/no-locale-without-explicit-locale

Require an explicit locale for locale-sensitive formatting during render.

| Recommended | Strict | Suggestions | Server Components |
| --- | --- | --- | --- |
| warn | error | yes | skipped |

## What it reports

In [render code](../eslint.md#what-counts-as-render), when the locale argument is missing, `undefined`, `void 0` or `[]`:

- `value.toLocaleString()`, `value.toLocaleDateString()`, `value.toLocaleTimeString()`
- `a.localeCompare(b)` (the locale is the second argument)
- `Intl.NumberFormat`, `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat`, `Intl.PluralRules`, `Intl.Collator`, `Intl.ListFormat` and `Intl.DisplayNames`, with or without `new`
- `Intl.X().resolvedOptions().locale`, which reads the runtime's default locale

A variable as the locale (`toLocaleString(locale)`) is accepted: the rule cannot know its value, and passing the locale from the server is the fix.

The suggestion inserts the locale from the `defaultLocale` option (`'en-US'` by default). It is offered as a suggestion, not a fix, because the right locale is a product decision.

## Why

Without a locale, formatting uses the default locale of the JavaScript runtime. Servers usually run with `en-US` (or whatever the container sets); browsers use the visitor's language:

```text
server HTML:   <p>Total: 1,234.5</p>   (en-US)
client render: <p>Total: 1.234,5</p>   (de-DE)
```

React reports the text mismatch and renders the page again on the client.

## Incorrect

```jsx
function Price({ amount }) {
  return <p>Total: {amount.toLocaleString()}</p>;
}

function Percent({ value }) {
  const format = new Intl.NumberFormat(undefined, { style: 'percent' });
  return <span>{format.format(value)}</span>;
}

function Match({ a, b }) {
  return <p>{a.localeCompare(b) === 0 ? 'same' : 'different'}</p>;
}
```

## Correct

```jsx
function Price({ amount, locale }) {
  // The locale comes from the request (cookie, URL or Accept-Language) and is passed down.
  return <p>Total: {amount.toLocaleString(locale)}</p>;
}

function Percent({ value }) {
  const format = new Intl.NumberFormat('en-US', { style: 'percent' });
  return <span>{format.format(value)}</span>;
}

function Match({ a, b }) {
  return <p>{a.localeCompare(b, 'en') === 0 ? 'same' : 'different'}</p>;
}
```

## Options

```js
{
  'hydration-proof/no-locale-without-explicit-locale': ['warn', { defaultLocale: 'en-GB' }],
}
```

- `defaultLocale` (string, default `'en-US'`): the locale the suggestion inserts.

## When not to use it

When every server and every visitor uses the same locale (an internal tool with a fixed locale, for example), or when the app sets the runtime's default locale explicitly on both sides.

## Related

- [`no-timezone-without-explicit-timezone`](no-timezone-without-explicit-timezone.md): `date.toLocaleDateString()` without arguments is missing both a locale and a time zone. Each rule reports its own half, at a different position, so the two reports are two separate fixes.
- [`require-deterministic-list-order`](require-deterministic-list-order.md) reports `localeCompare` inside `sort` comparators (the list order changes), so this rule does not.
