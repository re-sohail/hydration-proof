import { describe, expect, it } from 'vitest';
import { normalizeTree, sameClassList, sameStyle } from '../../../src/dom/normalize.ts';
import { comment, doc, el, resetIds, text } from '../../helpers/tree.ts';

describe('normalizeTree', () => {
  it('drops React streaming artefacts and records what it dropped', () => {
    resetIds();
    const tree = doc([
      el('div', {}, [
        comment('$'),
        el('p', {}, [text('content')]),
        comment('/$'),
        el('template', { id: 'B:0' }),
        el('div', { hidden: '', id: 'S:0' }, [el('p', {}, [text('segment')])]),
        el('script', {}, [text('$RC("B:0","S:0")')]),
        el('script', {}, [text('function $RC(a,b){}')]),
        el('script', {}, [text('console.log(1)')]),
      ]),
    ]);
    const { tree: out, dropped } = normalizeTree(tree);
    const div = out.children[0] as { children: { tag?: string }[] };
    expect(div.children.map((node) => node.tag)).toEqual(['p', 'script']);
    expect(new Set(dropped.values())).toEqual(new Set(['react-comment', 'react-stream-holder', 'react-stream-script']));
  });

  it('masks nonce values and keeps <noscript> opaque', () => {
    resetIds();
    const a = normalizeTree(doc([el('script', { nonce: 'abc' }), el('noscript', {}, [el('img', { src: 'x' })])])).tree;
    const b = normalizeTree(doc([el('script', { nonce: 'xyz' }), el('noscript', {}, [text('<img src="x">')])])).tree;
    expect((a.children[0] as { attrs: unknown }).attrs).toEqual([['nonce', '<masked>']]);
    expect(a.children[1]).toMatchObject({ children: [] });
    expect(b.children[1]).toMatchObject({ children: [] });
  });

  it('compares classes and styles semantically', () => {
    expect(sameClassList('a  b', 'b a')).toBe(true);
    expect(sameClassList('a', 'a b')).toBe(false);
    expect(sameStyle('color:red;width:10px', 'width: 10px; color: red;')).toBe(true);
    expect(sameStyle('color:red', 'color:blue')).toBe(false);
  });
});
