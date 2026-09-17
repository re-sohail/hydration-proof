import type { MutationBatch, MutationEntry, SFragment, SNode, SParent } from '../shared/protocol.ts';
import { childrenOf, cloneTree, getAttr, indexTree, isElement, isText, isComment, setAttr, type TreeIndex } from './tree.ts';

// Rebuild the DOM as it was before a set of mutation batches, starting from a
// snapshot taken after them. Entries are undone in reverse order on a copy.

export interface RewindResult {
  tree: SFragment;
  /** Entries that referenced nodes the snapshot does not contain. */
  unresolved: number;
}

function unindex(index: TreeIndex, node: SNode): void {
  index.delete(node.id);
  const children = childrenOf(node);
  if (children) for (const child of children) unindex(index, child);
}

function undo(entry: MutationEntry, index: TreeIndex): boolean {
  const located = index.get(entry.target);
  if (!located) return false;
  const target = located.node;

  if (entry.t === 'attr') {
    if (!isElement(target)) return false;
    const name = entry.ns ? (target.attrs.find(([key]) => key.endsWith(`:${entry.name}`))?.[0] ?? entry.name) : entry.name;
    setAttr(target, name, entry.old);
    return true;
  }

  if (entry.t === 'text') {
    if (!isText(target) && !isComment(target)) return false;
    target.text = entry.old;
    return true;
  }

  const children = childrenOf(target);
  if (!children) return false;
  const parent = target as SParent;
  let ok = true;

  if (entry.added.length > 0) {
    const added = new Set(entry.added);
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i]!;
      if (added.has(child.id)) {
        children.splice(i, 1);
        unindex(index, child);
        added.delete(child.id);
      }
    }
    if (added.size > 0) ok = false;
  }

  if (entry.removed.length > 0) {
    let at: number;
    if (entry.prev !== null) {
      const prev = children.findIndex((child) => child.id === entry.prev);
      at = prev >= 0 ? prev + 1 : -1;
    } else if (entry.next !== null) {
      at = children.findIndex((child) => child.id === entry.next);
    } else {
      at = 0;
    }
    if (at < 0) {
      ok = false;
      at = children.length;
    }
    const restored = cloneTree({ k: 11, id: 0, children: entry.removed } as SFragment).children;
    children.splice(at, 0, ...restored);
    for (const node of restored) indexTree(node, index, parent);
  }
  return ok;
}

export function rewind(tree: SFragment, batches: readonly MutationBatch[]): RewindResult {
  const copy = cloneTree(tree);
  const index = indexTree(copy);
  let unresolved = 0;
  for (let b = batches.length - 1; b >= 0; b--) {
    const entries = batches[b]!.entries ?? [];
    for (let e = entries.length - 1; e >= 0; e--) {
      if (!undo(entries[e]!, index)) unresolved++;
    }
  }
  return { tree: copy, unresolved };
}

/** Attribute value helper re-exported for callers that only import rewind. */
export { getAttr };
