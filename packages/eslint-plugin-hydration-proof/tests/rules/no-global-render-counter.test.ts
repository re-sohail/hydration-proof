import { noGlobalRenderCounter as rule } from '../../src/rules/no-global-render-counter.ts';
import { jsxTester, nextApp, tsx, tsxTester } from '../helpers.ts';

const error = (name: string) => ({ messageId: 'moduleWrite', data: { name } });

jsxTester.run('no-global-render-counter', rule, {
  valid: [
    'let count = 0; function Counter() { useEffect(() => { count++ }); return null }',
    'let count = 0; function Counter() { return <button onClick={() => { count += 1 }}>+</button> }',
    'let count = 0; export function increment() { count++ }',
    'let count = 0; count++; function Counter() { return <p>{count}</p> }',
    'function Counter() { let count = 0; count++; return <p>{count}</p> }',
    'const cache = new Map(); function Counter() { cache.set("a", 1); return null }',
    'let config = {}; function Counter() { config.seen = true; return null }',
    'let renders = 0; function Counter() { return <p>{renders}</p> }',
    'function Counter() { var local = 0; local += 1; return null }',
    // Deliberate caches can be allowed by name.
    { code: 'let cache; function useData() { cache ??= load(); return cache }', options: [{ allow: ['cache'] }] },
    // Ids built from a counter belong to no-unstable-id.
    'let nextId = 0; function Field() { return <input id={`f${nextId++}`} /> }',
    nextApp('app/page.jsx', { code: 'let renders = 0; export default function Page() { renders++; return <p>{renders}</p> }' }),
  ],
  invalid: [
    { code: 'let renders = 0; function Counter() { renders++; return <p>{renders}</p> }', errors: [error('renders')] },
    { code: 'var total = 0; const Counter = () => { total += 1; return null }', errors: [error('total')] },
    { code: 'let last; function Counter({ value }) { last = value; return null }', errors: [error('last')] },
    { code: 'let a, b; function Counter() { [a, b] = [1, 2]; return null }', errors: [error('a'), error('b')] },
    { code: 'let calls = 0; function useCounter() { return ++calls }', errors: [error('calls')] },
    { code: 'let count = 0; function Counter() { const [s] = useState(() => count++); return <p>{s}</p> }', errors: [error('count')] },
    { code: 'let count = 0; function Counter() { const v = useMemo(() => (count -= 1), []); return v }', errors: [error('count')] },
    { code: 'export let count = 0; class Counter extends Component { render() { count--; return null } }', errors: [error('count')] },
    { code: 'let cache; function useData() { cache ??= load(); return cache }', errors: [error('cache')] },
    { code: 'let seen = 0; function List({ items }) { return items.map((i) => { seen++; return <p key={i}>{i}</p> }) }', errors: [error('seen')] },
    { code: 'let x = 0, y = 0; function Counter() { ({ x, y } = read()); return null }', errors: [error('x'), error('y')] },
    { code: 'let renders = 0; function Counter() { renders++; return null }', options: [{ allow: ['other'] }], errors: [error('renders')] },
    {
      code: 'let counter = 0; function Tick() { counter++; return null } function Field() { return <input id={`f-${counter}`} /> }',
      errors: [error('counter')],
    },
    { code: 'let counter = 0; function Field() { const total = counter; counter = total + 1; return <p>{total}</p> }', errors: [error('counter')] },
    nextApp('app/page.jsx', {
      code: "'use client';\nlet renders = 0; export default function Page() { renders++; return <p>{renders}</p> }",
      errors: [error('renders')],
    }),
  ],
});

tsxTester.run('no-global-render-counter (TypeScript)', rule, {
  valid: [tsx({ code: 'let count: number = 0; const Counter: FC = () => { useEffect(() => { count++; }, []); return null; };' })],
  invalid: [
    tsx({ code: 'let count: number = 0; const Counter: FC = () => { count++; return null; };', errors: [error('count')] }),
    tsx({ code: 'let last: string | undefined; function Counter<T extends string>({ v }: { v: T }) { last = v as string; return null; }', errors: [error('last')] }),
  ],
});
