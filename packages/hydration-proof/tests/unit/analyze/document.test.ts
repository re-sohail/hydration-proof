import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeDuplicateIds, analyzeHead, USE_ID_PATTERN } from '../../../src/analyze/document.ts';
import { formsWithState } from '../../../src/analyze/hydration.ts';
import { diagnose } from '../../../src/diagnose/index.ts';
import { DEFAULT_NORMALIZE } from '../../../src/dom/normalize.ts';
import { bodyTokens, describeDifferences } from '../../../src/engine/navigation.ts';
import type { Issue } from '../../../src/report/model.ts';
import { discoverNextRoutes } from '../../../src/routes/next.ts';
import type { RootInfo } from '../../../src/shared/protocol.ts';
import { comment, doc, el, text } from '../../helpers/tree.ts';

const root = (id: number, prefix?: string): RootInfo => ({
  id,
  rendererId: 1,
  container: id * 10,
  containerSelector: `#root${id}`,
  mode: 'hydrate',
  pendingBoundaries: 0,
  ...(prefix ? { identifierPrefix: prefix } : {}),
});

describe('duplicate ids', () => {
  const tree = doc([
    el('html', {}, [
      el('body', {}, [
        el('div', { id: 'root1' }, [el('label', { for: '_R_1_' }), el('input', { id: '_R_1_' }), el('p', { id: 'x' })]),
        el('div', { id: 'root2' }, [el('input', { id: '_R_1_' }), el('p', { id: 'x' }), el('template', {}, [])]),
        el('p', { id: 'once' }),
      ]),
    ]),
  ]);

  it('reports useId collisions between unprefixed roots and plain duplicates', () => {
    const drafts = analyzeDuplicateIds(tree, [root(1), root(2)], DEFAULT_NORMALIZE);
    expect(drafts.map((draft) => [draft.code, draft.selector, draft.key])).toEqual([
      ['HP3004', '#_R_1_', '_R_1_'],
      ['HP3003', '#x', 'x'],
    ]);
    expect(drafts[0]!.message).toContain('2 React roots');
  });

  it('treats useId duplicates as plain duplicates when roots have a prefix', () => {
    const drafts = analyzeDuplicateIds(tree, [root(1), root(2, 'b-')], DEFAULT_NORMALIZE);
    expect(drafts.map((draft) => draft.code)).toEqual(['HP3003', 'HP3003']);
    expect(USE_ID_PATTERN.test(':R5:')).toBe(true);
    expect(USE_ID_PATTERN.test('«r1»')).toBe(true);
    expect(USE_ID_PATTERN.test('main')).toBe(false);
  });

  it('escapes ids that are not valid CSS identifiers', () => {
    const odd = doc([el('p', { id: ':R1:' }), el('p', { id: ':R1:' })]);
    expect(analyzeDuplicateIds(odd, [root(1), root(2)], DEFAULT_NORMALIZE)[0]!.selector).toBe('#\\3a R1\\3a ');
  });
});

describe('head changes', () => {
  const head = (children: ReturnType<typeof el>[]) => doc([el('html', {}, [el('head', {}, children), el('body')])]);

  it('reports titles and meta values hydration added, and removed stylesheets', () => {
    const before = head([
      el('title', {}, [text('Site')]),
      el('meta', { name: 'description', content: 'Server' }),
      el('meta', { property: 'og:title', content: 'Same' }),
      el('link', { rel: 'stylesheet', href: '/a.css' }),
    ]);
    const after = head([
      el('title', {}, [text('Site')]),
      el('title', {}, [text('Client')]),
      el('meta', { name: 'description', content: 'Server' }),
      el('meta', { name: 'description', content: 'Client' }),
      el('meta', { property: 'og:title', content: 'Same' }),
    ]);
    const drafts = analyzeHead(before, after, DEFAULT_NORMALIZE);
    expect(drafts.map((draft) => [draft.code, draft.selector, draft.server, draft.client])).toEqual([
      ['HP1014', 'head > title', 'Site', 'Client'],
      ['HP1014', 'head > meta[name="description"]', 'Server', 'Client'],
      ['HP1014', 'head > link[href="/a.css"]', '/a.css', null],
    ]);
    expect(drafts[0]!.message).toContain('2 <title> elements');
  });

  it('stays quiet when the head did not change', () => {
    const same = head([el('title', {}, [text('Site')]), el('meta', { name: 'description', content: 'x' })]);
    expect(analyzeHead(same, same, DEFAULT_NORMALIZE)).toEqual([]);
  });
});

describe('form state', () => {
  it('finds forms the server rendered with Server Action state', () => {
    const form = el('form', {}, [el('p', {}, [text('Saved')])], 50);
    const plain = el('form', {}, [], 60);
    const tree = doc([el('body', {}, [comment('F!'), text('\n'), form, comment('F'), plain])]);
    expect([...formsWithState(tree)]).toEqual([50]);
  });

  it('names the form-state cause', () => {
    const issue: Issue = {
      fingerprint: 'f',
      code: 'HP1001',
      title: 't',
      severity: 'error',
      confidence: 1,
      message: 'm',
      route: { url: 'http://x.test/', pattern: '/' },
      scenario: 'default',
      stage: 'hydration',
      evidence: [{ kind: 'note', message: 'The element is inside a form that the server rendered with Server Action state (<!--F!--> marker).' }],
      suggestions: [],
      docsUrl: '',
      server: 'Saved',
      client: '',
    };
    expect(diagnose(issue, { scenario: {}, server: {} }).cause?.id).toBe('form-state');
  });
});

describe('navigation comparison', () => {
  it('compares visible structure with digits masked', () => {
    const direct = doc([
      el('html', {}, [el('body', {}, [el('main', { class: 'b a' }, [text('Visited 3 times')]), el('script', {}, [text('x()')]), el('div', { hidden: '' }, [text('meta')])])]),
    ]);
    const client = doc([el('html', {}, [el('body', {}, [el('main', { class: 'a b' }, [text('Visited 4 times')]), el('p', { id: 'extra' }, [text('New')])])])]);
    const a = bodyTokens(direct, DEFAULT_NORMALIZE);
    expect(a).toEqual(['<main.a.b>', 'Visited # times', '</main>']);
    const b = bodyTokens(client, DEFAULT_NORMALIZE);
    expect(describeDifferences(a, b)).toEqual(['Only after navigation: <p#extra> New </p>']);
    expect(describeDifferences(['<h1>', 'A', '</h1>'], ['<h1>', 'B', '</h1>'])).toEqual(['Direct load: A / after navigation: B']);
    expect(describeDifferences(a, a)).toEqual([]);
  });
});

describe('Next.js route flags', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('marks routes with parallel slots and routes that can be intercepted', () => {
    dir = mkdtempSync(join(tmpdir(), 'hp-flags-'));
    const files = [
      'app/page.jsx',
      'app/dashboard/layout.jsx',
      'app/dashboard/page.jsx',
      'app/dashboard/@stats/page.jsx',
      'app/dashboard/@stats/default.jsx',
      'app/dashboard/settings/page.jsx',
      'app/feed/page.jsx',
      'app/feed/@modal/(..)photo/[id]/page.jsx',
      'app/photo/[id]/page.jsx',
      'app/shop/(.)cart/page.jsx',
      'app/shop/page.jsx',
      'app/cart/page.jsx',
      'app/(...)login/page.jsx',
      'app/login/page.jsx',
    ];
    for (const file of files) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), 'export default function Page() { return null; }');
    }
    const routes = Object.fromEntries(discoverNextRoutes(dir).map((route) => [route.pattern, { parallel: route.parallel ?? false, intercepted: route.intercepted ?? false }]));
    expect(routes).toEqual({
      '/': { parallel: false, intercepted: false },
      '/cart': { parallel: false, intercepted: false },
      '/dashboard': { parallel: true, intercepted: false },
      '/dashboard/settings': { parallel: true, intercepted: false },
      '/feed': { parallel: true, intercepted: false },
      '/login': { parallel: false, intercepted: true },
      '/photo/[id]': { parallel: false, intercepted: true },
      '/shop': { parallel: false, intercepted: false },
    });
  });
});
