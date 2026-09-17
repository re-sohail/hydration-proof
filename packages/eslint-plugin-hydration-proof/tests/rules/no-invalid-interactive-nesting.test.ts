import { noInvalidInteractiveNesting as rule } from '../../src/rules/no-invalid-interactive-nesting.ts';
import { jsxTester, nextApp, tsx, tsxTester } from '../helpers.ts';

const render = (jsx: string) => `function View({ items, open, kind, rows }) { return (${jsx}) }`;
const error = (messageId: string, child: string, parent: string) => ({ messageId, data: { child, parent } });

jsxTester.run('no-invalid-interactive-nesting', rule, {
  valid: [
    render('<p><span>text</span> <strong>bold</strong></p>'),
    render('<div><p>paragraph</p></div>'),
    render('<a href="/"><span>Go</span></a>'),
    render('<button><svg><path d="M0 0" /></svg></button>'),
    render('<svg><a href="#"><a href="#x" /></a></svg>'),
    render('<table><tbody><tr><td>1</td></tr></tbody></table>'),
    render('<table><thead><tr><th>h</th></tr></thead></table>'),
    render('<table><caption>c</caption><colgroup /><tbody /></table>'),
    render('<ul><li>item</li></ul>'),
    render('<li>alone: the parent is decided by another component</li>'),
    render('<p><Card /></p>'),
    render('<p><Card><div>children are placed by Card</div></Card></p>'),
    render('<a href="/"><Link><a href="/x">x</a></Link></a>'),
    render('<a href="/"><Tooltip content={<a href="#">x</a>} /></a>'),
    render('<p><button><div>not a direct block in p</div></button></p>'),
    render('<p><object><div /></object></p>'),
    render('<button><input type="hidden" name="x" /></button>'),
    render('<button><input type={kind} /></button>'),
    render('<a href="/"><video src="clip.mp4" /></a>'),
    render('<a href="/"><audio src="a.mp3" controls={false} /></a>'),
    render('<form><fieldset><input /></fieldset></form>'),
    render('<label>Name <input /></label>'),
    render('<p>{open ? <span /> : <em />}</p>'),
    render('<details><summary>More</summary><div /></details>'),
    render('<div>{items.map((item) => <p key={item}>{item}</p>)}</div>'),
    'function Item() { return <div>block</div> } function View() { return <p><Item /></p> }',
  ],
  invalid: [
    { code: render('<p><div>x</div></p>'), errors: [error('blockInParagraph', 'div', 'p')] },
    { code: render('<p><span><ul /></span></p>'), errors: [error('blockInParagraph', 'ul', 'p')] },
    { code: render('<p><>{items.map((i) => <section key={i} />)}</></p>'), errors: [error('blockInParagraph', 'section', 'p')] },
    { code: render('<p>{items.map((i) => { return <div key={i} /> })}</p>'), errors: [error('blockInParagraph', 'div', 'p')] },
    { code: render('<p>{open && <div />}</p>'), errors: [error('blockInParagraph', 'div', 'p')] },
    { code: render('<p>{[<h2 key="a" />]}</p>'), errors: [error('blockInParagraph', 'h2', 'p')] },
    { code: render('<p><Fragment><h2 /></Fragment></p>'), errors: [error('blockInParagraph', 'h2', 'p')] },
    { code: render('<p><React.Fragment><hr /></React.Fragment></p>'), errors: [error('blockInParagraph', 'hr', 'p')] },
    { code: render('<p><p>nested</p></p>'), errors: [error('blockInParagraph', 'p', 'p')] },
    { code: render('<p><table /></p>'), errors: [error('blockInParagraph', 'table', 'p')] },
    { code: render('<p><button /><div /></p>'), errors: [error('blockInParagraph', 'div', 'p')] },
    { code: render('<p><blockquote /><pre /><figure /><main /></p>'), errors: ['blockquote', 'pre', 'figure', 'main'].map((tag) => error('blockInParagraph', tag, 'p')) },
    { code: render('<a href="/"><a href="/x">x</a></a>'), errors: [error('nestedSame', 'a', 'a')] },
    { code: render('<a href="/"><span><a href="/x">x</a></span></a>'), errors: [error('nestedSame', 'a', 'a')] },
    { code: render('<button><button /></button>'), errors: [error('nestedSame', 'button', 'button')] },
    { code: render('<form><div><form /></div></form>'), errors: [error('nestedSame', 'form', 'form')] },
    { code: render('<label><label /></label>'), errors: [error('nestedSame', 'label', 'label')] },
    { code: render('<button><a href="#">x</a></button>'), errors: [error('interactive', 'a', 'button')] },
    { code: render('<a href="/"><button>x</button></a>'), errors: [error('interactive', 'button', 'a')] },
    { code: render('<a href="/"><input /></a>'), errors: [error('interactive', 'input', 'a')] },
    { code: render('<button><input type="checkbox" /></button>'), errors: [error('interactive', 'input', 'button')] },
    {
      code: render(
        '<button><select /><textarea /><label /><details /><iframe /><embed /><video controls /><audio controls={true} /></button>',
      ),
      errors: ['select', 'textarea', 'label', 'details', 'iframe', 'embed', 'video', 'audio'].map((tag) => error('interactive', tag, 'button')),
    },
    { code: render('<a href="/"><div><span><select /></span></div></a>'), errors: [error('interactive', 'select', 'a')] },
    { code: render('<table><tr><td>1</td></tr></table>'), errors: [error('tableRow', 'tr', 'table')] },
    { code: render('<table>{rows.map((r) => <tr key={r} />)}</table>'), errors: [error('tableRow', 'tr', 'table')] },
    { code: render('<table><>{open && <tr />}</></table>'), errors: [error('tableRow', 'tr', 'table')] },
    { code: render('<table><tbody><td /></tbody></table>'), errors: [error('tableCell', 'td', 'tbody')] },
    { code: render('<thead><th /></thead>'), errors: [error('tableCell', 'th', 'thead')] },
    // Server Components still hydrate the elements they render.
    nextApp('app/page.jsx', { code: 'export default function Page() { return <p><div /></p> }', errors: [error('blockInParagraph', 'div', 'p')] }),
    nextApp('app/layout.jsx', { code: 'export default function Layout() { return <a href="/"><a href="/x" /></a> }', errors: [error('nestedSame', 'a', 'a')] }),
  ],
});

tsxTester.run('no-invalid-interactive-nesting (TypeScript)', rule, {
  valid: [tsx({ code: 'const View: FC = () => <p><span>{(<em />) as JSX.Element}</span></p>;' })],
  invalid: [
    tsx({ code: 'const View: FC = () => <p>{(<div />) as JSX.Element}</p>;', errors: [error('blockInParagraph', 'div', 'p')] }),
    tsx({
      code: 'function View<T extends { id: string }>({ items }: { items: T[] }) { return <button>{items.map((item: T) => <a key={item.id} href="#" />)}</button>; }',
      errors: [error('interactive', 'a', 'button')],
    }),
  ],
});
