# hydration-proof/no-timezone-without-explicit-timezone

Require an explicit `timeZone` when dates are formatted or split into parts during render.

| Recommended | Strict | Suggestions | Server Components |
| --- | --- | --- | --- |
| warn | error | yes | skipped |

## What it reports

In [render code](../eslint.md#what-counts-as-render):

- `toLocaleDateString()` and `toLocaleTimeString()` without a `timeZone` option.
- `new Intl.DateTimeFormat()` / `Intl.DateTimeFormat()` without a `timeZone` option.
- `toLocaleString()` without a `timeZone` option when the value is clearly a date: the receiver is `new Date(...)` (or a variable initialised with it in the same function), or the options contain date or time fields (`dateStyle`, `timeStyle`, `year`, `month`, `day`, `hour`, `minute`, ...).
- `getHours()`, `getMinutes()`, `getDate()`, `getDay()`, `getMonth()`, `getFullYear()`, `getTimezoneOffset()`, `toDateString()`, `toTimeString()` and `toString()` on `new Date(...)` or a variable initialised with it in the same function.
- `Intl.DateTimeFormat().resolvedOptions().timeZone`, which reads the runtime's time zone.

When the options are not an object literal (`toLocaleDateString('en-US', options)`), the rule cannot see them and does not report.

Suggestions (never automatic fixes):

- add `timeZone: 'UTC'` (or the `defaultTimeZone` option) to the options object, or add an options object when there is none;
- replace `getHours()` and the other local getters with their UTC versions (`getUTCHours()`), when `defaultTimeZone` is `'UTC'`.

## Why

Dates are formatted in the time zone of the runtime. Servers usually run in UTC, browsers in the visitor's zone:

```text
server HTML:   <p>Signed in at 5:00 AM</p>    (UTC)
client render: <p>Signed in at 10:00 AM</p>   (Asia/Karachi)
```

Hydration fails whenever the two zones give a different result, which for times is almost always, and for dates near midnight.

## Incorrect

```jsx
function LastLogin({ at }) {
  return <p>Signed in at {new Date(at).toLocaleTimeString('en-US')}</p>;
}

function Posted({ at }) {
  const date = new Date(at);
  return <p>{date.getDate()}/{date.getMonth() + 1}</p>;
}

function Schedule({ at }) {
  const format = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  return <p>{format.format(at)}</p>;
}
```

## Correct

```jsx
function LastLogin({ at, timeZone }) {
  // The user's zone, stored in their profile or a cookie and passed from the server.
  return <p>Signed in at {new Date(at).toLocaleTimeString('en-US', { timeZone })}</p>;
}

function Posted({ at }) {
  const date = new Date(at);
  return <p>{date.getUTCDate()}/{date.getUTCMonth() + 1}</p>;
}

function Schedule({ at }) {
  const format = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' });
  return <p>{format.format(at)}</p>;
}
```

If the visitor's own zone is required and the server cannot know it, render the date after hydration (in `useEffect`) or put `suppressHydrationWarning` on the element that shows it.

## Options

```js
{
  'hydration-proof/no-timezone-without-explicit-timezone': ['warn', { defaultTimeZone: 'Europe/Berlin' }],
}
```

- `defaultTimeZone` (string, default `'UTC'`): the zone the suggestion inserts. The UTC getter suggestion is only offered when this is `'UTC'`.

## When not to use it

When the servers and all visitors share one time zone, or the runtime's default zone is set explicitly on both sides.

## Related

- [`no-locale-without-explicit-locale`](no-locale-without-explicit-locale.md): `date.toLocaleDateString()` without arguments is missing a locale and a time zone. Both rules report it: this one on the method name, that one on the whole call. They are two separate fixes.
- [`no-date-in-render`](no-date-in-render.md): `new Date().getHours()` reads the current time (that rule) and splits it in the local zone (this rule).
