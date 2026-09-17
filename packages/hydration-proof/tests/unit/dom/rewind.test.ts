import { describe, expect, it } from 'vitest';
import { rewind } from '../../../src/dom/rewind.ts';
import type { MutationBatch } from '../../../src/shared/protocol.ts';
import { doc, el, resetIds, text } from '../../helpers/tree.ts';

describe('rewind', () => {
  it('undoes attribute, text and child changes in reverse order', () => {
    resetIds();
    // After: <div id=root class=b><span>client</span></div>
    const after = doc([el('div', { id: 'root', class: 'b' }, [el('span', {}, [text('client', 11)], 10)], 2)]);
    const batch: MutationBatch = {
      seq: 1,
      phase: 'hydration-commit',
      time: 0,
      entries: [
        // server <p>server</p> removed, <span> inserted
        {
          t: 'child',
          target: 2,
          prev: null,
          next: null,
          added: [],
          removed: [el('p', {}, [text('server', 21)], 20)],
        },
        { t: 'child', target: 2, prev: null, next: null, added: [10], removed: [] },
        { t: 'attr', target: 2, name: 'class', old: 'a' },
      ],
    };
    const { tree, unresolved } = rewind(after, [batch]);
    expect(unresolved).toBe(0);
    expect(tree).toEqual(doc([el('div', { id: 'root', class: 'a' }, [el('p', {}, [text('server', 21)], 20)], 2)]));
    // The input is not modified.
    expect(after.children[0]).toMatchObject({ attrs: [['id', 'root'], ['class', 'b']] });
  });

  it('restores removed nodes next to their siblings', () => {
    const after = doc([el('ul', {}, [el('li', {}, [], 3), el('li', {}, [], 5)], 2)]);
    const batch: MutationBatch = {
      seq: 1,
      phase: 'hydration-commit',
      time: 0,
      entries: [{ t: 'child', target: 2, prev: 3, next: 5, added: [], removed: [el('li', { id: 'gone' }, [], 4)] }],
    };
    const { tree } = rewind(after, [batch]);
    const ids = (tree.children[0] as { children: { id: number }[] }).children.map((node) => node.id);
    expect(ids).toEqual([3, 4, 5]);
  });

  it('counts entries it cannot resolve', () => {
    const after = doc([el('div', {}, [], 2)]);
    const batch: MutationBatch = { seq: 1, phase: 'hydration-commit', time: 0, entries: [{ t: 'attr', target: 99, name: 'x', old: null }] };
    expect(rewind(after, [batch]).unresolved).toBe(1);
  });
});
