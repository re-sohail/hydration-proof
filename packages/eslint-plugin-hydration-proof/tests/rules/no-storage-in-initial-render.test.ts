import { noStorageInInitialRender as rule } from '../../src/rules/no-storage-in-initial-render.ts';
import { jsxTester, nextApp, tsx, tsxTester } from '../helpers.ts';

const inRender = (read: string) => ({ messageId: 'storage', data: { read } });
const inState = (read: string, hook: string) => ({ messageId: 'storageInitialState', data: { read, hook } });

jsxTester.run('no-storage-in-initial-render', rule, {
  valid: [
    'function T() { const [theme, setTheme] = useState("light"); useEffect(() => { setTheme(localStorage.getItem("theme") ?? "light") }, []); return <p>{theme}</p> }',
    'function T() { return <button onClick={() => localStorage.setItem("seen", "1")}>OK</button> }',
    'function T() { const save = useCallback((v) => sessionStorage.setItem("k", v), []); return null }',
    'function T() { const ok = typeof localStorage !== "undefined"; return null }',
    'function T({ localStorage }) { return <p>{localStorage.getItem("x")}</p> }',
    'function T() { const storage = useStorage(); return <p>{storage.localStorage}</p> }',
    'function T() { return useSyncExternalStore(subscribe, () => localStorage.getItem("t"), () => "light") }',
    'const initial = typeof window === "undefined" ? null : localStorage.getItem("t"); export function read() { return localStorage.getItem("t") }',
    nextApp('app/page.jsx', { code: 'export default function Page() { return <p>{localStorage.length}</p> }' }),
  ],
  invalid: [
    { code: 'function T() { return <p>{localStorage.getItem("theme")}</p> }', errors: [inRender('localStorage')] },
    { code: 'function T() { const v = window.sessionStorage.getItem("x"); return <p>{v}</p> }', errors: [inRender('window.sessionStorage')] },
    { code: 'function T() { return <p>{globalThis.localStorage?.length}</p> }', errors: [inRender('globalThis.localStorage')] },
    { code: 'function T() { return typeof window !== "undefined" ? <p>{localStorage.getItem("t")}</p> : null }', errors: [inRender('localStorage')] },
    { code: 'function useTheme() { return localStorage.getItem("theme") }', errors: [inRender('localStorage')] },
    { code: 'function T() { const t = useMemo(() => sessionStorage.getItem("t"), []); return t }', errors: [inRender('sessionStorage')] },
    {
      code: 'function T() { const [theme] = useState(() => localStorage.getItem("theme") ?? "light"); return <p>{theme}</p> }',
      errors: [inState('localStorage', 'useState')],
    },
    {
      code: 'function T() { const [theme] = useState(typeof window !== "undefined" ? localStorage.getItem("t") : "light"); return null }',
      errors: [inState('localStorage', 'useState')],
    },
    { code: 'function T() { const [s] = useReducer(reducer, globalThis.localStorage.getItem("s")); return null }', errors: [inState('globalThis.localStorage', 'useReducer')] },
    { code: 'function T() { const [s] = useReducer(reducer, null, () => JSON.parse(sessionStorage.s)); return null }', errors: [inState('sessionStorage', 'useReducer')] },
    { code: 'function T() { const ref = useRef(sessionStorage.length); return null }', errors: [inState('sessionStorage', 'useRef')] },
    {
      code: 'class T extends Component { constructor(p) { super(p); this.state = { theme: localStorage.theme } } render() { return null } }',
      errors: [inState('localStorage', 'state')],
    },
    { code: 'class T extends Component { state = { theme: window.localStorage.theme }; render() { return null } }', errors: [inState('window.localStorage', 'state')] },
    nextApp('app/settings/page.jsx', { code: "'use client';\nexport default function Page() { return <p>{localStorage.length}</p> }", errors: [inRender('localStorage')] }),
  ],
});

tsxTester.run('no-storage-in-initial-render (TypeScript)', rule, {
  valid: [tsx({ code: 'const T: FC = () => { useEffect(() => { localStorage.setItem("k", "v"); }, []); return null; };' })],
  invalid: [
    tsx({ code: 'const T: FC = () => { const raw = localStorage.getItem("t") as string | null; return <p>{raw}</p>; };', errors: [inRender('localStorage')] }),
    tsx({ code: 'const T = () => <p>{window.localStorage!.getItem("x")}</p>;', errors: [inRender('window.localStorage')] }),
    tsx({
      code: 'function useTheme(): Theme { const [t] = useState<Theme>(() => (localStorage.getItem("t") as Theme) ?? "light"); return t; }',
      errors: [inState('localStorage', 'useState')],
    }),
  ],
});
