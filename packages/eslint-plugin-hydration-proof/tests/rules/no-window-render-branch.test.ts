import { noWindowRenderBranch as rule } from '../../src/rules/no-window-render-branch.ts';
import { jsxTester, nextApp, tsx, tsxTester } from '../helpers.ts';

const error = (check: string) => ({ messageId: 'environmentBranch', data: { check } });

jsxTester.run('no-window-render-branch', rule, {
  valid: [
    'function B() { const [ready, setReady] = useState(false); useEffect(() => { if (typeof window !== "undefined") setReady(true) }, []); return ready ? <A /> : null }',
    'function B() { return <button onClick={() => { if (typeof window !== "undefined") window.print() }}>Print</button> }',
    'const isBrowser = typeof window !== "undefined"; export function helper() { return isBrowser }',
    'export function getWidth() { return typeof window === "undefined" ? 0 : window.innerWidth }',
    // Locals and props are not environment flags (useIsClient is the recommended pattern).
    'function B() { const isClient = useIsClient(); return isClient ? <A /> : <B /> }',
    'function B({ isServer }) { return isServer ? <A /> : null }',
    'function B() { const [isClient, setIsClient] = useState(false); useEffect(() => setIsClient(true), []); return isClient && <A /> }',
    // Storage, matchMedia and initial state have more specific rules.
    'function B() { return typeof window !== "undefined" ? <p>{localStorage.getItem("x")}</p> : null }',
    'function B() { const dark = typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches; return null }',
    'function B() { if (typeof window === "undefined") return null; return <p>{localStorage.getItem("x")}</p> }',
    'function B() { const [ready] = useState(typeof window !== "undefined"); return null }',
    'function B() { const [w] = useState(() => (typeof window === "undefined" ? 0 : window.innerWidth)); return null }',
    // Not environment checks.
    'function B({ value }) { const isText = typeof value === "string"; return isText ? <p>{value}</p> : null }',
    'function B() { const kind = typeof window; return <p>{kind}</p> }',
    'function B() { return "fetch" in globalThis ? <A /> : null }',
    'import { isServer } from "./env"; function helper() { return isServer ? 1 : 2 }',
    'import { isServer } from "./env"; function B() { const flag = isServer; return null }',
    'function B({ env }) { return env.isServer ? <A /> : null }',
    // getServerSnapshot runs outside render; require-stable-server-snapshot checks it.
    'function B() { return useSyncExternalStore(subscribe, getSnapshot, () => typeof window === "undefined") }',
    nextApp('app/page.jsx', { code: 'export default function Page() { return typeof window === "undefined" ? <A /> : <B /> }' }),
  ],
  invalid: [
    { code: 'function B() { return typeof window === "undefined" ? <Fallback /> : <Widget /> }', errors: [error('typeof window === "undefined"')] },
    { code: 'function B() { if (typeof document !== "undefined") { return <Portal /> } return null }', errors: [error('typeof document !== "undefined"')] },
    {
      code: 'function B() { return "undefined" != typeof navigator && <p>{navigator.userAgent}</p> }',
      errors: [error('"undefined" != typeof navigator')],
    },
    { code: "function B() { return typeof window == 'object' ? <A /> : null }", errors: [error("typeof window == 'object'")] },
    { code: 'function B() { return typeof window !== typeof undefined ? <A /> : null }', errors: [error('typeof window !== typeof undefined')] },
    {
      code: 'function B() { const isClient = typeof window !== "undefined"; return <p>{isClient ? "client" : "server"}</p> }',
      errors: [error('typeof window !== "undefined"')],
    },
    { code: 'import { isServer } from "solid-js/web"; function B() { return isServer ? null : <Chart /> }', errors: [error('isServer')] },
    { code: 'import ExecutionEnvironment from "exenv"; function B() { return ExecutionEnvironment.canUseDOM && <Chart /> }', errors: [error('ExecutionEnvironment.canUseDOM')] },
    { code: 'const IS_BROWSER = typeof window !== "undefined"; function B() { if (!IS_BROWSER) return null; return <Chart /> }', errors: [error('IS_BROWSER')] },
    { code: 'import { isBrowser } from "./env"; function B() { return isBrowser === true ? <A /> : <B /> }', errors: [error('isBrowser')] },
    { code: 'function B() { return "window" in globalThis ? <A /> : <B /> }', errors: [error('"window" in globalThis')] },
    { code: 'function B() { return globalThis.document ? <A /> : null }', errors: [error('globalThis.document')] },
    { code: 'function B() { return import.meta.env.SSR ? null : <A /> }', errors: [error('import.meta.env.SSR')] },
    { code: 'function B() { return process.browser ? <A /> : null }', errors: [error('process.browser')] },
    { code: 'function B() { return typeof localStorage === "undefined" ? null : <A /> }', errors: [error('typeof localStorage === "undefined"')] },
    { code: 'function B() { return typeof window.matchMedia === "function" ? <A /> : null }', errors: [error('typeof window.matchMedia === "function"')] },
    { code: 'function B() { const v = useMemo(() => (typeof window === "undefined" ? 0 : 1), []); return v }', errors: [error('typeof window === "undefined"')] },
    { code: 'function useIsClient() { return typeof window !== "undefined" }', errors: [error('typeof window !== "undefined"')] },
    { code: 'class B extends Component { render() { return typeof document === "undefined" ? null : <A /> } }', errors: [error('typeof document === "undefined"')] },
    {
      code: 'function B() { return __SERVER__ ? null : <A /> }',
      settings: { 'hydration-proof': { environmentFlags: ['__SERVER__'] } },
      errors: [error('__SERVER__')],
    },
    nextApp('app/page.jsx', {
      code: "'use client';\nexport default function Page() { return typeof window === 'undefined' ? <A /> : <B /> }",
      errors: [error("typeof window === 'undefined'")],
    }),
  ],
});

tsxTester.run('no-window-render-branch (TypeScript)', rule, {
  valid: [tsx({ code: 'function B(): JSX.Element { const isClient: boolean = useIsClient(); return isClient ? <A /> : <C />; }' })],
  invalid: [
    tsx({ code: "const B: FC = () => (typeof window !== ('undefined' as const) ? <A /> : null);", errors: [error("typeof window !== ('undefined' as const)")] }),
    tsx({ code: 'function B<T>(props: T) { return typeof (window as Window | undefined) === "undefined" ? null : <A {...props} />; }', errors: [error('typeof (window as Window | undefined) === "undefined"')] }),
  ],
});
