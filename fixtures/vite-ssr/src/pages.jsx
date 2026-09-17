import { useState } from 'react';

const links = ['/static', '/date-now', '/math-random', '/products/42', '/counter'];

function Home() {
  return (
    <main>
      <h1 id="home">Vite SSR fixture</h1>
      <ul>
        {links.map((path) => (
          <li key={path}>
            <a href={path}>{path}</a>
          </li>
        ))}
      </ul>
    </main>
  );
}

function Static() {
  return (
    <main>
      <h1 id="static">Static page</h1>
      <p>This text is the same on the server and in the browser.</p>
    </main>
  );
}

function DateNow() {
  return (
    <main>
      <p id="date-now">Rendered at {Date.now()}</p>
    </main>
  );
}

function MathRandom() {
  return (
    <main>
      <p id="math-random">Lucky number {Math.random().toFixed(8)}</p>
    </main>
  );
}

function Product({ params }) {
  return (
    <main>
      <h1 id="product">Product {params.id}</h1>
    </main>
  );
}

function Counter() {
  const [count, setCount] = useState(0);
  return (
    <main>
      <button id="counter" type="button" onClick={() => setCount((c) => c + 1)}>
        Clicked {count} times
      </button>
    </main>
  );
}

function NotFound() {
  return (
    <main>
      <h1 id="not-found">Not found</h1>
    </main>
  );
}

const routes = [
  { path: '/', page: Home },
  { path: '/static', page: Static },
  { path: '/date-now', page: DateNow },
  { path: '/math-random', page: MathRandom },
  { path: '/products/:id', page: Product },
  { path: '/counter', page: Counter },
];

/** A tiny router shared by the server and the client: `:name` segments become params. */
export function matchRoute(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  for (const route of routes) {
    const pattern = route.path.split('/').filter(Boolean);
    if (pattern.length !== parts.length) continue;
    const params = {};
    const matches = pattern.every((segment, i) => {
      if (segment.startsWith(':')) {
        params[segment.slice(1)] = decodeURIComponent(parts[i]);
        return true;
      }
      return segment === parts[i];
    });
    if (matches) return { path: route.path, page: route.page, params };
  }
  return null;
}

export function App({ pathname }) {
  const match = matchRoute(pathname);
  if (!match) return <NotFound />;
  const Page = match.page;
  return <Page params={match.params} />;
}
