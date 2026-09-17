import { useEffect } from 'react';
import { Link } from 'react-router';
import { visits } from '../visits.js';

export const meta = () => [{ title: 'React Router fixture' }];

const pages = ['/static', '/date-now', '/math-random', '/products/42', '/counter', '/nav-target'];

export default function Home() {
  useEffect(() => {
    visits.from = 'home';
  }, []);
  return (
    <main>
      <h1 id="home">React Router fixture</h1>
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
