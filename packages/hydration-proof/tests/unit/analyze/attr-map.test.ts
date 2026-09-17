import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { propsView, styleDeclarations } from '../../../src/shared/attr-map.ts';

// Differential test: for every audited prop, the attribute hydration-proof
// expects must be exactly what react-dom/server renders, in React 18 and 19.

const fixtures = fileURLToPath(new URL('../../../../../fixtures/', import.meta.url));

interface ReactPair {
  version: string;
  createElement: (type: string, props: Record<string, unknown>) => unknown;
  renderToStaticMarkup: (element: unknown) => string;
}

function load(harness: string): ReactPair {
  const require = createRequire(`${fixtures}${harness}/package.json`);
  const React = require('react') as { version: string; createElement: ReactPair['createElement'] };
  const server = require('react-dom/server') as { renderToStaticMarkup: ReactPair['renderToStaticMarkup'] };
  return { version: React.version, createElement: React.createElement, renderToStaticMarkup: server.renderToStaticMarkup };
}

function decode(value: string): string {
  return value.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Attributes of the first <tag> in the markup, named the way the HTML parser names them. */
function attributesOf(markup: string, tag: string): Map<string, string> {
  const open = new RegExp(`<${tag}(?=[\\s/>])([^>]*)>`).exec(markup)?.[1] ?? '';
  const foreign = tag === 'svg';
  const out = new Map<string, string>();
  for (const match of open.matchAll(/([^\s=/]+)(?:="([^"]*)")?/g)) {
    out.set(foreign ? match[1]! : match[1]!.toLowerCase(), decode(match[2] ?? ''));
  }
  return out;
}

const CASES: [string, Record<string, unknown>][] = [
  ['div', { className: 'a b' }],
  ['div', { className: null }],
  ['div', { className: false }],
  ['div', { className: 42 }],
  ['div', { id: 'main', title: 'Hello "world"', role: 'region', dir: 'rtl', lang: 'ur' }],
  ['div', { tabIndex: 0 }],
  ['label', { htmlFor: 'x' }],
  ['div', { 'data-state': 'open', 'data-flag': true, 'data-off': false, 'aria-hidden': true, 'aria-label': 'x' }],
  ['div', { 'data-empty': '', 'aria-expanded': false }],
  ['a', { href: '/about', target: '_blank', rel: 'noopener' }],
  ['img', { src: '/a.png', alt: '', width: 10, height: 20 }],
  ['a', { href: null }],
  ['input', { disabled: true, readOnly: false, required: 'yes', name: 'q', type: 'search', placeholder: 'Find' }],
  ['video', { autoPlay: true, controls: true, loop: false, muted: true, playsInline: true }],
  ['details', { open: true }],
  ['div', { hidden: true }],
  ['div', { hidden: false }],
  ['div', { draggable: true, spellCheck: false, contentEditable: 'true' }],
  ['script', { async: true, noModule: true, defer: true }],
  ['div', { onClick: () => {}, suppressHydrationWarning: true, children: 'text' }],
  ['svg', { viewBox: '0 0 10 10', className: 'icon', role: 'img' }],
];

describe.each(['ssr-react18', 'ssr-react19'])('propsView matches %s', (harness) => {
  const react = load(harness);

  it.each(CASES)(`<%s> %j`, (tag, props) => {
    const markup = react.renderToStaticMarkup(react.createElement(tag, props));
    const rendered = attributesOf(markup, tag);
    const view = propsView(tag, tag === 'svg', props);
    if (view.opaque !== undefined) return;
    for (const [name, expected] of Object.entries(view.attrs)) {
      expect(rendered.has(name) ? rendered.get(name) : null, `${name} in ${markup} (React ${react.version})`).toBe(expected);
    }
  });

  it('matches inline style serialization', () => {
    const style = { width: 10, lineHeight: 1.5, opacity: 0, color: 'red', '--gap': 4, float: 'left', margin: '' };
    const markup = react.renderToStaticMarkup(react.createElement('div', { style }));
    const rendered = attributesOf(markup, 'div').get('style') ?? '';
    const declarations = new Map(
      rendered
        .split(';')
        .filter(Boolean)
        .map((part) => part.split(':').map((piece) => piece.trim()) as [string, string]),
    );
    for (const [name, value] of styleDeclarations(style)) {
      const cssName = name.startsWith('--') ? name : name.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
      expect(declarations.get(cssName), `${cssName} in ${rendered}`).toBe(value);
    }
  });
});

describe('propsView', () => {
  it('keeps hoisted and custom elements out of the audit', () => {
    expect(propsView('link', false, { rel: 'stylesheet' }).opaque).toBeDefined();
    expect(propsView('my-widget', false, { foo: 'bar' }).opaque).toBeDefined();
    expect(propsView('button', false, { is: 'fancy-button' }).opaque).toBeDefined();
  });

  it('skips values React 18 and 19 render differently', () => {
    expect(propsView('a', false, { href: '' }).skipped).toContain('href');
    expect(propsView('a', false, { href: 'javascript:void(0)' }).skipped).toContain('href');
    expect(propsView('div', false, { hidden: 'until-found' }).skipped).toContain('hidden');
    expect(propsView('div', false, { autoComplete: 'off' }).skipped).toContain('autocomplete');
  });

  it('records text, html and suppression', () => {
    const view = propsView('p', false, { children: 'a\r\nb', suppressHydrationWarning: true });
    expect(view.text).toBe('a\nb');
    expect(view.suppress).toBe(true);
    expect(propsView('div', false, { dangerouslySetInnerHTML: { __html: '<b>x</b>' } }).html).toBe('<b>x</b>');
    expect(propsView('textarea', false, { children: 'x' }).text).toBeUndefined();
  });
});
