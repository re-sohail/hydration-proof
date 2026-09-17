import { noBrowserGlobalInRender as rule } from '../../src/rules/no-browser-global-in-render.ts';
import { jsxTester, nextApp, tsx, tsxTester } from '../helpers.ts';

const error = (read: string) => ({ messageId: 'browserGlobal', data: { read } });

jsxTester.run('no-browser-global-in-render', rule, {
  valid: [
    'function W() { const [w, setW] = useState(0); useEffect(() => { setW(window.innerWidth) }, []); return <p>{w}</p> }',
    'function W() { return <button onClick={() => window.scrollTo(0, 0)}>Top</button> }',
    'function W() { const title = useCallback(() => document.title, []); return null }',
    'function W() { function read() { return navigator.language } return <Child read={read} /> }',
    'const ua = typeof navigator === "undefined" ? "" : navigator.userAgent; function W() { return <p>{ua}</p> }',
    'export function getTitle() { return document.title }',
    // Shadowed names.
    'function W({ window }) { return <p>{window.innerWidth}</p> }',
    'function W() { const document = useDocument(); return <p>{document.title}</p> }',
    'function W() { const location = useLocation(); return <p>{location.pathname}</p> }',
    'import { history } from "./router"; function W() { return <p>{history.length}</p> }',
    // typeof and guarded reads belong to no-window-render-branch.
    'function W() { return typeof window === "undefined" ? null : <p>ok</p> }',
    'function W() { return typeof window !== "undefined" ? <p>{window.innerWidth}</p> : null }',
    'function W() { return typeof window !== "undefined" && <p>{window.innerWidth}</p> }',
    'function W() { if (typeof window === "undefined") return null; return <p>{window.location.href}</p> }',
    'function W() { if (typeof document !== "undefined") { return <p>{document.title}</p> } return null }',
    'function W() { const isBrowser = typeof window !== "undefined"; return isBrowser ? <p>{navigator.userAgent}</p> : null }',
    'import { isBrowser } from "./env"; function W() { return isBrowser && <p>{document.title}</p> }',
    'function W() { return globalThis.window ? <p>{window.innerWidth}</p> : null }',
    'function W() { return "window" in globalThis ? <p>{window.innerWidth}</p> : null }',
    // Storage, matchMedia and state initializers have their own rules.
    'function W() { return <p>{window.localStorage.getItem("x")}</p> }',
    'function W() { const dark = window.matchMedia("(prefers-color-scheme: dark)").matches; return <p>{String(dark)}</p> }',
    'function W() { const [w] = useState(() => window.innerWidth); return <p>{w}</p> }',
    'function W() { const [w] = useState(window.innerWidth); return <p>{w}</p> }',
    'function W() { const ref = useRef(document.body); return null }',
    'class W extends Component { state = { w: window.innerWidth }; render() { return null } }',
    // JSX tag names are components, not globals.
    'function W() { return <location.Provider value={1}><screen.Panel /><history /></location.Provider> }',
    // Globals that exist on the server too.
    'function W() { return <p>{globalThis.foo}</p> }',
    'function W() { return <p>{window.Date.now() > 0 ? "a" : "b"}</p> }',
    nextApp('app/page.jsx', { code: 'export default function Page() { return <p>{document.title}</p> }' }),
  ],
  invalid: [
    { code: 'function W() { return <p>{window.innerWidth}</p> }', errors: [error('window.innerWidth')] },
    { code: 'const W = () => <p>{document.title}</p>', errors: [error('document')] },
    { code: 'function W() { const lang = navigator.language; return <p>{lang}</p> }', errors: [error('navigator')] },
    { code: 'function W() { return <p>{location.pathname}</p> }', errors: [error('location')] },
    { code: 'function W() { return <p>{innerWidth > 600 ? "wide" : "narrow"}</p> }', errors: [error('innerWidth')] },
    { code: 'function W() { return <p>{devicePixelRatio}</p> }', errors: [error('devicePixelRatio')] },
    { code: 'function W() { return <p>{history.length}</p> }', errors: [error('history')] },
    { code: 'function W() { return <p>{screen.width}x{outerWidth}</p> }', errors: [error('screen'), error('outerWidth')] },
    { code: 'function W() { return <p>{globalThis.window.innerWidth}</p> }', errors: [error('globalThis.window.innerWidth')] },
    { code: 'function W() { return <p>{self.screen.width}</p> }', errors: [error('self.screen')] },
    { code: 'function W() { const w = window; return <p>{w.innerWidth}</p> }', errors: [error('window')] },
    { code: 'function W() { return <p>{window.__APP_STATE__.user}</p> }', errors: [error('window.__APP_STATE__')] },
    { code: 'function W() { return <p>{window?.innerHeight}</p> }', errors: [error('window?.innerHeight')] },
    { code: 'function W() { return <p>{"ontouchstart" in window ? "touch" : "mouse"}</p> }', errors: [error('window')] },
    { code: 'function W() { const w = globalThis.window; return null }', errors: [error('globalThis.window')] },
    { code: 'function W() { const w = useMemo(() => window.innerWidth, []); return <p>{w}</p> }', errors: [error('window.innerWidth')] },
    { code: 'function W({ ids }) { return ids.map((id) => <p key={id}>{document.getElementById(id)?.textContent}</p>) }', errors: [error('document')] },
    { code: 'class W extends Component { render() { return <p>{window.innerHeight}</p> } }', errors: [error('window.innerHeight')] },
    { code: 'function useWidth() { return window.innerWidth }', errors: [error('window.innerWidth')] },
    // The check does not guard a read that comes after it.
    {
      code: 'function W() { if (typeof window !== "undefined") { track() } return <p>{window.innerWidth}</p> }',
      errors: [error('window.innerWidth')],
    },
    // A check that guards storage is left to no-storage-in-initial-render, so other reads in the branch are reported here.
    {
      code: 'function W() { return typeof window !== "undefined" ? <p>{localStorage.getItem("a")}{window.innerWidth}</p> : null }',
      errors: [error('window.innerWidth')],
    },
    // A local flag from a hook is not an environment check.
    { code: 'function W() { const isClient = useIsClient(); return isClient ? <p>{window.innerWidth}</p> : null }', errors: [error('window.innerWidth')] },
    nextApp('app/page.jsx', { code: "'use client';\nexport default function Page() { return <p>{document.title}</p> }", errors: [error('document')] }),
  ],
});

tsxTester.run('no-browser-global-in-render (TypeScript)', rule, {
  valid: [
    tsx({ code: 'function W() { let el: typeof document.body | null = null; return <p>{String(el)}</p>; }' }),
    tsx({ code: 'declare const window: { innerWidth: number }; const W: FC = () => <p>{window.innerWidth}</p>;' }),
    tsx({ code: 'const W = (): JSX.Element | null => (typeof window !== "undefined" ? <p>{(window as Window).innerWidth}</p> : null);' }),
  ],
  invalid: [
    tsx({ code: 'const W: React.FC = () => <p>{(window as Window).innerWidth}</p>;', errors: [error('(window as Window).innerWidth')] }),
    tsx({ code: 'const W = () => <p>{window!.innerWidth}</p>;', errors: [error('window!.innerWidth')] }),
    tsx({ code: 'function W<T>({ value }: { value: T }) { return <p>{String(value)}{navigator.onLine satisfies boolean}</p>; }', errors: [error('navigator')] }),
  ],
});
