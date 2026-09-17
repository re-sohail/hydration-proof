'use client';
// The twelve required broken cases. Each renders a different value on the
// server and during the browser's first render.

import styled from 'styled-components';
import { read } from './read.js';

const isServer = () => typeof window === 'undefined';

export function DateNowCase() {
  return <p id="date-now">Rendered at {Date.now()}</p>;
}

export function MathRandomCase() {
  return <p id="math-random">Lucky number {Math.random().toFixed(8)}</p>;
}

export function LocaleCase() {
  return <p id="locale">Total: {(1234567.891).toLocaleString()}</p>;
}

export function TimezoneCase() {
  return <p id="timezone">Opens at {new Date(Date.UTC(2026, 8, 17, 5, 0)).toLocaleTimeString('en-US')}</p>;
}

export function LocalStorageCase() {
  const name = isServer() ? 'guest' : (window.localStorage.getItem('name') ?? 'guest');
  return <p id="local-storage">Welcome back, {name}</p>;
}

export function MatchMediaCase() {
  const narrow = !isServer() && window.matchMedia('(max-width: 600px)').matches;
  return <p id="match-media">{narrow ? 'Mobile layout' : 'Desktop layout'}</p>;
}

export function InvalidNestingCase() {
  return (
    <p id="invalid-nesting">
      <div id="invalid-nesting-inner">A block inside a paragraph</div>
    </p>
  );
}

export function DarkModeCase() {
  const dark = !isServer() && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return (
    <div id="dark-mode" className={dark ? 'theme-dark' : 'theme-light'}>
      Theme preview
    </div>
  );
}

// A styled component created only on the server shifts styled-components'
// id counter, so the server and the browser generate different class names.
if (isServer()) styled.h2``;
const Title = styled.h2`
  color: tomato;
`;

export function CssInJsCase() {
  return <Title id="css-in-js">Styled title</Title>;
}

export function BrowserMutationCase() {
  return <p id="browser-mutation">Hello world</p>;
}

export function CdnWhitespaceCase() {
  return (
    <p id="cdn-whitespace">
      Hello{' '}
      <strong>world</strong>{' '}
      again
    </p>
  );
}

export function ApiDataCase({ origin, requestId }) {
  const url = `${isServer() ? origin : ''}/api/counter?request=${requestId}`;
  const data = read(url, () => fetch(url, { cache: 'no-store' }).then((response) => response.json()));
  return <p id="api-data">Visits: {data.count}</p>;
}
