# hydration-proof/no-client-only-initial-state

Disallow initial state and refs computed from browser-only values.

| Recommended | Strict | Suggestions | Server Components |
| --- | --- | --- | --- |
| warn | error | no | skipped |

## What it reports

Browser-only reads (`window`, `document`, `navigator`, `location`, `history`, `screen`, `innerWidth`, `devicePixelRatio`, ... — the list of [`no-browser-global-in-render`](no-browser-global-in-render.md)) in:

- the initial value of `useState` (value or lazy initializer),
- the initial argument and the init function of `useReducer`,
- the initial value of `useRef`,
- class component state: a `state = { ... }` field or `this.state = { ... }` in the constructor.

An initializer that reads nothing from the browser but branches on the environment (`useState(typeof window !== 'undefined')`, `useState(isBrowser ? 'live' : 'static')`) is reported once, at the check.

`localStorage`/`sessionStorage` and `matchMedia` in initializers are left to [`no-storage-in-initial-render`](no-storage-in-initial-render.md) and [`no-match-media-in-render`](no-match-media-in-render.md), including a `typeof window` check that guards them.

## Why

State initializers run during the first render, on the server and again during hydration. A guard keeps the server from crashing, but the two sides still start from different state:

```text
server HTML:   <nav class="menu-desktop">   (useState(() => typeof window === 'undefined' ? 1024 : window.innerWidth) → 1024)
client render: <nav class="menu-mobile">    (the same initializer → 390)
```

React keeps the server's HTML only when the first client render produces the same output.

## Incorrect

```jsx
function Menu() {
  const [width] = useState(() => (typeof window === 'undefined' ? 1024 : window.innerWidth));
  return width < 600 ? <MobileMenu /> : <DesktopMenu />;
}

function ShareButton() {
  const [canShare] = useState(typeof navigator !== 'undefined' && 'share' in navigator);
  return canShare ? <button>Share</button> : null;
}

class Page extends React.Component {
  state = { path: window.location.pathname };
  render() {
    return <p>{this.state.path}</p>;
  }
}
```

## Correct

```jsx
function Menu() {
  const [width, setWidth] = useState(1024);
  useEffect(() => {
    const update = () => setWidth(window.innerWidth);
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return width < 600 ? <MobileMenu /> : <DesktopMenu />;
}

function ShareButton() {
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare('share' in navigator), []);
  return canShare ? <button>Share</button> : null;
}

class Page extends React.Component {
  state = { path: this.props.initialPath };
  componentDidMount() {
    this.setState({ path: window.location.pathname });
  }
  render() {
    return <p>{this.state.path}</p>;
  }
}
```

## Options

This rule has no options.

## When not to use it

In components that are never server-rendered. The rule is a warning in `recommended` because a component can be client-only by design (for example behind `next/dynamic` with `ssr: false`).

## Related

- [`no-browser-global-in-render`](no-browser-global-in-render.md) reports browser reads elsewhere in render.
- [`no-window-render-branch`](no-window-render-branch.md) reports environment checks elsewhere in render.
