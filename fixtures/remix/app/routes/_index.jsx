import { useEffect } from 'react';
import { Link } from '@remix-run/react';
import { visits } from '../visits.js';

export const meta = () => [{ title: 'Remix fixture' }];

const pages = ['/static', '/date-now', '/math-random', '/products/42', '/counter', '/nav-target'];

export default function Index() {
  useEffect(() => {
    visits.from = 'home';
  }, []);
  return (
    <main>
      <h1 id="home">Remix fixture</h1>
      <ul>
        {pages.map((path) => (
          <li key={path}>
            <Link to={path}>{path}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
