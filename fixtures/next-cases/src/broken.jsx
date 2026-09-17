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

// --- Mismatches React does not always report -------------------------------
// The text matches on both sides; only an attribute, a property or inner HTML
// differs. React 19 never reports these in production and never patches them,
// which is what the props audit is for.

export function AttrMismatchCase() {
  const region = isServer() ? 'eu-west' : 'us-east';
  return (
    <a id="attr-mismatch" href={`/pricing?region=${region}`} data-region={region}>
      See pricing
    </a>
  );
}

export function StyleMismatchCase() {
  // Written during render, unlike the layout-effect control which writes the
  // same properties after hydration and must stay clean.
  const offset = isServer() ? 8 : 24;
  return (
    <div id="style-mismatch" style={{ position: 'absolute', top: `${offset}px` }}>
      Banner
    </div>
  );
}

export function SvgAttrCase() {
  const dark = !isServer() && window.matchMedia('(prefers-color-scheme: dark)').matches;
  return (
    <svg id="svg-attr" width="24" height="24" viewBox="0 0 24 24" aria-label="Status">
      <circle id="svg-attr-dot" cx="12" cy="12" r="10" fill={dark ? '#ffffff' : '#000000'} />
    </svg>
  );
}

export function TextareaValueCase() {
  // `defaultValue` is children on the server and the `value` property on the
  // client, so no mutation record is produced for it.
  const draft = isServer() ? 'Saved draft' : 'Local draft';
  return <textarea id="textarea-value" defaultValue={draft} rows={2} readOnly />;
}

export function SelectOptionCase() {
  // The server renders `selected` on the matching option; the client sets the
  // property.
  const currency = isServer() ? 'EUR' : 'USD';
  return (
    <select id="select-option" defaultValue={currency} aria-label="Currency">
      <option value="EUR">Euro</option>
      <option value="USD">US dollar</option>
    </select>
  );
}

export function DangerousHtmlCase() {
  const html = isServer() ? '<em>Server copy</em>' : '<em>Client copy</em>';
  return <div id="dangerous-html" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function RandomUuidCase() {
  return <p id="random-uuid">Session {crypto.randomUUID().slice(0, 8)}</p>;
}

export function UserAgentCase() {
  // Node 21+ has a `navigator` global too, so this renders "other" on the
  // server rather than falling into the first branch.
  const engine = typeof navigator === 'undefined' ? 'server' : navigator.userAgent.includes('Chrome') ? 'Chromium' : 'other';
  return <p id="user-agent">Rendered for {engine}</p>;
}
