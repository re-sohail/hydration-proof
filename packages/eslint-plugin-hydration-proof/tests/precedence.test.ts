import { Linter } from 'eslint';
import * as tsParser from '@typescript-eslint/parser';
import { describe, expect, it } from 'vitest';
import plugin from '../src/index.ts';

// Every construct must be reported by exactly one rule. Each case is one
// component on its own line, so the reports on a line belong to that case.
const CASES: [name: string, body: string, rules: string[]][] = [
  ['clock', 'return <p>{Date.now()}</p>', ['no-date-in-render']],
  ['random', 'return <p>{Math.random()}</p>', ['no-random-in-render']],
  ['browser global', 'return <p>{window.innerWidth}</p>', ['no-browser-global-in-render']],
  ['storage', "return <p>{localStorage.getItem('x')}</p>", ['no-storage-in-initial-render']],
  ['storage through window', 'return window.localStorage', ['no-storage-in-initial-render']],
  ['matchMedia', "return <p>{String(matchMedia('(x)').matches)}</p>", ['no-match-media-in-render']],
  ['locale', 'return <p>{n.toLocaleString()}</p>', ['no-locale-without-explicit-locale']],
  ['time zone', "return <p>{d.toLocaleDateString('en-US')}</p>", ['no-timezone-without-explicit-timezone']],
  ['Date receiver time zone', "return <p>{new Date(d).toLocaleString('en-US')}</p>", ['no-timezone-without-explicit-timezone']],
  ['runtime time zone', 'return Intl.DateTimeFormat().resolvedOptions().timeZone', ['no-timezone-without-explicit-timezone']],
  ['unstable id', 'return <input id={String(Math.random())} />', ['no-unstable-id']],
  ['module counter', 'counter++; return null', ['no-global-render-counter']],
  ['environment branch', "return typeof window === 'undefined' ? null : <p />", ['no-window-render-branch']],
  ['invalid nesting', 'return <p><div /></p>', ['no-invalid-interactive-nesting']],
  ['static suppressHydrationWarning', 'return <p suppressHydrationWarning>static</p>', ['audit-suppress-hydration-warning']],
  ['suppressHydrationWarning audit', 'return <time suppressHydrationWarning>{d}</time>', ['audit-suppress-hydration-warning']],
  ['client-only state', 'const [w] = useState(window.innerWidth); return w', ['no-client-only-initial-state']],
  ['missing server snapshot', 'return useSyncExternalStore(subscribe, getSnapshot)', ['require-stable-server-snapshot']],
  ['random order', 'return [...items].sort(() => Math.random() - 0.5)', ['require-deterministic-list-order']],

  // Precedence between rules.
  ['clock in id', 'return <input id={`f-${Date.now()}`} />', ['no-unstable-id']],
  ['counter in id', 'return <input id={`f-${counter++}`} />', ['no-unstable-id']],
  ['random id in state', 'const [id] = useState(() => crypto.randomUUID()); return <input id={id} />', ['no-unstable-id']],
  ['random comparator in id', 'return <p id={String(items.sort(() => Math.random())[0])} />', ['no-unstable-id']],
  ['guarded read', "return typeof window !== 'undefined' ? <p>{window.innerWidth}</p> : null", ['no-window-render-branch']],
  ['early return guard', "if (typeof window === 'undefined') return null; return <p>{document.title}</p>", ['no-window-render-branch']],
  ['guard through a local', "const isClient = typeof window !== 'undefined'; return isClient ? <p>{navigator.language}</p> : null", ['no-window-render-branch']],
  ['flag guard', 'return isBrowser && <p>{document.title}</p>', ['no-window-render-branch']],
  ['guarded storage', "return typeof window !== 'undefined' ? <p>{localStorage.getItem('t')}</p> : null", ['no-storage-in-initial-render']],
  ['guarded matchMedia', "const dark = typeof window !== 'undefined' && window.matchMedia('(x)').matches; return String(dark)", ['no-match-media-in-render']],
  ['typeof matchMedia', "return typeof window.matchMedia === 'function' ? <p /> : null", ['no-window-render-branch']],
  ['guarded state', "const [w] = useState(() => typeof window === 'undefined' ? 0 : window.innerWidth); return w", ['no-client-only-initial-state']],
  ['guarded storage state', "const [t] = useState(() => typeof window !== 'undefined' ? localStorage.getItem('t') : 'light'); return t", ['no-storage-in-initial-render']],
  ['check-only state', "const [c] = useState(typeof window !== 'undefined'); return c", ['no-client-only-initial-state']],
  ['browser read in ref', 'const el = useRef(document.body); return el', ['no-client-only-initial-state']],
  ['localeCompare comparator', 'return items.sort((x, y) => x.localeCompare(y))', ['require-deterministic-list-order']],
  ['localeCompare outside a comparator', 'return <p>{a.localeCompare(b)}</p>', ['no-locale-without-explicit-locale']],
  ['lodash shuffle', 'return shuffle(items)', ['require-deterministic-list-order']],
  ['lodash sample', 'return sample(items)', ['no-random-in-render']],
  ['clock in server snapshot', 'return useSyncExternalStore(subscribe, getSnapshot, () => Date.now())', ['require-stable-server-snapshot']],
  ['browser read in server snapshot', 'return useSyncExternalStore(subscribe, getSnapshot, () => window.innerWidth)', ['require-stable-server-snapshot']],
  ['storage in server snapshot', "return useSyncExternalStore(subscribe, getSnapshot, () => localStorage.getItem('k'))", ['require-stable-server-snapshot']],

  // Two different problems in one expression (documented overlaps).
  ['no locale and no time zone', 'return <p>{d.toLocaleDateString()}</p>', ['no-locale-without-explicit-locale', 'no-timezone-without-explicit-timezone']],
  ['no locale and no time zone (Intl)', 'return Intl.DateTimeFormat().format(d)', ['no-locale-without-explicit-locale', 'no-timezone-without-explicit-timezone']],
  ['clock and local time', 'return <p>{new Date().getHours()}</p>', ['no-date-in-render', 'no-timezone-without-explicit-timezone']],
  ['suppression too deep and clock', 'return <div suppressHydrationWarning><p>{Date.now()}</p></div>', ['audit-suppress-hydration-warning', 'no-date-in-render']],

  // Nothing to report.
  ['typeof alone', 'return <p>{typeof document}</p>', []],
  ['effects', 'useEffect(() => { counter++; setX(Date.now() + Math.random() + window.innerWidth + localStorage.length) }); return null', []],
  ['handlers', "return <button onClick={() => alert(new Date().toLocaleString() + matchMedia('(x)').matches)}>x</button>", []],
  ['stable id', 'const id = useId(); return <input id={id} />', []],
  ['client flag from a hook', 'const isClient = useIsClient(); return isClient ? <p>{Date.UTC(2020, 1)}</p> : null', []],
];

const HEADER = [
  "import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';",
  "import { sample, shuffle } from 'lodash';",
  "import { isBrowser } from './env';",
  'let counter = 0;',
];

function sampleFile(): string {
  const components = CASES.map(([, body], index) => `export function Case${index}({ items, a, b, d, n }) { ${body} }`);
  return [...HEADER, ...components].join('\n');
}

function lint(code: string, config: Linter.Config, filename: string, parser?: Linter.Parser, cwd?: string): Linter.LintMessage[] {
  const linter = new Linter(cwd ? { cwd } : {});
  const base: Linter.Config = { files: ['**/*.jsx', '**/*.tsx'], ...(parser ? { languageOptions: { parser } } : {}) };
  const messages = linter.verify(code, [base, config], filename);
  const fatal = messages.filter((message) => message.fatal);
  if (fatal.length > 0) throw new Error(fatal.map((message) => message.message).join('\n'));
  return messages;
}

function rulesByLine(messages: Linter.LintMessage[]): Map<number, string[]> {
  const byLine = new Map<number, string[]>();
  for (const message of messages) {
    const rule = message.ruleId?.replace('hydration-proof/', '') ?? '(none)';
    byLine.set(message.line, [...new Set([...(byLine.get(message.line) ?? []), rule])].sort());
  }
  return byLine;
}

describe.each([
  ['JavaScript', 'src/Sample.jsx', undefined],
  ['TypeScript', 'src/Sample.tsx', tsParser as Linter.Parser],
])('precedence (%s)', (_label, filename, parser) => {
  const messages = lint(sampleFile(), plugin.configs.strict, filename, parser);
  const byLine = rulesByLine(messages);

  it.each(CASES.map(([name, , rules], index) => [name, index, rules] as const))('%s is reported by the expected rule', (_name, index, rules) => {
    expect(byLine.get(HEADER.length + index + 1) ?? []).toEqual([...rules].sort());
  });

  it('never reports two rules at the same position', () => {
    const byPosition = new Map<string, Set<string>>();
    for (const message of messages) {
      const key = `${message.line}:${message.column}`;
      byPosition.set(key, (byPosition.get(key) ?? new Set()).add(message.ruleId ?? ''));
    }
    const shared = [...byPosition].filter(([, rules]) => rules.size > 1).map(([key, rules]) => `${key} ${[...rules].join(', ')}`);
    expect(shared).toEqual([]);
  });

  it('has no duplicated location and message pairs', () => {
    const keys = messages.map((message) => `${message.line}:${message.column}:${message.endLine}:${message.endColumn}:${message.message}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('reports nothing outside the cases', () => {
    expect(messages.filter((message) => message.line <= HEADER.length)).toEqual([]);
  });
});

describe('presets in use', () => {
  it('uses warn for likely problems in recommended', () => {
    const messages = lint(sampleFile(), plugin.configs.recommended, 'src/Sample.jsx');
    const severity = new Map(messages.map((message) => [message.ruleId, message.severity]));
    expect(severity.get('hydration-proof/no-date-in-render')).toBe(2);
    expect(severity.get('hydration-proof/no-locale-without-explicit-locale')).toBe(1);
    expect(severity.get('hydration-proof/no-timezone-without-explicit-timezone')).toBe(1);
    expect(severity.get('hydration-proof/no-client-only-initial-state')).toBe(1);
    expect(severity.get('hydration-proof/require-deterministic-list-order')).toBe(1);
    // The audit of every suppressHydrationWarning is strict-only.
    expect(messages.some((message) => message.message.includes('hides hydration mismatches'))).toBe(false);
  });

  it('skips Server Components with the next preset and checks client files', () => {
    const page = 'export default function Page() { return <p>{Date.now()}<div /></p> }';
    const server = lint(page, plugin.configs.next, 'app/dashboard/page.jsx').map((message) => message.ruleId);
    expect(server).toEqual(['hydration-proof/no-invalid-interactive-nesting']);
    const client = lint(`'use client';\n${page}`, plugin.configs.next, 'app/dashboard/page.jsx').map((message) => message.ruleId);
    expect(client.sort()).toEqual(['hydration-proof/no-date-in-render', 'hydration-proof/no-invalid-interactive-nesting']);
    const pages = lint(page, plugin.configs.next, 'pages/dashboard.jsx').map((message) => message.ruleId);
    expect(pages.sort()).toEqual(['hydration-proof/no-date-in-render', 'hydration-proof/no-invalid-interactive-nesting']);
    const recommended = lint(page, plugin.configs.recommended, 'app/dashboard/page.jsx').map((message) => message.ruleId);
    expect(recommended.sort()).toEqual(['hydration-proof/no-date-in-render', 'hydration-proof/no-invalid-interactive-nesting']);
  });

  it('only looks at the path inside the project for the app directory', () => {
    const page = 'export default function Page() { return <p>{Date.now()}</p> }';
    const cwd = '/home/app/project';
    expect(lint(page, plugin.configs.next, `${cwd}/src/app/page.jsx`, undefined, cwd)).toEqual([]);
    expect(lint(page, plugin.configs.next, `${cwd}/src/components/page.jsx`, undefined, cwd)).toHaveLength(1);
    expect(lint(page, plugin.configs.next, 'C:\\work\\site\\app\\page.jsx', undefined, 'C:\\work\\site')).toEqual([]);
  });
});
