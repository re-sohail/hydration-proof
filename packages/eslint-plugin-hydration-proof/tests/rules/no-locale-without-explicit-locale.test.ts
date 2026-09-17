import { noLocaleWithoutExplicitLocale as rule } from '../../src/rules/no-locale-without-explicit-locale.ts';
import { jsxTester, nextApp, tsx, tsxTester } from '../helpers.ts';

/** An error whose single suggestion turns the code into `output`. */
const error = (call: string, output: string, locale = 'en-US') => ({
  messageId: 'missingLocale',
  data: { call },
  suggestions: [{ messageId: 'addLocale', data: { locale }, output }],
});

const component = (body: string) => `function Price({ n, d, a, b, items }) { ${body} }`;

jsxTester.run('no-locale-without-explicit-locale', rule, {
  valid: [
    component("return <p>{n.toLocaleString('en-US')}</p>"),
    component("return <p>{n.toLocaleString(['de-DE'])}</p>"),
    'function Price({ n, locale }) { return <p>{n.toLocaleString(locale)}</p> }',
    component("return <p>{d.toLocaleDateString('en-GB', { month: 'long' })}</p>"),
    component("return <p>{a.localeCompare(b, 'en')}</p>"),
    component("const f = new Intl.NumberFormat('en-US'); return <p>{f.format(n)}</p>"),
    component("return <p>{Intl.PluralRules('en').select(n)}</p>"),
    component('return <p>{n.toLocaleString(...args)}</p>'),
    component('return <p>{String(n)}</p>'),
    component('useEffect(() => { console.log(n.toLocaleString()) }); return null'),
    component('return <button onClick={() => alert(n.toLocaleString())}>Show</button>'),
    'const fmt = new Intl.NumberFormat(); export function format(n) { return fmt.format(n) }',
    'function Intl() {} function Price({ n }) { return <p>{new Intl.NumberFormat().format(n)}</p> }',
    // Sort comparators belong to require-deterministic-list-order.
    component('return <ul>{items.sort((x, y) => x.localeCompare(y)).map((i) => <li key={i}>{i}</li>)}</ul>'),
    // Time zone reads belong to no-timezone-without-explicit-timezone.
    component('const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; return <p>{tz}</p>'),
    nextApp('app/page.jsx', { code: 'export default function Page({ n }) { return <p>{n.toLocaleString()}</p> }' }),
  ],
  invalid: [
    {
      code: component('return <p>{n.toLocaleString()}</p>'),
      errors: [error('n.toLocaleString()', component("return <p>{n.toLocaleString('en-US')}</p>"))],
    },
    {
      code: component("return <p>{d.toLocaleDateString(undefined, { month: 'long' })}</p>"),
      errors: [
        error("d.toLocaleDateString(undefined, { month: 'long' })", component("return <p>{d.toLocaleDateString('en-US', { month: 'long' })}</p>")),
      ],
    },
    {
      code: component("return <p>{d.toLocaleTimeString([], { hour: '2-digit' })}</p>"),
      errors: [error("d.toLocaleTimeString([], { hour: '2-digit' })", component("return <p>{d.toLocaleTimeString('en-US', { hour: '2-digit' })}</p>"))],
    },
    {
      code: component('return <p>{a.localeCompare(b)}</p>'),
      errors: [error('a.localeCompare(b)', component("return <p>{a.localeCompare(b, 'en-US')}</p>"))],
    },
    {
      code: component('return <p>{a.localeCompare(b, void 0, { numeric: true })}</p>'),
      errors: [error('a.localeCompare(b, void 0, { numeric: true })', component("return <p>{a.localeCompare(b, 'en-US', { numeric: true })}</p>"))],
    },
    {
      code: component('const f = new Intl.NumberFormat(); return <p>{f.format(n)}</p>'),
      errors: [error('new Intl.NumberFormat()', component("const f = new Intl.NumberFormat('en-US'); return <p>{f.format(n)}</p>"))],
    },
    {
      code: component('const f = new Intl.NumberFormat; return <p>{f.format(n)}</p>'),
      errors: [error('new Intl.NumberFormat', component("const f = new Intl.NumberFormat('en-US'); return <p>{f.format(n)}</p>"))],
    },
    {
      code: component("return <p>{Intl.NumberFormat(undefined, { style: 'percent' }).format(n)}</p>"),
      errors: [
        error(
          "Intl.NumberFormat(undefined, { style: 'percent' })",
          component("return <p>{Intl.NumberFormat('en-US', { style: 'percent' }).format(n)}</p>"),
        ),
      ],
    },
    {
      code: component('return <p>{new Intl.RelativeTimeFormat().format(-1, "day")}{new Intl.PluralRules().select(n)}</p>'),
      errors: [
        error('new Intl.RelativeTimeFormat()', component('return <p>{new Intl.RelativeTimeFormat(\'en-US\').format(-1, "day")}{new Intl.PluralRules().select(n)}</p>')),
        error('new Intl.PluralRules()', component('return <p>{new Intl.RelativeTimeFormat().format(-1, "day")}{new Intl.PluralRules(\'en-US\').select(n)}</p>')),
      ],
    },
    {
      code: component('return <p>{new Intl.ListFormat(undefined, { type: "conjunction" }).format(items)}</p>'),
      errors: [
        error(
          'new Intl.ListFormat(undefined, { type: "conjunction" })',
          component('return <p>{new Intl.ListFormat(\'en-US\', { type: "conjunction" }).format(items)}</p>'),
        ),
      ],
    },
    {
      code: component('const names = new window.Intl.DisplayNames([], { type: "region" }); return <p>{names.of("PK")}</p>'),
      errors: [
        error(
          'new window.Intl.DisplayNames([], { type: "region" })',
          component('const names = new window.Intl.DisplayNames(\'en-US\', { type: "region" }); return <p>{names.of("PK")}</p>'),
        ),
      ],
    },
    {
      code: component('const c = new Intl.Collator(); return <p>{c.compare(a, b)}</p>'),
      options: [{ defaultLocale: 'de-DE' }],
      errors: [error('new Intl.Collator()', component("const c = new Intl.Collator('de-DE'); return <p>{c.compare(a, b)}</p>"), 'de-DE')],
    },
    {
      code: component('return <p>{n?.toLocaleString()}</p>'),
      errors: [error('n?.toLocaleString()', component("return <p>{n?.toLocaleString('en-US')}</p>"))],
    },
    {
      code: 'function List({ items }) { return items.map((i) => <p key={i.id}>{i.price.toLocaleString()}</p>) }',
      errors: [error('i.price.toLocaleString()', "function List({ items }) { return items.map((i) => <p key={i.id}>{i.price.toLocaleString('en-US')}</p>) }")],
    },
    {
      code: 'function useLabel(n) { return useMemo(() => n.toLocaleString(), [n]) }',
      errors: [error('n.toLocaleString()', "function useLabel(n) { return useMemo(() => n.toLocaleString('en-US'), [n]) }")],
    },
    {
      code: component('return <p>{new Date(d).toLocaleDateString()}</p>'),
      errors: [error('new Date(d).toLocaleDateString()', component("return <p>{new Date(d).toLocaleDateString('en-US')}</p>"))],
    },
    {
      code: component('const lang = new Intl.NumberFormat().resolvedOptions().locale; return <p>{lang}</p>'),
      errors: [{ messageId: 'runtimeLocale', data: { call: 'new Intl.NumberFormat().resolvedOptions()' }, suggestions: [] }],
    },
    nextApp('app/page.jsx', {
      code: "'use client';\nexport default function Page({ n }) { return <p>{n.toLocaleString()}</p> }",
      errors: [error('n.toLocaleString()', "'use client';\nexport default function Page({ n }) { return <p>{n.toLocaleString('en-US')}</p> }")],
    }),
  ],
});

tsxTester.run('no-locale-without-explicit-locale (TypeScript)', rule, {
  valid: [tsx({ code: "const P: FC<{ n: number }> = ({ n }) => <p>{n.toLocaleString('en-US' as const)}</p>;" })],
  invalid: [
    tsx({
      code: 'const P: FC<{ n: number }> = ({ n }) => <p>{(n as number).toLocaleString()}</p>;',
      errors: [error('(n as number).toLocaleString()', "const P: FC<{ n: number }> = ({ n }) => <p>{(n as number).toLocaleString('en-US')}</p>;")],
    }),
    tsx({
      code: 'function usePercent(n: number): string { return new Intl.NumberFormat(undefined, { style: "percent" } satisfies Intl.NumberFormatOptions).format(n); }',
      errors: [
        error(
          'new Intl.NumberFormat(undefined, { style: "percent" } sat...',
          'function usePercent(n: number): string { return new Intl.NumberFormat(\'en-US\', { style: "percent" } satisfies Intl.NumberFormatOptions).format(n); }',
        ),
      ],
    }),
  ],
});
