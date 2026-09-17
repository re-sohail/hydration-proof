import { ELEMENT, TEXT, type FormState, type SElement, type SNode, type SParent } from '../shared/protocol.ts';
import { myers } from './myers.ts';
import { getAttr, isElement, isText } from './tree.ts';

// Tree diff between two DOM stages.
//
// Identity mode is used for two snapshots of the same page: nodes are matched
// by runtime id, so a node React reused is compared in place and a node React
// recreated shows up as a replacement whose contents are then compared
// structurally (that is where the actual server/client values are found).

export type ChangeKind = 'text' | 'attribute' | 'tag' | 'insert' | 'remove' | 'replace' | 'form';

export interface DomChange {
  kind: ChangeKind;
  before?: SNode;
  after?: SNode;
  /** Id of the element the change belongs to, in each tree. */
  beforeElement?: number;
  afterElement?: number;
  attribute?: string;
  from?: string | null;
  to?: string | null;
  /** Index of the enclosing `replace` change, for changes inside a recreated branch. */
  within?: number;
}

export interface DiffOptions {
  identity: boolean;
  /** Returns true when two attribute values are equivalent. */
  sameAttribute?: (name: string, from: string | null, to: string | null, element: SElement) => boolean;
  /** Stop after this many changes. */
  maxChanges?: number;
}

interface Context {
  identity: boolean;
  sameAttribute: NonNullable<DiffOptions['sameAttribute']>;
  max: number;
  changes: DomChange[];
}

const defaultSame = (_name: string, from: string | null, to: string | null): boolean => from === to;

function strictKey(node: SNode): string {
  if (node.k === ELEMENT) return `e:${node.tag}:${getAttr(node, 'id') ?? ''}`;
  return `n:${node.k}`;
}

function looseKey(node: SNode): string {
  return node.k === ELEMENT ? `e:${node.tag}` : `n:${node.k}`;
}

function push(ctx: Context, change: DomChange): number {
  if (ctx.changes.length >= ctx.max) return -1;
  ctx.changes.push(change);
  return ctx.changes.length - 1;
}

function compareForm(b: SElement, a: SElement, ctx: Context, within: number | undefined): void {
  if (!b.form || !a.form) return;
  for (const key of ['value', 'checked', 'selected', 'indeterminate'] as (keyof FormState)[]) {
    const from = b.form[key];
    const to = a.form[key];
    if (from === undefined || to === undefined || from === to) continue;
    push(ctx, {
      kind: 'form',
      before: b,
      after: a,
      beforeElement: b.id,
      afterElement: a.id,
      attribute: key,
      from: String(from),
      to: String(to),
      ...(within !== undefined ? { within } : {}),
    });
  }
}

function compareElements(b: SElement, a: SElement, ctx: Context, within: number | undefined): void {
  const names = new Set<string>();
  for (const [name] of b.attrs) names.add(name);
  for (const [name] of a.attrs) names.add(name);
  for (const name of names) {
    const from = getAttr(b, name);
    const to = getAttr(a, name);
    if (from === to || ctx.sameAttribute(name, from, to, a)) continue;
    push(ctx, {
      kind: 'attribute',
      before: b,
      after: a,
      beforeElement: b.id,
      afterElement: a.id,
      attribute: name,
      from,
      to,
      ...(within !== undefined ? { within } : {}),
    });
  }
  compareForm(b, a, ctx, within);
  diffChildren(b, a, ctx, within);
  if (b.content && a.content) {
    diffChildren({ ...b, children: b.content }, { ...a, children: a.content }, ctx, within);
  }
  if (b.shadow && a.shadow) {
    diffChildren({ ...b, children: b.shadow }, { ...a, children: a.shadow }, ctx, within);
  }
}

function compareNodes(b: SNode, a: SNode, bParent: SParent, aParent: SParent, ctx: Context, within: number | undefined): void {
  if (isElement(b) && isElement(a)) {
    if (b.tag !== a.tag) {
      push(ctx, { kind: 'tag', before: b, after: a, beforeElement: b.id, afterElement: a.id, from: b.tag, to: a.tag, ...(within !== undefined ? { within } : {}) });
      return;
    }
    compareElements(b, a, ctx, within);
    return;
  }
  if (isText(b) && isText(a) && b.text !== a.text) {
    push(ctx, {
      kind: 'text',
      before: b,
      after: a,
      beforeElement: bParent.id,
      afterElement: aParent.id,
      from: b.text,
      to: a.text,
      ...(within !== undefined ? { within } : {}),
    });
  }
}

function pairRun(
  removed: SNode[],
  inserted: SNode[],
  bParent: SParent,
  aParent: SParent,
  ctx: Context,
  within: number | undefined,
): void {
  if (removed.length === 0 && inserted.length === 0) return;
  const edits = myers(removed, inserted, (x, y) => looseKey(x) === looseKey(y));
  const lonelyRemoved: SNode[] = [];
  const lonelyInserted: SNode[] = [];
  for (const edit of edits) {
    if (edit.op === 'delete') {
      lonelyRemoved.push(removed[edit.a]!);
      continue;
    }
    if (edit.op === 'insert') {
      lonelyInserted.push(inserted[edit.b]!);
      continue;
    }
    const b = removed[edit.a]!;
    const a = inserted[edit.b]!;
    if (ctx.identity && isElement(b) && isElement(a) && b.id !== a.id) {
      // React recreated this element: record it, then compare the contents.
      const index = push(ctx, {
        kind: 'replace',
        before: b,
        after: a,
        beforeElement: b.id,
        afterElement: a.id,
        ...(within !== undefined ? { within } : {}),
      });
      const nested: Context = { ...ctx, identity: false };
      compareElements(b, a, nested, index >= 0 ? index : within);
      continue;
    }
    compareNodes(b, a, bParent, aParent, ctx, within);
  }

  // A single element swapped for another tag is a tag change, not two edits.
  const removedEls = lonelyRemoved.filter(isElement);
  const insertedEls = lonelyInserted.filter(isElement);
  if (removedEls.length === 1 && insertedEls.length === 1) {
    const b = removedEls[0]!;
    const a = insertedEls[0]!;
    push(ctx, { kind: 'tag', before: b, after: a, beforeElement: b.id, afterElement: a.id, from: b.tag, to: a.tag, ...(within !== undefined ? { within } : {}) });
    lonelyRemoved.splice(lonelyRemoved.indexOf(b), 1);
    lonelyInserted.splice(lonelyInserted.indexOf(a), 1);
  }
  for (const node of lonelyRemoved) {
    push(ctx, { kind: 'remove', before: node, beforeElement: node.k === TEXT ? bParent.id : node.id, afterElement: aParent.id, ...(within !== undefined ? { within } : {}) });
  }
  for (const node of lonelyInserted) {
    push(ctx, { kind: 'insert', after: node, beforeElement: bParent.id, afterElement: node.k === TEXT ? aParent.id : node.id, ...(within !== undefined ? { within } : {}) });
  }
}

function diffChildren(bParent: SParent, aParent: SParent, ctx: Context, within: number | undefined): void {
  const before = bParent.children;
  const after = aParent.children;
  const edits = myers(before, after, (x, y) => (ctx.identity ? x.id === y.id : strictKey(x) === strictKey(y)));
  let removed: SNode[] = [];
  let inserted: SNode[] = [];
  for (const edit of edits) {
    if (ctx.changes.length >= ctx.max) return;
    if (edit.op === 'equal') {
      // Structural diffs pair edits locally. Identity diffs collect them for
      // the whole parent: when React re-renders a container it keeps nodes it
      // does not own (scripts) and appends the new children after them.
      if (!ctx.identity) {
        pairRun(removed, inserted, bParent, aParent, ctx, within);
        removed = [];
        inserted = [];
      }
      compareNodes(before[edit.a]!, after[edit.b]!, bParent, aParent, ctx, within);
    } else if (edit.op === 'delete') {
      removed.push(before[edit.a]!);
    } else {
      inserted.push(after[edit.b]!);
    }
  }
  pairRun(removed, inserted, bParent, aParent, ctx, within);
}

export function diffTrees(before: SParent, after: SParent, options: DiffOptions): DomChange[] {
  const ctx: Context = {
    identity: options.identity,
    sameAttribute: options.sameAttribute ?? defaultSame,
    max: options.maxChanges ?? 5_000,
    changes: [],
  };
  diffChildren(before, after, ctx, undefined);
  return ctx.changes;
}
