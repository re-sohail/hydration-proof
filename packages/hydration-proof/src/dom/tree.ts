import {
  COMMENT,
  DOCTYPE,
  ELEMENT,
  TEXT,
  type NodeId,
  type SElement,
  type SFragment,
  type SNode,
  type SParent,
} from '../shared/protocol.ts';

export type AnyNode = SNode | SFragment;

export interface Located {
  node: AnyNode;
  parent: SParent | undefined;
}

export type TreeIndex = Map<NodeId, Located>;

export function isElement(node: AnyNode | undefined): node is SElement {
  return node !== undefined && node.k === ELEMENT;
}

export function isText(node: AnyNode | undefined): node is Extract<SNode, { k: typeof TEXT }> {
  return node !== undefined && node.k === TEXT;
}

export function isComment(node: AnyNode | undefined): node is Extract<SNode, { k: typeof COMMENT }> {
  return node !== undefined && node.k === COMMENT;
}

export function isDoctype(node: AnyNode | undefined): node is Extract<SNode, { k: typeof DOCTYPE }> {
  return node !== undefined && node.k === DOCTYPE;
}

export function childrenOf(node: AnyNode): SNode[] | undefined {
  return node.k === ELEMENT || node.k === 9 || node.k === 11 ? node.children : undefined;
}

export function cloneTree<T extends AnyNode>(tree: T): T {
  return structuredClone(tree);
}

export function indexTree(tree: AnyNode, index: TreeIndex = new Map(), parent?: SParent): TreeIndex {
  index.set(tree.id, { node: tree, parent });
  const children = childrenOf(tree);
  if (children) {
    for (const child of children) indexTree(child, index, tree as SParent);
  }
  return index;
}

export function walk(node: AnyNode, visit: (node: AnyNode, parent: SParent | undefined) => void | false, parent?: SParent): void {
  if (visit(node, parent) === false) return;
  const children = childrenOf(node);
  if (children) for (const child of children) walk(child, visit, node as SParent);
}

export function getAttr(node: SElement, name: string): string | null {
  const lower = name.toLowerCase();
  for (const [key, value] of node.attrs) if (key.toLowerCase() === lower) return value;
  return null;
}

export function setAttr(node: SElement, name: string, value: string | null): void {
  const at = node.attrs.findIndex(([key]) => key === name);
  if (value === null) {
    if (at >= 0) node.attrs.splice(at, 1);
  } else if (at >= 0) {
    node.attrs[at] = [name, value];
  } else {
    node.attrs.push([name, value]);
  }
}

export function textContent(node: AnyNode): string {
  if (node.k === TEXT) return node.text;
  const children = childrenOf(node);
  if (!children) return '';
  let out = '';
  for (const child of children) if (child.k === TEXT || child.k === ELEMENT) out += textContent(child);
  return out;
}

export function findElement(tree: AnyNode, predicate: (el: SElement) => boolean): SElement | undefined {
  let found: SElement | undefined;
  walk(tree, (node) => {
    if (found) return false;
    if (isElement(node) && predicate(node)) {
      found = node;
      return false;
    }
    return undefined;
  });
  return found;
}

export function elementLabel(el: SElement): string {
  let label = el.tag;
  const id = getAttr(el, 'id');
  if (id) label += `#${id}`;
  const classes = (getAttr(el, 'class') ?? '').split(/\s+/).filter(Boolean).slice(0, 2);
  for (const name of classes) label += `.${name}`;
  return label;
}

/** Labels from the outermost element down to `id` (inclusive). */
export function domPath(index: TreeIndex, id: NodeId): string[] {
  const path: string[] = [];
  let current = index.get(id);
  while (current) {
    if (isElement(current.node)) path.unshift(elementLabel(current.node));
    else if (isText(current.node)) path.unshift('#text');
    if (!current.parent) break;
    current = index.get(current.parent.id);
  }
  return path;
}

function cssEscape(value: string): string {
  return value.replace(/([^a-zA-Z0-9_-])/g, '\\$1').replace(/^(\d)/, '\\3$1 ');
}

/**
 * A CSS selector for the element `id` (or the parent element of a text
 * node): the nearest ancestor with a unique id, then `:nth-of-type` steps.
 */
export function cssSelector(index: TreeIndex, id: NodeId, ids?: Map<string, number>): string {
  const counts = ids ?? idCounts(index);
  let located = index.get(id);
  if (located && !isElement(located.node) && located.parent) located = index.get(located.parent.id);
  const steps: string[] = [];
  while (located && isElement(located.node)) {
    const el = located.node;
    const elId = getAttr(el, 'id');
    if (elId && counts.get(elId) === 1) {
      steps.unshift(`#${cssEscape(elId)}`);
      return steps.join(' > ');
    }
    if (el.tag === 'html' || el.tag === 'body' || el.tag === 'head') {
      steps.unshift(el.tag);
      return steps.join(' > ');
    }
    const parent = located.parent;
    let step = el.tag;
    if (parent) {
      const same = parent.children.filter((child): child is SElement => isElement(child) && child.tag === el.tag);
      if (same.length > 1) step += `:nth-of-type(${same.indexOf(el) + 1})`;
    }
    steps.unshift(step);
    located = parent ? index.get(parent.id) : undefined;
  }
  return steps.join(' > ');
}

export function idCounts(index: TreeIndex): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { node } of index.values()) {
    if (!isElement(node)) continue;
    const id = getAttr(node, 'id');
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

/** Short HTML-like rendering, for reports. */
export function outline(node: AnyNode, maxLength = 160): string {
  let out: string;
  if (isElement(node)) {
    const attrs = node.attrs.map(([key, value]) => (value === '' ? ` ${key}` : ` ${key}="${value}"`)).join('');
    const inner = textContent(node).replace(/\s+/g, ' ').trim();
    out = `<${node.tag}${attrs}>${inner}</${node.tag}>`;
  } else if (isText(node)) {
    out = JSON.stringify(node.text);
  } else if (isComment(node)) {
    out = `<!--${node.text}-->`;
  } else {
    out = node.k === DOCTYPE ? '<!DOCTYPE>' : '#document';
  }
  return out.length > maxLength ? `${out.slice(0, maxLength - 1)}…` : out;
}
