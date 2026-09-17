# hydration-proof/no-invalid-interactive-nesting

Disallow HTML nesting that the browser repairs while parsing, such as `<div>` in `<p>` or `<a>` in `<a>`.

| Recommended | Strict | Suggestions | Server Components |
| --- | --- | --- | --- |
| error | error | no | **checked** |

## What it reports

Nesting in JSX that is visible in one component (through fragments, `&&`, `? :`, arrays and `.map()` callbacks, but not through other components):

- `<a>` in `<a>`, `<button>` in `<button>`, `<form>` in `<form>`, `<label>` in `<label>`, at any depth;
- interactive content inside `<a>` or `<button>`: `a`, `button`, `select`, `textarea`, `label`, `details`, `iframe`, `embed`, `input` (unless `type="hidden"`; a dynamic `type` is not reported) and `audio`/`video` with `controls`;
- elements that close an open `<p>` inside a `<p>`: `div`, `p`, `ul`, `ol`, `li`, `dl`, `dd`, `dt`, `table`, `h1`–`h6`, `section`, `article`, `header`, `footer`, `nav`, `aside`, `main`, `form`, `pre`, `blockquote`, `hr`, `figure`, `figcaption`, `fieldset`, `address`, `details`, `summary`, `dialog`, `hgroup`, `menu`, `search` and a few legacy tags. As in the HTML parser, the search stops at `button`, `table`, `td`, `th`, `caption`, `object` and `template`;
- `<tr>` as a direct child of `<table>` (the browser adds `<tbody>`), and `<td>`/`<th>` as a direct child of `<table>`, `<tbody>`, `<thead>` or `<tfoot>` (the browser adds `<tr>`).

The report is on the inner element. Elements inside `<svg>` and `<math>` are skipped, and so is `<li>` outside a list: a component boundary may put it in the right place.

Unlike the other rules, this rule also checks [Server Components](../eslint.md#server-components): React hydrates the elements a Server Component renders, so invalid nesting there breaks hydration too.

## Why

React renders the tree as written, but the browser builds the DOM from the server's HTML with the HTML parser, which repairs invalid nesting:

```text
server HTML:  <p>Intro<div>Details</div></p>
browser DOM:  <p>Intro</p><div>Details</div><p></p>
```

When React hydrates, the DOM no longer has the structure it rendered. React reports "In HTML, `<div>` cannot be a descendant of `<p>`. This will cause a hydration error." and renders the page again on the client. `hydration-proof test` reports the same problem as HP3xxx issues, with the line in the server HTML.

## Incorrect

```jsx
function Intro() {
  return (
    <p>
      Welcome
      <div className="details">Read more below.</div>
    </p>
  );
}

function CardLink({ href, onSave }) {
  return (
    <a href={href}>
      <h3>Title</h3>
      <button onClick={onSave}>Save</button>
    </a>
  );
}

function Rows({ rows }) {
  return <table>{rows.map((row) => <tr key={row.id}><td>{row.name}</td></tr>)}</table>;
}
```

## Correct

```jsx
function Intro() {
  return (
    <div>
      <p>Welcome</p>
      <div className="details">Read more below.</div>
    </div>
  );
}

function CardLink({ href, onSave }) {
  return (
    <div className="card">
      <a href={href}>
        <h3>Title</h3>
      </a>
      <button onClick={onSave}>Save</button>
    </div>
  );
}

function Rows({ rows }) {
  return (
    <table>
      <tbody>{rows.map((row) => <tr key={row.id}><td>{row.name}</td></tr>)}</tbody>
    </table>
  );
}
```

## Options

This rule has no options.

## When not to use it

When the HTML is never parsed by a browser before React takes over (pure client rendering). Even then the markup is invalid, so keeping the rule is recommended.

## Related

Nesting that crosses component boundaries (`<p><Card /></p>` where `Card` renders a `<div>`) cannot be seen by a linter. `hydration-proof test` finds it in the real server HTML.
