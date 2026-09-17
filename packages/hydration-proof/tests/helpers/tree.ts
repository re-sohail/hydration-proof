import type { SElement, SFragment, SNode } from '../../src/shared/protocol.ts';

// Compact builders for serialized trees in unit tests.
let nextId = 1000;

export function resetIds(start = 1000): void {
  nextId = start;
}

export function el(tag: string, attrs: Record<string, string> = {}, children: SNode[] = [], id = nextId++): SElement {
  return { k: 1, id, tag, attrs: Object.entries(attrs), children };
}

export function text(value: string, id = nextId++): SNode {
  return { k: 3, id, text: value };
}

export function comment(value: string, id = nextId++): SNode {
  return { k: 8, id, text: value };
}

export function doc(children: SNode[], id = 1): SFragment {
  return { k: 9, id, children };
}
