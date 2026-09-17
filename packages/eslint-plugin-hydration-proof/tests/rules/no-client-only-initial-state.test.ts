import { noClientOnlyInitialState as rule } from '../../src/rules/no-client-only-initial-state.ts';
import { jsxTester, nextApp, tsx, tsxTester } from '../helpers.ts';

const read = (hook: string, value: string) => ({ messageId: 'browserRead', data: { hook, read: value } });
const check = (hook: string, value: string) => ({ messageId: 'environmentCheck', data: { hook, check: value } });

jsxTester.run('no-client-only-initial-state', rule, {
  valid: [
    'function S() { const [w, setW] = useState(0); useEffect(() => setW(window.innerWidth), []); return <p>{w}</p> }',
    'function S() { const [w] = useState(() => getInitialWidth()); return null }',
    'function S({ window }) { const [w] = useState(window.innerWidth); return null }',
    'function S() { const ref = useRef(null); useLayoutEffect(() => { ref.current = document.activeElement }); return null }',
    'function S() { const [x] = useState(typeof value === "string"); return null }',
    'function S() { const measure = useCallback(() => window.innerWidth, []); return null }',
    'function S() { const [w] = useState(1024); const onResize = () => setW(window.innerWidth); return null }',
    'class S extends Component { handleResize = () => { this.setState({ w: window.innerWidth }) }; render() { return null } }',
    'class S extends Component { componentDidMount() { this.state = { w: window.innerWidth } } render() { return null } }',
    'class S extends Component { static defaults = { w: window.innerWidth }; render() { return null } }',
    // Storage and matchMedia have their own rules, even behind a check.
    'function S() { const [t] = useState(() => localStorage.getItem("t")); return null }',
    'function S() { const [d] = useState(() => typeof window !== "undefined" && matchMedia("(x)").matches); return null }',
    'function S() { const [t] = useState(typeof window === "undefined" ? "light" : localStorage.theme); return null }',
    // Plain render reads: no-browser-global-in-render.
    'function S() { const w = window.innerWidth; return <p>{w}</p> }',
    nextApp('app/page.jsx', { code: 'export default function Page() { const [w] = useState(window.innerWidth); return null }' }),
  ],
  invalid: [
    { code: 'function S() { const [w] = useState(window.innerWidth); return null }', errors: [read('useState', 'window.innerWidth')] },
    { code: 'function S() { const [w] = React.useState(() => innerHeight); return null }', errors: [read('useState', 'innerHeight')] },
    {
      code: 'function S() { const [w] = useState(() => typeof window === "undefined" ? 1024 : window.innerWidth); return null }',
      errors: [read('useState', 'window.innerWidth')],
    },
    { code: 'function S() { const [ua] = useState(() => navigator.userAgent); return null }', errors: [read('useState', 'navigator')] },
    { code: 'function S() { const [s] = useReducer(reducer, { path: location.pathname }); return null }', errors: [read('useReducer', 'location')] },
    { code: 'function S() { const [s] = useReducer(reducer, null, () => ({ w: innerWidth })); return null }', errors: [read('useReducer', 'innerWidth')] },
    { code: 'function S() { const el = useRef(document.activeElement); return null }', errors: [read('useRef', 'document')] },
    { code: 'function S() { const [isClient] = useState(typeof window !== "undefined"); return null }', errors: [check('useState', 'typeof window !== "undefined"')] },
    {
      code: 'import { isBrowser } from "./env"; function S() { const [mode] = useState(isBrowser ? "live" : "static"); return null }',
      errors: [check('useState', 'isBrowser')],
    },
    {
      code: 'function S() { const [c] = useState(() => { if (typeof document === "undefined") return 0; return 1; }); return null }',
      errors: [check('useState', 'typeof document === "undefined"')],
    },
    {
      code: 'function S() { const [c] = useState(() => (typeof window === "undefined" ? 0 : typeof document === "undefined" ? 1 : 2)); return null }',
      errors: [check('useState', 'typeof window === "undefined"')],
    },
    { code: 'class S extends Component { state = { width: window.innerWidth }; render() { return null } }', errors: [read('class state', 'window.innerWidth')] },
    {
      code: 'class S extends React.Component { constructor(props) { super(props); this.state = { href: window.location.href } } render() { return null } }',
      errors: [read('class state', 'window.location')],
    },
    { code: 'function useWidth() { const [w] = useState(() => screen.width); return w }', errors: [read('useState', 'screen')] },
    {
      code: 'function S() { const [dims] = useState(() => ({ w: window.innerWidth, h: window.innerHeight })); return null }',
      errors: [read('useState', 'window.innerWidth'), read('useState', 'window.innerHeight')],
    },
    {
      code: 'function S() { const [s] = useState(() => ({ w: window.innerWidth, theme: localStorage.theme })); return null }',
      errors: [read('useState', 'window.innerWidth')],
    },
    nextApp('app/page.jsx', {
      code: "'use client';\nexport default function Page() { const [w] = useState(window.innerWidth); return null }",
      errors: [read('useState', 'window.innerWidth')],
    }),
  ],
});

tsxTester.run('no-client-only-initial-state (TypeScript)', rule, {
  valid: [tsx({ code: 'const S: FC = () => { const [w, setW] = useState<number>(0); useEffect(() => setW(window.innerWidth), []); return null; };' })],
  invalid: [
    tsx({
      code: 'const S: FC = () => { const [w] = useState<number>(() => (window as Window).innerWidth); return null; };',
      errors: [read('useState', '(window as Window).innerWidth')],
    }),
    tsx({
      code: 'class S extends React.Component<Props, { w: number }> { state = { w: window.innerWidth } satisfies { w: number }; render() { return null; } }',
      errors: [read('class state', 'window.innerWidth')],
    }),
    tsx({
      code: 'function useRefEl(): React.RefObject<Element | null> { return useRef<Element | null>(document.body!); }',
      errors: [read('useRef', 'document')],
    }),
  ],
});
