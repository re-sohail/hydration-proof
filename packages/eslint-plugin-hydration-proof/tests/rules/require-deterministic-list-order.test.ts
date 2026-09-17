import { requireDeterministicListOrder as rule } from '../../src/rules/require-deterministic-list-order.ts';
import { jsxTester, nextApp, tsx, tsxTester } from '../helpers.ts';

const component = (body: string) => `function List({ items, names }) { ${body} }`;
const random = (source: string) => ({ messageId: 'randomComparator', data: { source } });
const shuffle = (helper: string) => ({ messageId: 'shuffleHelper', data: { helper } });
const locale = (call: string, output: string, value = 'en-US') => ({
  messageId: 'localeComparator',
  data: { call },
  suggestions: [{ messageId: 'addLocale', data: { locale: value }, output }],
});
const booleanComparator = (output?: string) => ({
  messageId: 'booleanComparator',
  suggestions: output ? [{ messageId: 'threeWay', output }] : [],
});

jsxTester.run('require-deterministic-list-order', rule, {
  valid: [
    component('return items.toSorted().map((i) => <p key={i}>{i}</p>)'),
    component('return [...items].sort((a, b) => a.rank - b.rank)'),
    component("return names.sort((a, b) => a.name.localeCompare(b.name, 'en'))"),
    component('return names.sort(new Intl.Collator("en").compare)'),
    component('return items.sort(compare)'),
    component('return items.filter((a) => a > 1)'),
    component('return items.sort((a, b) => { if (a > b) return 1; return -1 })'),
    component('return items.sort((a, b) => (a > b ? 1 : a < b ? -1 : 0))'),
    component('useEffect(() => { setItems([...items].sort(() => Math.random() - 0.5)) }, []); return null'),
    component('const onShuffle = () => setItems([...items].sort(() => Math.random() - 0.5)); return null'),
    component('const shuffle = (x) => x; return <p>{shuffle(items)}</p>'),
    "import { shuffle } from 'lodash'; export function helper(items) { return shuffle(items) }",
    "import { sortBy } from 'lodash'; function List({ items }) { return sortBy(items, 'name') }",
    // An id built with a random comparator belongs to no-unstable-id.
    component('return <p id={String(items.sort(() => Math.random())[0])} />'),
    nextApp('app/page.jsx', { code: 'export default function Page({ items }) { return [...items].sort(() => Math.random() - 0.5) }' }),
  ],
  invalid: [
    { code: component('return [...items].sort(() => Math.random() - 0.5).map((i) => <p key={i}>{i}</p>)'), errors: [random('Math.random()')] },
    {
      code: component('return items.toSorted(() => (crypto.getRandomValues(new Uint8Array(1))[0] > 127 ? 1 : -1))'),
      errors: [random('crypto.getRandomValues()')],
    },
    { code: component('const sorted = useMemo(() => items.sort(function () { return 0.5 - Math.random() }), [items]); return sorted'), errors: [random('Math.random()')] },
    { code: "import { shuffle } from 'lodash'; " + component('return shuffle(items).map((i) => <p key={i}>{i}</p>)'), errors: [shuffle('shuffle')] },
    { code: "import _ from 'lodash-es'; " + component('return _.sampleSize(items, 3)'), errors: [shuffle('sampleSize')] },
    { code: "import shuffleList from 'lodash/shuffle'; " + component('return shuffleList(items)'), errors: [shuffle('shuffle')] },
    { code: "import * as _ from 'lodash'; function useShuffled(items) { return useMemo(() => _.shuffle(items), [items]) }", errors: [shuffle('shuffle')] },
    {
      code: component('return names.sort((a, b) => a.localeCompare(b))'),
      errors: [locale('a.localeCompare(b)', component("return names.sort((a, b) => a.localeCompare(b, 'en-US'))"))],
    },
    {
      code: component('return names.toSorted(function (a, b) { return a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) })'),
      errors: [
        locale(
          'a.name.localeCompare(b.name, undefined, { sensitivity: "b...',
          component('return names.toSorted(function (a, b) { return a.name.localeCompare(b.name, \'en-US\', { sensitivity: "base" }) })'),
        ),
      ],
    },
    {
      code: component('return names.sort((a, b) => a.localeCompare(b))'),
      options: [{ defaultLocale: 'fr' }],
      errors: [locale('a.localeCompare(b)', component("return names.sort((a, b) => a.localeCompare(b, 'fr'))"), 'fr')],
    },
    {
      code: component('return items.sort((a, b) => a > b)'),
      errors: [booleanComparator(component('return items.sort((a, b) => (a > b ? 1 : a < b ? -1 : 0))'))],
    },
    {
      code: component('return items.toSorted((a, b) => a.date <= b.date)'),
      errors: [booleanComparator(component('return items.toSorted((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))'))],
    },
    { code: component('return items.sort((a, b) => score(a) > score(b))'), errors: [booleanComparator()] },
    { code: component('return items.sort((a, b) => { return a.x > b.x })'), errors: [booleanComparator()] },
    { code: component('return items.sort((a, b) => a.pinned === b.pinned)'), errors: [booleanComparator()] },
    nextApp('app/page.jsx', {
      code: "'use client';\nexport default function Page({ items }) { return [...items].sort(() => Math.random() - 0.5) }",
      errors: [random('Math.random()')],
    }),
  ],
});

tsxTester.run('require-deterministic-list-order (TypeScript)', rule, {
  valid: [tsx({ code: 'const List: FC<{ items: Item[] }> = ({ items }) => <>{[...items].sort((a: Item, b: Item): number => a.n - b.n).length}</>;' })],
  invalid: [
    tsx({
      code: 'const List: FC<{ items: Item[] }> = ({ items }) => <>{[...items].sort((a: Item, b: Item): number => Math.random() - 0.5).length}</>;',
      errors: [random('Math.random()')],
    }),
    tsx({
      code: 'function List({ names }: { names: string[] }) { return <>{names.toSorted((a, b) => (a as string).localeCompare(b))}</>; }',
      errors: [
        locale(
          '(a as string).localeCompare(b)',
          "function List({ names }: { names: string[] }) { return <>{names.toSorted((a, b) => (a as string).localeCompare(b, 'en-US'))}</>; }",
        ),
      ],
    }),
  ],
});
