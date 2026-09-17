// Test pages for the SSR harnesses. React is injected, so the same pages run
// against React 18 and React 19. Plain createElement: Node runs this file
// with type stripping only, which has no JSX transform.

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ReactLike {
  createElement: (...args: any[]) => any;
  useState: <T>(initial: T | (() => T)) => [T, (value: T) => void];
  useEffect: (effect: () => void | (() => void), deps?: unknown[]) => void;
  useLayoutEffect: (effect: () => void | (() => void), deps?: unknown[]) => void;
  useId: () => string;
  Suspense: any;
}

export interface PageDef {
  /** Render with renderToPipeableStream (true) or renderToString. */
  stream: boolean;
  /** Extra markup for <head>. */
  head?: string;
  /** Extra markup at the end of <body>, before the client script. */
  bodyEnd?: string;
  /** Mount with createRoot instead of hydrateRoot. */
  clientOnly?: boolean;
  App: (props: Record<string, never>) => any;
  /** A second React root rendered into #root2. */
  second?: (props: Record<string, never>) => any;
  /** identifierPrefix of the second root (server and client). */
  secondPrefix?: string;
}

const isServer = (): boolean => typeof window === 'undefined';

// A tiny suspense resource: resolves after `ms` on the server; on the client
// it resolves after `clientMs` so boundaries hydrate in a later commit.
function createResource(ms: number, clientMs: number) {
  let value: string | undefined;
  let promise: Promise<void> | undefined;
  return {
    reset() {
      value = undefined;
      promise = undefined;
    },
    read(): string {
      if (value !== undefined) return value;
      promise ??= new Promise<void>((resolve) => {
        setTimeout(() => {
          value = 'loaded';
          resolve();
        }, isServer() ? ms : clientMs);
      });
      throw promise;
    },
  };
}

export function createPages(React: ReactLike): Record<string, PageDef> {
  const h = React.createElement;
  const slow = createResource(40, 60);

  function Layout({ children }: { children?: any }) {
    return h('main', { className: 'layout' }, h('h1', null, 'Harness'), children);
  }

  function Counter({ id }: { id: string }) {
    const [count, setCount] = React.useState(0);
    return h('button', { id, type: 'button', onClick: () => setCount(count + 1) }, `Clicked ${count} times`);
  }

  function Form() {
    const [name, setName] = React.useState('');
    const [agree, setAgree] = React.useState(false);
    return h(
      'p',
      null,
      h('input', { id: 'name', value: name, onChange: (event: any) => setName(event.target.value) }),
      h('input', { id: 'agree', type: 'checkbox', checked: agree, onChange: (event: any) => setAgree(event.target.checked) }),
    );
  }

  function ScrollTop() {
    React.useEffect(() => window.scrollTo(0, 0), []);
    return h('p', { id: 'top' }, 'Top');
  }

  function Field({ label }: { label: string }) {
    const id = React.useId();
    return h('p', null, h('label', { htmlFor: id }, label), h('input', { id, name: label }));
  }

  function Loaded() {
    return h('p', { className: 'loaded' }, `Data: ${slow.read()}`);
  }

  function Mounted() {
    const [mounted, setMounted] = React.useState(false);
    React.useEffect(() => setMounted(true), []);
    return h('p', { id: 'mounted' }, mounted ? 'client' : 'server');
  }

  function LayoutWriter() {
    const [, force] = React.useState(0);
    React.useLayoutEffect(() => {
      const el = document.getElementById('floating');
      if (el) el.style.top = '12px';
      force(1);
    }, []);
    return h('div', { id: 'floating', style: { position: 'absolute' } }, 'tooltip');
  }

  function Ids() {
    const id = React.useId();
    return h('label', { htmlFor: id }, 'Name', h('input', { id, defaultValue: 'x' }));
  }

  return {
    ok: {
      stream: false,
      App: () => h(Layout, null, h('p', { className: 'intro', title: 'hello' }, 'Hello'), h(Ids)),
    },
    'text-mismatch': {
      stream: false,
      App: () => h(Layout, null, h('p', { id: 'env' }, isServer() ? 'server' : 'client')),
    },
    // A script adds a click listener to a button React also handles.
    'double-handler': {
      stream: false,
      App: () => h(Layout, null, h(Counter, { id: 'twice' })),
      bodyEnd: `<script>document.getElementById('twice').addEventListener('click', function () { window.__clicks = (window.__clicks || 0) + 1; });</script>`,
    },
    // Controlled fields (reset by hydration), a counter and a long page.
    interactions: {
      stream: false,
      App: () => h(Layout, null, h(Form), h(Counter, { id: 'counter' }), h('div', { style: { height: '3000px' } }, 'Long content')),
    },
    // An effect scrolls to the top on load.
    'scroll-reset': {
      stream: false,
      App: () => h(Layout, null, h(ScrollTop), h('div', { style: { height: '3000px' } }, 'Long content')),
    },
    // Uncontrolled fields keep what was typed; no button.
    'interactions-ok': {
      stream: false,
      App: () => h(Layout, null, h('p', null, h('input', { id: 'free', defaultValue: '' })), h('div', { style: { height: '3000px' } }, 'Long content')),
    },
    // Two roots using useId: without identifierPrefix their ids collide.
    'two-roots': {
      stream: false,
      App: () => h(Field, { label: 'Email' }),
      second: () => h(Field, { label: 'Newsletter email' }),
    },
    'two-roots-prefixed': {
      stream: false,
      App: () => h(Field, { label: 'Email' }),
      second: () => h(Field, { label: 'Newsletter email' }),
      secondPrefix: 'second-',
    },
    // A mismatch next to the field: React re-creates the whole root, so the
    // field typed into before hydration is replaced.
    'input-remount': {
      stream: false,
      App: () =>
        h(
          Layout,
          null,
          h('p', { id: 'env' }, isServer() ? 'server' : 'client'),
          h('p', null, h('input', { id: 'remount', defaultValue: '' })),
          h('div', { style: { height: '3000px' } }, 'Long content'),
        ),
    },
    // Client values that depend on the clock and on random numbers (probes).
    'probe-values': {
      stream: false,
      App: () =>
        h(
          Layout,
          null,
          h('p', { id: 'now' }, isServer() ? 'server time' : `time ${new Date(Date.now()).toISOString()}`),
          h('p', { id: 'random' }, isServer() ? 'server random' : `random ${Math.random().toFixed(6)} ${globalThis.crypto.getRandomValues(new Uint8Array(2)).join('.')}`),
        ),
    },
    'attr-mismatch': {
      stream: false,
      App: () =>
        h(
          Layout,
          null,
          h('p', { id: 'themed', className: isServer() ? 'light' : 'dark', 'data-side': isServer() ? 'server' : 'client' }, 'Same text'),
          h('div', { id: 'styled', style: { width: isServer() ? 10 : 20, color: 'red' } }, 'box'),
        ),
    },
    suppress: {
      stream: false,
      App: () =>
        h(Layout, null, h('time', { id: 'now', suppressHydrationWarning: true }, isServer() ? 'server-time' : 'client-time')),
    },
    effect: {
      stream: false,
      App: () => h(Layout, null, h(Mounted), h(LayoutWriter)),
    },
    structure: {
      stream: false,
      App: () =>
        h(Layout, null, isServer() ? h('section', { id: 'branch' }, 'server branch') : h('aside', { id: 'branch' }, 'client branch')),
    },
    suspense: {
      stream: true,
      App: () =>
        h(
          Layout,
          null,
          h('p', { id: 'before' }, 'before'),
          h(React.Suspense, { fallback: h('p', { id: 'fallback' }, 'loading') }, h(Loaded)),
        ),
    },
    'client-only': {
      stream: false,
      clientOnly: true,
      App: () => h(Layout, null, h('p', null, 'client rendered')),
    },
    'pre-hydration-mutation': {
      stream: false,
      // Runs while the page is parsed, before the deferred client script.
      bodyEnd: '<script>(function(){var p=document.getElementById("target");p.setAttribute("data-extension","1");p.firstChild.data="changed by script"})()</script>',
      App: () => h(Layout, null, h('p', { id: 'target' }, 'original')),
    },
    'noscript-head': {
      stream: false,
      head: '<noscript><img src="/pixel.gif" alt=""></noscript><meta name="after-noscript" content="1">',
      App: () => h(Layout, null, h('p', null, 'noscript in head')),
    },
    'invalid-nesting': {
      stream: false,
      App: () => h(Layout, null, h('p', { id: 'outer' }, h('div', { id: 'inner' }, 'block in paragraph'))),
    },
    'reset-suspense': {
      stream: false,
      App: () => {
        slow.reset();
        return h('p', null, 'reset');
      },
    },
  };
}
