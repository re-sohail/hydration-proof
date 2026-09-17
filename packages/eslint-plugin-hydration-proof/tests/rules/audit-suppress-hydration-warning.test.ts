import { auditSuppressHydrationWarning as rule } from '../../src/rules/audit-suppress-hydration-warning.ts';
import { jsxTester, nextApp, tsx, tsxTester } from '../helpers.ts';

const render = (jsx: string) => `function View({ children, theme, props, items, show, time }) { return (${jsx}) }`;
const error = (messageId: string, tag: string) => ({ messageId, data: { tag } });
const unused = (tag: string, output: string) => ({ messageId: 'unused', data: { tag }, suggestions: [{ messageId: 'remove', output }] });

jsxTester.run('audit-suppress-hydration-warning', rule, {
  valid: [
    render('<time suppressHydrationWarning>{new Date().toLocaleTimeString()}</time>'),
    render('<time dateTime={time} suppressHydrationWarning>{time}</time>'),
    render('<html lang="en" suppressHydrationWarning><body>{children}</body></html>'),
    render('<body suppressHydrationWarning className="x"><main /></body>'),
    render('<html suppressHydrationWarning />'),
    render('<div suppressHydrationWarning={false}><span /></div>'),
    render('<div suppressHydrationWarning={undefined}>static</div>'),
    render('<p suppressHydrationWarning className={theme}>Hi</p>'),
    render('<p suppressHydrationWarning {...props}>Hi</p>'),
    render('<div suppressHydrationWarning>{children}</div>'),
    render('<p suppressHydrationWarning>Hello {time}</p>'),
    render('<p>No attribute at all</p>'),
    { code: render('<div suppressHydrationWarning><span /></div>'), options: [{ allowOn: ['div'] }] },
    { code: render('<ThemeProvider suppressHydrationWarning />'), options: [{ allowOn: ['ThemeProvider'] }] },
    { code: render('<html suppressHydrationWarning><body /></html>'), options: [{ reportAll: true }] },
  ],
  invalid: [
    { code: render('<div suppressHydrationWarning><span>{Date.now()}</span></div>'), errors: [error('tooDeep', 'div')] },
    { code: render('<ul suppressHydrationWarning>{items.map((i) => <li key={i}>{i}</li>)}</ul>'), errors: [error('tooDeep', 'ul')] },
    { code: render('<div suppressHydrationWarning>{show ? <b /> : null}</div>'), errors: [error('tooDeep', 'div')] },
    { code: render('<div suppressHydrationWarning><>{time}<i /></></div>'), errors: [error('tooDeep', 'div')] },
    { code: render('<p suppressHydrationWarning>Hello</p>'), errors: [unused('p', render('<p>Hello</p>'))] },
    {
      code: render('<p className="lead" suppressHydrationWarning>Hello {"world"}</p>'),
      errors: [unused('p', render('<p className="lead">Hello {"world"}</p>'))],
    },
    {
      code: render("<span suppressHydrationWarning={true} style={{ color: 'red', margin: -1 }} />"),
      errors: [unused('span', render("<span style={{ color: 'red', margin: -1 }} />"))],
    },
    {
      code: render('<button suppressHydrationWarning onClick={() => go()} key="k">Go</button>'),
      errors: [unused('button', render('<button onClick={() => go()} key="k">Go</button>'))],
    },
    { code: render('<input suppressHydrationWarning />'), errors: [unused('input', render('<input />'))] },
    { code: render('<Clock suppressHydrationWarning />'), errors: [error('onComponent', 'Clock')] },
    { code: render('<UI.Time suppressHydrationWarning>{time}</UI.Time>'), errors: [error('onComponent', 'UI.Time')] },
    { code: render('<html suppressHydrationWarning><body /></html>'), options: [{ allowOn: [] }], errors: [error('tooDeep', 'html')] },
    { code: render('<time suppressHydrationWarning>{time}</time>'), options: [{ reportAll: true }], errors: [error('audit', 'time')] },
    // Server Components still hydrate their elements.
    nextApp('app/layout.jsx', {
      code: 'export default function Layout({ children }) { return <div suppressHydrationWarning><p>{children}</p></div> }',
      errors: [error('tooDeep', 'div')],
    }),
  ],
});

tsxTester.run('audit-suppress-hydration-warning (TypeScript)', rule, {
  valid: [tsx({ code: 'const View: FC<{ label: string }> = ({ label }) => <p suppressHydrationWarning>{label as string}</p>;' })],
  invalid: [
    tsx({ code: 'const View = () => <Box<string> suppressHydrationWarning />;', errors: [error('onComponent', 'Box')] }),
    tsx({
      code: 'const View = () => <p suppressHydrationWarning>{"static" as const}</p>;',
      errors: [unused('p', 'const View = () => <p>{"static" as const}</p>;')],
    }),
  ],
});
