# hydration-proof/audit-suppress-hydration-warning

Report `suppressHydrationWarning` where it has no effect or hides more than intended.

| Recommended | Strict | Suggestions | Server Components |
| --- | --- | --- | --- |
| error | error, with `reportAll: true` | yes (remove an unused attribute) | **checked** |

## What it reports

`suppressHydrationWarning` (not `={false}`) on:

- **an HTML element with element children** (`tooDeep`). The attribute only covers the element's own attributes and its direct text, one level deep. A mismatch inside a child is still an error.
- **an HTML element whose attributes and text are all static** (`unused`). Nothing can differ, so the attribute only hides future mistakes. `key`, `ref` and event handlers are ignored when deciding. A suggestion removes the attribute.
- **a component** (`onComponent`), such as `<Clock suppressHydrationWarning />`. It has no effect unless the component passes the prop to an HTML element.
- with `reportAll: true` (the `strict` preset), **every other use** (`audit`), so each suppression needs an `eslint-disable` comment that explains it.

`<html>` and `<body>` are accepted by default (option `allowOn`): theme scripts and browser extensions change their attributes before React hydrates, which is the use case the attribute exists for.

Unlike most rules, this rule also checks [Server Components](../eslint.md#server-components): the root layout, where `<html suppressHydrationWarning>` usually lives, is one.

## Why

`suppressHydrationWarning` tells React to keep the server's text and attributes for one element without reporting a difference. Used in the wrong place it either does nothing (the error still happens) or hides a real bug:

```jsx
<div suppressHydrationWarning>
  <span>{new Date().toLocaleTimeString()}</span>   {/* still a hydration error: the text is in the span */}
</div>
```

`hydration-proof test` lists every difference hidden by the attribute as HP6xxx info, so you can check what each one suppresses.

## Incorrect

```jsx
function Clock() {
  return (
    <div suppressHydrationWarning>
      <span>{new Date().toLocaleTimeString('en-US', { timeZone: 'UTC' })}</span>
    </div>
  );
}

function Title() {
  return <h1 suppressHydrationWarning>Dashboard</h1>;
}

function Page() {
  return <RelativeTime suppressHydrationWarning />;
}
```

## Correct

```jsx
function Clock({ now }) {
  return (
    <div>
      <span suppressHydrationWarning>{now.toLocaleTimeString('en-US', { timeZone: 'UTC' })}</span>
    </div>
  );
}

function Title() {
  return <h1>Dashboard</h1>;
}

export function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
```

## Options

```js
{
  'hydration-proof/audit-suppress-hydration-warning': ['error', { allowOn: ['html', 'body', 'ThemeProvider'], reportAll: false }],
}
```

- `allowOn` (string array, default `['html', 'body']`): element or component names where any use is accepted. Set it to `[]` to check `<html>` and `<body>` as well.
- `reportAll` (boolean, default `false`): also report uses that are not obviously wrong. The `strict` preset turns this on.

## When not to use it

When a design system passes `suppressHydrationWarning` through many wrapper components on purpose: add those components to `allowOn` instead of turning the rule off.

## Related

- [`no-date-in-render`](no-date-in-render.md), [`no-timezone-without-explicit-timezone`](no-timezone-without-explicit-timezone.md): fixing the cause is usually better than suppressing it.
