import type { NodeId } from '../shared/protocol.ts';
import { NativeWeakMap } from './env.ts';

// Node identity survives across snapshots and mutation records, so the engine
// can tell a node React reused from one it replaced.
const ids: WeakMap<Node, NodeId> = new NativeWeakMap();
const nodes: Map<NodeId, WeakRef<Node>> = new Map();
let nextId = 1;

export function idOf(node: Node): NodeId {
  let id = ids.get(node);
  if (id === undefined) {
    id = nextId++;
    ids.set(node, id);
    nodes.set(id, new WeakRef(node));
  }
  return id;
}

/** The node with this id, if it is still alive. */
export function nodeById(id: NodeId): Node | undefined {
  return nodes.get(id)?.deref();
}

export function knownId(node: Node | null): NodeId | null {
  if (node === null) return null;
  return idOf(node);
}
