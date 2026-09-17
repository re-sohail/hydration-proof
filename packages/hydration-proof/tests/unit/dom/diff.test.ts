import { describe, expect, it } from 'vitest';
import { diffTrees } from '../../../src/dom/diff.ts';
import { normalizeTree } from '../../../src/dom/normalize.ts';
import { comment, doc, el, resetIds, text } from '../../helpers/tree.ts';

describe('diffTrees (identity)', () => {
  it('reports nothing for identical trees', () => {
    const tree = doc([el('p', { id: 'x' }, [text('hi', 3)], 2)]);
    expect(diffTrees(tree, structuredClone(tree), { identity: true })).toEqual([]);
  });

  it('finds the text change inside a branch React recreated', () => {
    const before = doc([el('main', {}, [el('p', { id: 'env' }, [text('server', 3)], 2)], 1)]);
    const after = doc([el('main', {}, [el('p', { id: 'env' }, [text('client', 13)], 12)], 1)]);
    const changes = diffTrees(before, after, { identity: true });
    expect(changes.map((change) => change.kind)).toEqual(['replace', 'text']);
    expect(changes[1]).toMatchObject({ from: 'server', to: 'client', within: 0, afterElement: 12 });
  });

  it('reports attribute changes on reused nodes', () => {
    const before = doc([el('div', { class: 'light' }, [], 2)]);
    const after = doc([el('div', { class: 'dark' }, [], 2)]);
    expect(diffTrees(before, after, { identity: true })).toEqual([
      expect.objectContaining({ kind: 'attribute', attribute: 'class', from: 'light', to: 'dark' }),
    ]);
  });

  it('turns a swapped element into a tag change', () => {
    const before = doc([el('main', {}, [el('section', { id: 'branch' }, [], 2)], 1)]);
    const after = doc([el('main', {}, [el('aside', { id: 'branch' }, [], 3)], 1)]);
    const changes = diffTrees(before, after, { identity: true });
    expect(changes).toEqual([expect.objectContaining({ kind: 'tag', from: 'section', to: 'aside' })]);
  });

  it('reports inserted and removed nodes', () => {
    const before = doc([el('ul', {}, [el('li', {}, [], 2)], 1)]);
    const after = doc([el('ul', {}, [el('li', {}, [], 2), el('li', { id: 'new' }, [], 5)], 1)]);
    expect(diffTrees(before, after, { identity: true })).toEqual([
      expect.objectContaining({ kind: 'insert', afterElement: 5 }),
    ]);
    expect(diffTrees(after, before, { identity: true })).toEqual([
      expect.objectContaining({ kind: 'remove', beforeElement: 5 }),
    ]);
  });
});

describe('diffTrees (structural)', () => {
  it('ignores React markers after normalization and merges split text', () => {
    resetIds();
    const server = doc([el('p', {}, [text('Hello'), comment(' '), text(' '), comment(' '), el('b', {}, [text('world')])])]);
    const client = doc([el('p', {}, [text('Hello '), el('b', {}, [text('world')])])]);
    const a = normalizeTree(server).tree;
    const b = normalizeTree(client).tree;
    expect(diffTrees(a, b, { identity: false })).toEqual([]);
  });

  it('detects a missing whitespace text node', () => {
    resetIds();
    const server = normalizeTree(doc([el('p', {}, [text('Hello'), el('b', {}, [text('world')])])])).tree;
    const client = normalizeTree(doc([el('p', {}, [text('Hello'), text(' '), el('b', {}, [text('world')])])])).tree;
    expect(diffTrees(server, client, { identity: false })).toEqual([
      expect.objectContaining({ kind: 'text', from: 'Hello', to: 'Hello ' }),
    ]);
  });
});
