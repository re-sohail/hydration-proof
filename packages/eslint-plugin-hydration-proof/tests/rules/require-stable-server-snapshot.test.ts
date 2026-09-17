import { requireStableServerSnapshot as rule } from '../../src/rules/require-stable-server-snapshot.ts';
import { jsxTester, nextApp, tsx, tsxTester } from '../helpers.ts';

const missing = { messageId: 'missingServerSnapshot' };
const unstable = (read: string) => ({ messageId: 'unstableServerSnapshot', data: { read } });

jsxTester.run('require-stable-server-snapshot', rule, {
  valid: [
    'function S() { return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot) }',
    'function S() { return useSyncExternalStore(subscribe, () => store.get(), () => initial) }',
    'function getServerSnapshot() { return null } function S() { return useSyncExternalStore(sub, get, getServerSnapshot) }',
    'const getServer = () => false; function S() { return useSyncExternalStore(sub, () => matchMedia(q).matches, getServer) }',
    'const getServer = function () { return store.initial }; function S() { return useSyncExternalStore(sub, get, getServer) }',
    'function S() { return useSyncExternalStore(...args) }',
    'function S() { return useSyncExternalStore(sub, get, () => { const later = () => Date.now(); return 0 }) }',
    'function S() { return useSyncExternalStore(sub, get, () => typeof value === "string") }',
    'function S() { return useSyncExternalStore(sub, get, ({ window }) => window.innerWidth) }',
    'function S() { return useStore(subscribe, getSnapshot) }',
    // Server Components never hydrate (and cannot use hooks).
    nextApp('app/page.jsx', { code: 'export default function Page() { return useSyncExternalStore(subscribe, getSnapshot) }' }),
  ],
  invalid: [
    { code: 'function S() { return useSyncExternalStore(subscribe, getSnapshot) }', errors: [missing] },
    { code: 'function S() { return React.useSyncExternalStore(subscribe, getSnapshot, undefined) }', errors: [missing] },
    {
      code: "import { useSyncExternalStore } from 'use-sync-external-store/shim'; function useOnline() { return useSyncExternalStore(subscribe, () => navigator.onLine) }",
      errors: [missing],
    },
    { code: 'function S() { return useSyncExternalStore(sub, get, () => navigator.onLine) }', errors: [unstable('navigator')] },
    { code: 'function S() { return useSyncExternalStore(sub, get, () => window.matchMedia("(x)").matches) }', errors: [unstable('window.matchMedia')] },
    { code: 'function S() { return useSyncExternalStore(sub, get, () => localStorage.getItem("k")) }', errors: [unstable('localStorage')] },
    {
      code: 'function getSnapshot() { return window.innerWidth } function S() { return useSyncExternalStore(sub, getSnapshot, getSnapshot) }',
      errors: [unstable('window.innerWidth')],
    },
    { code: 'const getServerSnapshot = () => Date.now(); function S() { return useSyncExternalStore(sub, get, getServerSnapshot) }', errors: [unstable('Date.now()')] },
    { code: 'function S() { return useSyncExternalStore(sub, get, function () { return Math.random() > 0.5 }) }', errors: [unstable('Math.random()')] },
    { code: 'function S() { return useSyncExternalStore(sub, get, () => new Date().getDay()) }', errors: [unstable('new Date()')] },
    {
      code: 'function S() { return useSyncExternalStore(sub, get, () => typeof window !== "undefined") }',
      errors: [unstable('typeof window !== "undefined"')],
    },
    {
      code: 'function S() { return useSyncExternalStore(sub, get, () => (typeof window === "undefined" ? 0 : window.innerWidth)) }',
      errors: [unstable('typeof window === "undefined"'), unstable('window.innerWidth')],
    },
    {
      code: 'const read = () => document.title; function A() { return useSyncExternalStore(s, read, read) } function B() { return useSyncExternalStore(s, read, read) }',
      errors: [unstable('document')],
    },
    nextApp('app/page.jsx', {
      code: "'use client';\nexport default function Page() { return useSyncExternalStore(subscribe, getSnapshot) }",
      errors: [missing],
    }),
  ],
});

tsxTester.run('require-stable-server-snapshot (TypeScript)', rule, {
  valid: [tsx({ code: 'const useOnline = (): boolean => useSyncExternalStore<boolean>(subscribe, getSnapshot, (): boolean => true);' })],
  invalid: [
    tsx({ code: 'const useOnline = (): boolean => useSyncExternalStore<boolean>(subscribe, getSnapshot);', errors: [missing] }),
    tsx({
      code: 'const useWidth = (): number => useSyncExternalStore(subscribe, getSnapshot, (() => (window as Window).innerWidth) as () => number);',
      errors: [unstable('(window as Window).innerWidth')],
    }),
  ],
});
