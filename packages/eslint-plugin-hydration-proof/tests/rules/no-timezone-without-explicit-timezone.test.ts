import { noTimezoneWithoutExplicitTimezone as rule } from '../../src/rules/no-timezone-without-explicit-timezone.ts';
import { jsxTester, nextApp, tsx, tsxTester } from '../helpers.ts';

const missing = (call: string, output: string, timeZone = 'UTC') => ({
  messageId: 'missingTimeZone',
  data: { call },
  suggestions: [{ messageId: 'addTimeZone', data: { timeZone }, output }],
});
const localTime = (call: string, suggestion?: { method: string; output: string }) => ({
  messageId: 'localTime',
  data: { call },
  suggestions: suggestion ? [{ messageId: 'useUtc', data: { method: suggestion.method }, output: suggestion.output }] : [],
});

const component = (body: string) => `function When({ d, ts, n, opts }) { ${body} }`;

jsxTester.run('no-timezone-without-explicit-timezone', rule, {
  valid: [
    component("return <p>{d.toLocaleDateString('en-US', { timeZone: 'UTC' })}</p>"),
    component("return <p>{d.toLocaleTimeString('en-US', { 'timeZone': 'Asia/Karachi', hour: 'numeric' })}</p>"),
    component("return <p>{d.toLocaleDateString('en-US', opts)}</p>"),
    component("return <p>{d.toLocaleDateString('en-US', { ...opts })}</p>"),
    component("return <p>{d.toLocaleDateString(...opts)}</p>"),
    component("return <p>{n.toLocaleString('en-US')}</p>"),
    component("return <p>{n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}</p>"),
    component("const f = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi' }); return <p>{f.format(d)}</p>"),
    component("const f = new Intl.NumberFormat('en-US'); return <p>{f.format(n)}</p>"),
    component('return <p>{d.getHours()}</p>'),
    component('return <p>{new Date(ts).getUTCHours()}</p>'),
    component('return <p>{new Date(ts).toISOString()}</p>'),
    component('return <p>{new Date(ts).getTime()}</p>'),
    component("useEffect(() => { setLabel(new Date(ts).toLocaleDateString()) }); return null"),
    component("return <button onClick={() => alert(d.toLocaleTimeString('en-US'))}>When</button>"),
    'const start = new Date(0); function When() { return <p>{start.getHours()}</p> }',
    component("const tz = Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).resolvedOptions().timeZone; return <p>{tz}</p>"),
    component('const { locale } = Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).resolvedOptions(); return <p>{locale}</p>'),
    'export function format(d) { return d.toLocaleDateString("en-US") }',
    nextApp('app/page.jsx', { code: "export default function Page({ d }) { return <p>{d.toLocaleDateString('en-US')}</p> }" }),
  ],
  invalid: [
    {
      code: component("return <p>{d.toLocaleDateString('en-US')}</p>"),
      errors: [missing("d.toLocaleDateString('en-US')", component("return <p>{d.toLocaleDateString('en-US', { timeZone: 'UTC' })}</p>"))],
    },
    {
      code: component("return <p>{d.toLocaleTimeString('en-US', { hour: 'numeric' })}</p>"),
      errors: [
        missing(
          "d.toLocaleTimeString('en-US', { hour: 'numeric' })",
          component("return <p>{d.toLocaleTimeString('en-US', { timeZone: 'UTC', hour: 'numeric' })}</p>"),
        ),
      ],
    },
    {
      code: component("return <p>{d.toLocaleDateString('en-US', {})}</p>"),
      errors: [missing("d.toLocaleDateString('en-US', {})", component("return <p>{d.toLocaleDateString('en-US', { timeZone: 'UTC' })}</p>"))],
    },
    {
      code: component('return <p>{d.toLocaleDateString()}</p>'),
      errors: [missing('d.toLocaleDateString()', component("return <p>{d.toLocaleDateString(undefined, { timeZone: 'UTC' })}</p>"))],
    },
    {
      code: component("return <p>{d.toLocaleDateString('en-US', undefined)}</p>"),
      errors: [missing("d.toLocaleDateString('en-US', undefined)", component("return <p>{d.toLocaleDateString('en-US', { timeZone: 'UTC' })}</p>"))],
    },
    {
      code: component("return <p>{new Date(ts).toLocaleString('en-US')}</p>"),
      errors: [missing("new Date(ts).toLocaleString('en-US')", component("return <p>{new Date(ts).toLocaleString('en-US', { timeZone: 'UTC' })}</p>"))],
    },
    {
      code: component("return <p>{n.toLocaleString('en-US', { dateStyle: 'short' })}</p>"),
      errors: [
        missing("n.toLocaleString('en-US', { dateStyle: 'short' })", component("return <p>{n.toLocaleString('en-US', { timeZone: 'UTC', dateStyle: 'short' })}</p>")),
      ],
    },
    {
      code: component("const date = new Date(ts); return <p>{date.toLocaleString('en-GB')}</p>"),
      errors: [
        missing("date.toLocaleString('en-GB')", component("const date = new Date(ts); return <p>{date.toLocaleString('en-GB', { timeZone: 'UTC' })}</p>")),
      ],
    },
    {
      code: component("const f = new Intl.DateTimeFormat('en-US', { dateStyle: 'long' }); return <p>{f.format(d)}</p>"),
      errors: [
        missing(
          "new Intl.DateTimeFormat('en-US', { dateStyle: 'long' })",
          component("const f = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', dateStyle: 'long' }); return <p>{f.format(d)}</p>"),
        ),
      ],
    },
    {
      code: component("return <p>{Intl.DateTimeFormat('en-US').format(d)}</p>"),
      errors: [missing("Intl.DateTimeFormat('en-US')", component("return <p>{Intl.DateTimeFormat('en-US', { timeZone: 'UTC' }).format(d)}</p>"))],
    },
    {
      code: component('return <p>{new Intl.DateTimeFormat().format(d)}</p>'),
      errors: [missing('new Intl.DateTimeFormat()', component("return <p>{new Intl.DateTimeFormat(undefined, { timeZone: 'UTC' }).format(d)}</p>"))],
    },
    {
      code: component("return <p>{d.toLocaleDateString('de-DE')}</p>"),
      options: [{ defaultTimeZone: 'Europe/Berlin' }],
      errors: [
        missing("d.toLocaleDateString('de-DE')", component("return <p>{d.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}</p>"), 'Europe/Berlin'),
      ],
    },
    {
      code: component('return <p>{new Date(ts).getHours()}</p>'),
      errors: [localTime('new Date(ts).getHours()', { method: 'getUTCHours', output: component('return <p>{new Date(ts).getUTCHours()}</p>') })],
    },
    {
      code: component('const day = new Date(ts); return <p>{day.getMonth() + 1}/{day.getDate()}</p>'),
      errors: [
        localTime('day.getMonth()', {
          method: 'getUTCMonth',
          output: component('const day = new Date(ts); return <p>{day.getUTCMonth() + 1}/{day.getDate()}</p>'),
        }),
        localTime('day.getDate()', {
          method: 'getUTCDate',
          output: component('const day = new Date(ts); return <p>{day.getMonth() + 1}/{day.getUTCDate()}</p>'),
        }),
      ],
    },
    { code: component('const day = new Date(ts); return <p>{day.getTimezoneOffset()}</p>'), errors: [localTime('day.getTimezoneOffset()')] },
    { code: component('return <p>{new Date(ts).toDateString()}</p>'), errors: [localTime('new Date(ts).toDateString()')] },
    { code: component('return <p>{new Date(ts).toTimeString()}</p>'), errors: [localTime('new Date(ts).toTimeString()')] },
    { code: component('return <p>{new Date(ts).toString()}</p>'), errors: [localTime('new Date(ts).toString()')] },
    { code: component('return <p>{new Date(ts).getFullYear()}</p>'), options: [{ defaultTimeZone: 'Asia/Tokyo' }], errors: [localTime('new Date(ts).getFullYear()')] },
    {
      code: component('return <p>{new Date().getMinutes()}</p>'),
      errors: [localTime('new Date().getMinutes()', { method: 'getUTCMinutes', output: component('return <p>{new Date().getUTCMinutes()}</p>') })],
    },
    {
      code: component('const tz = Intl.DateTimeFormat().resolvedOptions().timeZone; return <p>{tz}</p>'),
      errors: [{ messageId: 'runtimeTimeZone', data: { call: 'Intl.DateTimeFormat().resolvedOptions()' }, suggestions: [] }],
    },
    {
      code: 'function useLabel(ts) { return useMemo(() => new Date(ts).toLocaleDateString("en-US"), [ts]) }',
      errors: [
        missing(
          'new Date(ts).toLocaleDateString("en-US")',
          "function useLabel(ts) { return useMemo(() => new Date(ts).toLocaleDateString(\"en-US\", { timeZone: 'UTC' }), [ts]) }",
        ),
      ],
    },
    nextApp('app/page.jsx', {
      code: "'use client';\nexport default function Page({ d }) { return <p>{d.toLocaleDateString('en-US')}</p> }",
      errors: [missing("d.toLocaleDateString('en-US')", "'use client';\nexport default function Page({ d }) { return <p>{d.toLocaleDateString('en-US', { timeZone: 'UTC' })}</p> }")],
    }),
  ],
});

tsxTester.run('no-timezone-without-explicit-timezone (TypeScript)', rule, {
  valid: [tsx({ code: "const D: FC<{ at: Date }> = ({ at }) => <time>{at.toLocaleDateString('en-US', { timeZone: 'UTC' } as const)}</time>;" })],
  invalid: [
    tsx({
      code: "const D: FC<{ at: Date }> = ({ at }) => <time>{(at satisfies Date).toLocaleDateString('en-US')}</time>;",
      errors: [
        missing(
          "(at satisfies Date).toLocaleDateString('en-US')",
          "const D: FC<{ at: Date }> = ({ at }) => <time>{(at satisfies Date).toLocaleDateString('en-US', { timeZone: 'UTC' })}</time>;",
        ),
      ],
    }),
    tsx({
      code: 'function Hour({ ts }: { ts: number }) { const d: Date = new Date(ts); return <p>{d.getHours()}</p>; }',
      errors: [
        localTime('d.getHours()', {
          method: 'getUTCHours',
          output: 'function Hour({ ts }: { ts: number }) { const d: Date = new Date(ts); return <p>{d.getUTCHours()}</p>; }',
        }),
      ],
    }),
  ],
});
