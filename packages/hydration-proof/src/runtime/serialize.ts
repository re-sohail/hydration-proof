import {
  COMMENT,
  DOCTYPE,
  DOCUMENT,
  ELEMENT,
  FRAGMENT,
  TEXT,
  type FormState,
  type SComment,
  type SElement,
  type SFragment,
  type SNode,
  type SText,
} from '../shared/protocol.ts';
import { MATH_NS, NativeWeakMap, SVG_NS } from './env.ts';
import { idOf } from './ids.ts';

/** Marks nodes the runtime itself adds (the dev overlay); never serialized. */
export const OWN_NODE_ATTRIBUTE = 'data-hydration-proof-internal';

/** Closed shadow roots, recorded by the attachShadow patch. */
export const closedShadowRoots: WeakMap<Element, ShadowRoot> = new NativeWeakMap();

export interface SerializeHooks {
  element?(node: Element, out: SElement): void;
  text?(node: Text, out: SText): void;
}

function formState(el: Element): FormState | undefined {
  switch (el.localName) {
    case 'input': {
      const input = el as HTMLInputElement;
      const state: FormState = { value: input.value };
      if (input.type === 'checkbox' || input.type === 'radio') {
        state.checked = input.checked;
        if (input.indeterminate) state.indeterminate = true;
      }
      return state;
    }
    case 'textarea':
      return { value: (el as HTMLTextAreaElement).value };
    case 'option':
      return { selected: (el as HTMLOptionElement).selected };
    default:
      return undefined;
  }
}

function serializeElement(el: Element, hooks: SerializeHooks): SElement | null {
  if (el.hasAttribute(OWN_NODE_ATTRIBUTE)) return null;

  const attrs: [string, string][] = [];
  for (const attr of Array.from(el.attributes)) attrs.push([attr.name, attr.value]);

  const out: SElement = {
    k: ELEMENT,
    id: idOf(el),
    tag: el.localName,
    attrs,
    children: serializeChildren(el, hooks),
  };
  if (el.namespaceURI === SVG_NS) out.ns = 'svg';
  else if (el.namespaceURI === MATH_NS) out.ns = 'math';

  if (el.localName === 'template' && out.ns === undefined) {
    out.content = serializeChildren((el as HTMLTemplateElement).content, hooks);
  }
  const shadow = el.shadowRoot ?? closedShadowRoots.get(el);
  if (shadow) out.shadow = serializeChildren(shadow, hooks);

  const form = formState(el);
  if (form) out.form = form;

  hooks.element?.(el, out);
  return out;
}

export function serializeNode(node: Node, hooks: SerializeHooks = {}): SNode | null {
  switch (node.nodeType) {
    case Node.ELEMENT_NODE:
      return serializeElement(node as Element, hooks);
    case Node.TEXT_NODE:
    case Node.CDATA_SECTION_NODE: {
      const out: SText = { k: TEXT, id: idOf(node), text: (node as Text).data };
      hooks.text?.(node as Text, out);
      return out;
    }
    case Node.COMMENT_NODE: {
      const out: SComment = { k: COMMENT, id: idOf(node), text: (node as Comment).data };
      return out;
    }
    case Node.DOCUMENT_TYPE_NODE:
      return { k: DOCTYPE, id: idOf(node), name: (node as DocumentType).name };
    default:
      return null;
  }
}

export function serializeChildren(parent: Node, hooks: SerializeHooks = {}): SNode[] {
  const out: SNode[] = [];
  for (let child = parent.firstChild; child !== null; child = child.nextSibling) {
    const serialized = serializeNode(child, hooks);
    if (serialized !== null) out.push(serialized);
  }
  return out;
}

/** Serialize a document, fragment or a subtree root as a fragment. */
export function serializeRoot(root: Node, hooks: SerializeHooks = {}): SFragment {
  if (root.nodeType === Node.DOCUMENT_NODE) {
    return { k: DOCUMENT, id: idOf(root), children: serializeChildren(root, hooks) };
  }
  if (root.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    return { k: FRAGMENT, id: idOf(root), children: serializeChildren(root, hooks) };
  }
  const node = serializeNode(root, hooks);
  return { k: FRAGMENT, id: 0, children: node === null ? [] : [node] };
}
