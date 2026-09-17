import { noMatchMediaInRender as rule } from '../../src/rules/no-match-media-in-render.ts';
import { jsxTester, nextApp, tsx, tsxTester } from '../helpers.ts';

const error = (read: string) => ({ messageId: 'matchMedia', data: { read } });

jsxTester.run('no-match-media-in-render', rule, {
  valid: [
    'function M() { const [dark, setDark] = useState(false); useEffect(() => { setDark(matchMedia("(prefers-color-scheme: dark)").matches) }, []); return null }',
    'function M() { return <button onClick={() => window.matchMedia("print")}>Print</button> }',
    'function useMedia(q) { return useSyncExternalStore(subscribe, () => matchMedia(q).matches, () => false) }',
    'function M({ matchMedia }) { return <p>{String(matchMedia("x"))}</p> }',
    'function M() { return typeof window.matchMedia === "function" ? <A /> : <B /> }',
    'function M() { return <p className="dark:text-white">Hi</p> }',
    'export function prefersDark() { return window.matchMedia("(prefers-color-scheme: dark)").matches }',
    nextApp('app/page.jsx', { code: 'export default function Page() { return <p>{String(matchMedia("print").matches)}</p> }' }),
  ],
  invalid: [
    {
      code: 'function M() { const dark = window.matchMedia("(prefers-color-scheme: dark)").matches; return <p>{String(dark)}</p> }',
      errors: [error('window.matchMedia("(prefers-color-scheme: dark)")')],
    },
    { code: 'function M() { const [wide] = useState(() => matchMedia("(min-width: 800px)").matches); return null }', errors: [error('matchMedia("(min-width: 800px)")')] },
    { code: 'function useMediaQuery(q) { return globalThis.matchMedia(q).matches }', errors: [error('globalThis.matchMedia(q)')] },
    { code: 'function M() { const mq = window.matchMedia; return null }', errors: [error('window.matchMedia')] },
    { code: 'function M() { return typeof window !== "undefined" && window.matchMedia("(x)").matches ? <A /> : <B /> }', errors: [error('window.matchMedia("(x)")')] },
    { code: 'function M() { const ref = useRef(self.matchMedia("print")); return null }', errors: [error('self.matchMedia("print")')] },
    { code: 'class M extends Component { render() { return matchMedia("print").matches ? null : <p /> } }', errors: [error('matchMedia("print")')] },
    nextApp('app/page.jsx', { code: "'use client';\nexport default function Page() { return <p>{String(matchMedia('print').matches)}</p> }", errors: [error("matchMedia('print')")] }),
  ],
});

tsxTester.run('no-match-media-in-render (TypeScript)', rule, {
  valid: [tsx({ code: 'const M: FC = () => { useEffect(() => { window.matchMedia("print"); }, []); return null; };' })],
  invalid: [
    tsx({ code: 'const M: FC = () => <p>{String((window as Window).matchMedia("print").matches)}</p>;', errors: [error('(window as Window).matchMedia("print")')] }),
    tsx({ code: 'function useDark(): boolean { return matchMedia("(prefers-color-scheme: dark)")!.matches; }', errors: [error('matchMedia("(prefers-color-scheme: dark)")')] }),
  ],
});
