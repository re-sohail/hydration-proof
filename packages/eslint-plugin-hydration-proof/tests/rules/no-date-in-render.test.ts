import { noDateInRender as rule } from '../../src/rules/no-date-in-render.ts';
import { jsxTester, nextApp, tsx, tsxTester } from '../helpers.ts';

const error = (source: string) => ({ messageId: 'currentTime', data: { source } });

jsxTester.run('no-date-in-render', rule, {
  valid: [
    // Effects, handlers and callbacks run after hydration.
    'function Clock() { const [now, setNow] = useState(0); useEffect(() => { setNow(Date.now()) }, []); return <p>{now}</p> }',
    'function Clock() { useLayoutEffect(() => { start.current = performance.now() }); return null }',
    'function Clock() { useInsertionEffect(() => { log(new Date()) }); return null }',
    'function Clock() { const onClick = () => console.log(Date.now()); return <button onClick={onClick}>Log</button> }',
    'function Clock() { return <button onClick={() => alert(new Date())}>Now</button> }',
    'function Clock() { const read = useCallback(() => Date.now(), []); return <Child read={read} /> }',
    'function Clock() { function handle() { return Date.now() } return <Child onTick={handle} /> }',
    'class Clock extends React.Component { componentDidMount() { this.setState({ now: Date.now() }) } render() { return <p>{this.state.now}</p> } }',
    'class Clock extends Component { handleClick = () => { this.setState({ at: Date.now() }) }; render() { return null } }',
    // Dates built from explicit values are deterministic.
    'function Day({ at }) { const d = new Date(at); return <p>{d.toISOString()}</p> }',
    'function Year() { return <p>{new Date(2020, 1, 1).toISOString()}</p> }',
    'function Parse({ s }) { return <p>{Date.parse(s)}</p> }',
    // Not render code.
    'const started = Date.now(); function App() { return <p>{started}</p> }',
    'function formatNow() { return new Date().toISOString() }',
    'export function getServerSideProps() { return { props: { now: Date.now() } } }',
    // Shadowed globals.
    'function Clock() { const Date = { now: () => 1 }; return <p>{Date.now()}</p> }',
    'function Clock({ performance }) { return <p>{performance.now()}</p> }',
    // An id built from the clock belongs to no-unstable-id.
    'function Field() { return <input id={`field-${Date.now()}`} /> }',
    // Server Components never hydrate.
    nextApp('app/page.jsx', { code: 'export default function Page() { return <p>{Date.now()}</p> }' }),
    nextApp('src/app/blog/[slug]/page.jsx', { code: 'export default async function Page() { return <p>{new Date().toISOString()}</p> }' }),
    { code: "'use server';\nexport default function Action() { return <p>{Date.now()}</p> }" },
  ],
  invalid: [
    { code: 'function Clock() { return <p>{Date.now()}</p> }', errors: [error('Date.now()')] },
    { code: 'const Clock = () => <p>{new Date().toISOString()}</p>', errors: [error('new Date()')] },
    { code: 'const Clock = memo(() => { const now = Date(); return <p>{now}</p> })', errors: [error('Date()')] },
    { code: 'export default function () { const t = performance.now(); return <p>{t}</p> }', errors: [error('performance.now()')] },
    { code: 'export default () => <p>{Date.now()}</p>', errors: [error('Date.now()')] },
    { code: 'function useNow() { return Date.now() }', errors: [error('Date.now()')] },
    { code: 'const useNow = function () { return new Date() }', errors: [error('new Date()')] },
    // Render-time callbacks.
    { code: 'function Clock() { const [now] = useState(() => Date.now()); return <p>{now}</p> }', errors: [error('Date.now()')] },
    { code: 'function Clock() { const [now] = useState(Date.now()); return <p>{now}</p> }', errors: [error('Date.now()')] },
    { code: 'function Clock() { const [s] = useReducer(reduce, null, () => ({ at: Date.now() })); return null }', errors: [error('Date.now()')] },
    { code: 'function Clock() { const label = useMemo(() => new Date().toISOString(), []); return <p>{label}</p> }', errors: [error('new Date()')] },
    { code: 'function Clock() { const label = React.useMemo(() => new Date().toISOString(), []); return <p>{label}</p> }', errors: [error('new Date()')] },
    { code: 'function Clock() { const start = useRef(performance.now()); return null }', errors: [error('performance.now()')] },
    {
      code: 'function List({ items }) { return <ul>{items.map((item) => <li key={item}>{Date.now()}</li>)}</ul> }',
      errors: [error('Date.now()')],
    },
    { code: 'function List({ items }) { return items.filter(function (item) { return item.at < Date.now() }).length }', errors: [error('Date.now()')] },
    { code: 'function Clock() { const t = (() => Date.now())(); return <p>{t}</p> }', errors: [error('Date.now()')] },
    { code: 'function Clock() { const t = (function () { return Date.now() }).call(this); return <p>{t}</p> }', errors: [error('Date.now()')] },
    // Class components: render, constructor and field initializers.
    { code: 'class Clock extends Component { render() { return <p>{Date.now()}</p> } }', errors: [error('Date.now()')] },
    { code: 'class Clock extends React.PureComponent { state = { now: Date.now() }; render() { return null } }', errors: [error('Date.now()')] },
    {
      code: 'class Clock extends Component { constructor(props) { super(props); this.started = Date.now() } render() { return null } }',
      errors: [error('Date.now()')],
    },
    // Wrapped components and access through the global object.
    { code: 'const Clock = forwardRef(function (props, ref) { return <p ref={ref}>{window.Date.now()}</p> })', errors: [error('Date.now()')] },
    { code: 'const Clock = React.memo(React.forwardRef((props, ref) => <p ref={ref}>{globalThis.performance.now()}</p>))', errors: [error('performance.now()')] },
    { code: 'Clock.Label = function Label() { return <p>{Date.now()}</p> }', errors: [error('Date.now()')] },
    { code: 'function Clock() { return <p>{Temporal.Now.instant().toString()}</p> }', errors: [error('Temporal.Now.instant()')] },
    // Client files are checked.
    nextApp('app/page.jsx', { code: "'use client';\nexport default function Page() { return <p>{Date.now()}</p> }", errors: [error('Date.now()')] }),
    nextApp('pages/index.jsx', { code: 'export default function Home() { return <p>{Date.now()}</p> }', errors: [error('Date.now()')] }),
    nextApp('components/Clock.jsx', { code: 'export function Clock() { return <p>{Date.now()}</p> }', errors: [error('Date.now()')] }),
    { code: 'export default function Page() { return <p>{Date.now()}</p> }', filename: 'app/page.jsx', errors: [error('Date.now()')] },
  ],
});

tsxTester.run('no-date-in-render (TypeScript)', rule, {
  valid: [
    tsx({
      code: 'const Clock: React.FC<{ at: number }> = ({ at }) => { useEffect(() => { console.log(Date.now()); }, []); return <p>{new Date(at).toISOString()}</p>; };',
    }),
    tsx({ code: 'function Clock<T extends object>(props: T) { let read: typeof Date.now | undefined; return <p>{String(read)}</p>; }' }),
    tsx({ code: 'const handler = (event: MouseEvent): number => Date.now();' }),
    nextApp('src/app/page.tsx', { code: 'export default function Page(): JSX.Element { return <p>{Date.now() as number}</p>; }' }),
  ],
  invalid: [
    tsx({ code: 'const Clock: React.FC<Props> = ({ label }) => <p>{label}: {(Date.now() as number).toFixed()}</p>;', errors: [error('Date.now()')] }),
    tsx({ code: 'const Clock = (({ label }: Props) => <p>{label}{Date.now()!}</p>) satisfies React.FC<Props>;', errors: [error('Date.now()')] }),
    tsx({
      code: 'export const Clock = memo(function Clock<T>(props: T) { const now = useMemo<number>(() => Date.now(), []); return <p>{now}</p>; });',
      errors: [error('Date.now()')],
    }),
    tsx({ code: 'export function useNow(): Date { return new Date(); }', errors: [error('new Date()')] }),
    tsx({
      code: 'class Clock extends React.Component<Props, State> { state: State = { now: Date.now() }; render() { return null; } }',
      errors: [error('Date.now()')],
    }),
    nextApp('src/app/page.tsx', { code: "'use client';\nexport default function Page() { return <p>{Date.now()}</p>; }", errors: [error('Date.now()')] }),
  ],
});
