import { noUnstableId as rule } from '../../src/rules/no-unstable-id.ts';
import { jsxTester, nextApp, tsx, tsxTester } from '../helpers.ts';

const error = (source: string, sink: string) => ({ messageId: 'unstableId', data: { source, sink } });

jsxTester.run('no-unstable-id', rule, {
  valid: [
    'function Field() { const id = useId(); return <><label htmlFor={id}>Name</label><input id={id} /></> }',
    'function Field({ id }) { return <input id={id} /> }',
    'function Field() { return <input id="email" name="email" /> }',
    "import { nanoid } from 'nanoid'; function Field() { const [id, setId] = useState(''); useEffect(() => setId(nanoid()), []); return <input id={id} /> }",
    'function Field() { const ref = useRef(null); return <input id={ref.current} /> }',
    // Not id attributes: no-random-in-render reports these.
    'function Field() { return <div data-seed={Math.random()} /> }',
    'function Field() { return <div name={Math.random()} /> }',
    'function Field() { return <Field label={String(Math.random())} /> }',
    'function Field() { const id = Math.random(); return <input id={useId()} /> }',
    'function Field() { const [seed] = useState(() => Math.random()); return <p>{seed}</p> }',
    // Counters only written after hydration.
    'let counter = 0; function Field() { useEffect(() => { counter++ }); return <input id={`f-${counter}`} /> }',
    // A counter changed by another component is no-global-render-counter's.
    'let counter = 0; function Tick() { counter++; return null } function Field() { return <input id={`f-${counter}`} /> }',
    'let counter = 0; function Field() { const total = counter; counter = total; return <input id="static" /> }',
    // Values computed in handlers.
    'function Field() { return <button onClick={() => open(`dialog-${Math.random()}`)} aria-controls="dialog">Open</button> }',
    'function Field() { const makeId = () => Math.random(); return <input id={String(makeId)} /> }',
    // Deterministic ids.
    'function Field({ name }) { return <input id={`field-${name}`} /> }',
    "import { v5 } from 'uuid'; function Field({ name }) { return <input id={v5(name, NS)} /> }",
    nextApp('app/page.jsx', { code: 'export default function Page() { return <input id={String(Math.random())} /> }' }),
  ],
  invalid: [
    { code: 'function Field() { return <input id={`field-${Math.random()}`} /> }', errors: [error('Math.random()', 'id')] },
    {
      code: 'function Field() { const id = Math.random().toString(36).slice(2); return <><label htmlFor={id}>Name</label><input id={id} /></> }',
      errors: [error('Math.random()', 'htmlFor')],
    },
    { code: 'function Field() { const [id] = useState(() => crypto.randomUUID()); return <input id={id} /> }', errors: [error('crypto.randomUUID()', 'id')] },
    { code: 'function Field() { const [inputId] = useState(`in-${Date.now()}`); return <p>{inputId}</p> }', errors: [error('Date.now()', 'inputId')] },
    { code: 'function Field() { const idRef = useRef(`input-${Date.now()}`); return <input id={idRef.current} /> }', errors: [error('Date.now()', 'idRef')] },
    { code: 'function Field() { const ref = useRef(Math.random()); return <input id={String(ref.current)} /> }', errors: [error('Math.random()', 'id')] },
    { code: "import { nanoid } from 'nanoid'; function Help() { return <div aria-describedby={nanoid()} /> }", errors: [error('nanoid()', 'aria-describedby')] },
    {
      code: "import uniqueId from 'lodash/uniqueId'; function Field() { const id = useMemo(() => uniqueId('field-'), []); return <input id={id} /> }",
      errors: [error('lodash uniqueId()', 'id')],
    },
    {
      code: "import { v4 } from 'uuid'; function Menu() { const menuId = v4(); return <><button aria-controls={menuId} /><ul id={menuId} /></> }",
      errors: [error('uuid v4()', 'aria-controls')],
    },
    {
      code: 'let nextId = 0; function Field() { const id = `field-${nextId++}`; return <input id={id} /> }',
      errors: [error('module-level counter `nextId`', 'id')],
    },
    { code: 'let count = 0; function Field() { count += 1; return <input id={"f" + count} /> }', errors: [error('module-level counter `count`', 'id')] },
    { code: 'function Field() { return <input name={`q-${Date.now()}`} /> }', errors: [error('Date.now()', 'name')] },
    { code: 'function Field() { return <select name={String(performance.now())} /> }', errors: [error('performance.now()', 'name')] },
    { code: 'function Field() { return <Tooltip triggerId={String(Math.random())} /> }', errors: [error('Math.random()', 'triggerId')] },
    { code: 'function Field() { return <label for={Math.random()}>x</label> }', errors: [error('Math.random()', 'for')] },
    { code: 'function List() { return <ul aria-activedescendant={`opt-${new Date().getTime()}`} /> }', errors: [error('new Date()', 'aria-activedescendant')] },
    { code: 'function Field() { return <input list={`l${Math.random()}`} /> }', errors: [error('Math.random()', 'list')] },
    { code: 'const seed = Math.random(); function Field() { return <input id={`f-${seed}`} /> }', errors: [error('Math.random()', 'id')] },
    {
      code: 'class Field extends Component { id = `f-${Math.random()}`; render() { return <input id={this.id} /> } }',
      errors: [error('Math.random()', 'id')],
    },
    {
      code: 'function Fields({ items }) { return items.map((item) => <input key={item} id={`${item}-${Math.random()}`} />) }',
      errors: [error('Math.random()', 'id')],
    },
    {
      code: 'function Field() { const suffix = (() => Math.random())(); const id = `f-${suffix}`; return <input aria-labelledby={id} /> }',
      errors: [error('Math.random()', 'aria-labelledby')],
    },
    nextApp('app/page.jsx', {
      code: "'use client';\nexport default function Page() { return <input id={String(Math.random())} /> }",
      errors: [error('Math.random()', 'id')],
    }),
  ],
});

tsxTester.run('no-unstable-id (TypeScript)', rule, {
  valid: [tsx({ code: 'const Field: FC<{ id: string }> = ({ id }) => <input id={id as string} />;' })],
  invalid: [
    tsx({
      code: 'const Field: FC = () => { const id = useMemo<string>(() => crypto.randomUUID(), []); return <input id={id as string} />; };',
      errors: [error('crypto.randomUUID()', 'id')],
    }),
    tsx({
      code: "import { nanoid } from 'nanoid'; export function Field(): JSX.Element { const [id] = useState<string>(() => nanoid()); return <input id={id!} />; }",
      errors: [error('nanoid()', 'id')],
    }),
    tsx({
      code: 'let seq: number = 0; const Field = (() => <input id={`f${(seq++) satisfies number}`} />) satisfies FC;',
      errors: [error('module-level counter `seq`', 'id')],
    }),
  ],
});
