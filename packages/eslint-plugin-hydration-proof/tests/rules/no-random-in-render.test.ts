import { noRandomInRender as rule } from '../../src/rules/no-random-in-render.ts';
import { jsxTester, nextApp, tsx, tsxTester } from '../helpers.ts';

const error = (source: string) => ({ messageId: 'random', data: { source } });

jsxTester.run('no-random-in-render', rule, {
  valid: [
    'function Item() { const [seed, setSeed] = useState(0); useEffect(() => { setSeed(Math.random()) }, []); return <p>{seed}</p> }',
    'function Item() { return <button onClick={() => track(crypto.randomUUID())}>Go</button> }',
    'function Item() { const pick = useCallback(() => Math.random(), []); return <Child pick={pick} /> }',
    'function random() { return Math.random() }',
    'const seed = Math.random(); function Item() { return <p>{seed}</p> }',
    // Shadowed or non-global names.
    'function Item() { const Math = { random: () => 0.5 }; return <p>{Math.random()}</p> }',
    "import crypto from 'some-crypto-lib'; function Item() { return <p>{crypto.randomUUID()}</p> }",
    'function Item({ crypto }) { return <p>{crypto.randomUUID()}</p> }',
    "import { v4 } from './local-uuid'; function Item() { return <p>{v4()}</p> }",
    // Deterministic helpers.
    "import { v5 } from 'uuid'; function Item({ name }) { return <p>{v5(name, NAMESPACE)}</p> }",
    "import { v4 } from 'uuid'; function Item() { const onClick = () => save(v4()); return <button onClick={onClick}>Save</button> }",
    "import { nanoid } from 'nanoid'; function Item() { useEffect(() => { setKey(nanoid()) }, []); return null }",
    "import { random } from 'lodash'; function helper() { return random(1, 6) }",
    // Owned by other rules.
    'function Field() { return <input id={String(Math.random())} /> }',
    "import { nanoid } from 'nanoid'; function Field() { const [id] = useState(() => nanoid()); return <input id={id} /> }",
    'function List({ items }) { return <ul>{[...items].sort(() => Math.random() - 0.5).map((i) => <li key={i}>{i}</li>)}</ul> }',
    "import { shuffle } from 'lodash'; function List({ items }) { return <p>{shuffle(items).join()}</p> }",
    nextApp('app/page.jsx', { code: 'export default function Page() { return <p>{Math.random()}</p> }' }),
  ],
  invalid: [
    { code: 'function Item() { return <p>{Math.random()}</p> }', errors: [error('Math.random()')] },
    { code: 'function Item() { const key = crypto.randomUUID(); return <p>{key}</p> }', errors: [error('crypto.randomUUID()')] },
    {
      code: 'function Item() { const bytes = window.crypto.getRandomValues(new Uint8Array(4)); return <p>{bytes[0]}</p> }',
      errors: [error('crypto.getRandomValues()')],
    },
    { code: "import { v4 as uuidv4 } from 'uuid'; function Item() { return <p>{uuidv4()}</p> }", errors: [error('uuid v4()')] },
    { code: "import * as uuid from 'uuid'; function Item() { return <p>{uuid.v7()}</p> }", errors: [error('uuid v7()')] },
    { code: "import { v1 } from 'uuid'; const Item = () => <p>{v1()}</p>", errors: [error('uuid v1()')] },
    { code: "import { nanoid } from 'nanoid'; const Item = () => <p>{nanoid()}</p>", errors: [error('nanoid()')] },
    { code: "import { nanoid } from 'nanoid/non-secure'; const Item = () => <p>{nanoid(8)}</p>", errors: [error('nanoid()')] },
    {
      code: "import { customAlphabet } from 'nanoid'; const makeCode = customAlphabet('abc', 6); function Item() { return <p>{makeCode()}</p> }",
      errors: [error('makeCode() (nanoid)')],
    },
    { code: "import _ from 'lodash'; function Dice() { return <p>{_.random(1, 6)}</p> }", errors: [error('lodash random()')] },
    { code: "import { sample } from 'lodash-es'; function Tip({ tips }) { return <p>{sample(tips)}</p> }", errors: [error('lodash sample()')] },
    { code: "import uniqueId from 'lodash/uniqueId'; function Item() { return <p>{uniqueId('x')}</p> }", errors: [error('lodash uniqueId()')] },
    { code: "import uniqueid from 'lodash.uniqueid'; function Item() { return <p>{uniqueid()}</p> }", errors: [error('lodash uniqueId()')] },
    { code: "import { randomInt } from 'node:crypto'; function Dice() { return <p>{randomInt(6)}</p> }", errors: [error('crypto.randomInt()')] },
    { code: "import crypto from 'crypto'; function Item() { return <p>{crypto.randomUUID()}</p> }", errors: [error('crypto.randomUUID()')] },
    // Render-time callbacks.
    { code: 'function Item() { const [seed] = useState(() => Math.random()); return <p>{seed}</p> }', errors: [error('Math.random()')] },
    { code: 'function Item() { const [s] = useReducer(reducer, null, () => ({ seed: Math.random() })); return null }', errors: [error('Math.random()')] },
    { code: 'function Items({ list }) { return list.map((x) => <p key={x}>{Math.random()}</p>) }', errors: [error('Math.random()')] },
    { code: 'function Item() { const v = useMemo(() => Math.random(), []); return <p>{v}</p> }', errors: [error('Math.random()')] },
    { code: 'function Item() { const ref = useRef(Math.random()); return <p>{ref.current}</p> }', errors: [error('Math.random()')] },
    { code: 'function useSeed() { return Math.random() }', errors: [error('Math.random()')] },
    { code: 'class Item extends Component { render() { return <p>{Math.random()}</p> } }', errors: [error('Math.random()')] },
    { code: 'const Item = memo(function () { return <p>{Math.random() > 0.5 ? "a" : "b"}</p> })', errors: [error('Math.random()')] },
    nextApp('app/widgets/Item.jsx', { code: "'use client';\nexport function Item() { return <p>{Math.random()}</p> }", errors: [error('Math.random()')] }),
  ],
});

tsxTester.run('no-random-in-render (TypeScript)', rule, {
  valid: [
    tsx({ code: 'const Item = <T,>(props: { items: T[] }) => { useEffect(() => { void Math.random(); }, []); return null; };' }),
    tsx({ code: "import type { v4 } from 'uuid'; const Item: FC = () => <p>ok</p>;" }),
  ],
  invalid: [
    tsx({ code: 'const Item: FC = () => { const n = Math.random() as number; return <p>{n}</p>; };', errors: [error('Math.random()')] }),
    tsx({ code: 'function useSeed(): number { return Math.random(); }', errors: [error('Math.random()')] }),
    tsx({ code: "import { v4 } from 'uuid'; const Item = ({ label }: Props) => <p>{label satisfies string}{v4()!}</p>;", errors: [error('uuid v4()')] }),
  ],
});
