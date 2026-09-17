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
  /** Mount with createRoot instead of hydrateRoot. */
  clientOnly?: boolean;
  App: (props: Record<string, never>) => any;
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
      head: '<script>document.addEventListener("DOMContentLoaded",function(){var p=document.getElementById("target");p.setAttribute("data-extension","1");p.firstChild.data="changed by script"})</script>',
      App: () => h(Layout, null, h('p', { id: 'target' }, 'original')),
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
