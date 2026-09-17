import { TEXT, type SElement, type SFragment, type SNode } from '../shared/protocol.ts';
import { childrenOf, cloneTree, getAttr, isComment, isElement, isText } from './tree.ts';

// Normalization removes what is not content (framework markers, streaming
// holders, dev tooling) so two DOM stages can be compared meaningfully.
// Node ids are preserved; removed nodes are recorded, never silently lost.

export type MarkerAction = 'drop' | 'opaque';

export interface MarkerRule {
  id: string;
  /** Return an action for nodes this rule recognises. */
  match(node: SNode, parent: SElement | SFragment): MarkerAction | undefined;
}

export interface NormalizeOptions {
  markers: readonly MarkerRule[];
  /** Drop whitespace-only text between elements (outside pre/textarea). */
  dropInterElementWhitespace: boolean;
  /** Merge adjacent text nodes (after markers are gone). */
  mergeText: boolean;
  /** Attribute names (lower case) or patterns whose values are masked. */
  maskAttributes: readonly (string | RegExp)[];
  /** Attribute names (lower case) or patterns that are removed. */
  ignoreAttributes: readonly (string | RegExp)[];
}

export interface NormalizeResult {
  tree: SFragment;
  /** Ids of nodes that were dropped, with the rule that dropped them. */
  dropped: Map<number, string>;
}

const PRESERVE_WHITESPACE = new Set(['pre', 'textarea', 'listing', 'plaintext', 'code']);

// React's comment markers: Suspense ($, $?, $!, $~, /$), Activity (&, /&),
// text separators (a single space), form state (F!, F).
const REACT_COMMENT = /^(?:\/?\$[?!~]?|\/?&|F!?| )$/;
const REACT_HOLDER_ID = /(?:^|:)[SPB]:[0-9a-z]+$/i;
const REACT_RUNTIME_SCRIPT = /^\s*(?:(?:\$R[A-Z]\s*=)|(?:function\s+\$R[A-Z]\s*\()|\$R[A-Z]\s*\()/;
const REACT_TEMPLATE_DATA = ['data-rsi', 'data-rci', 'data-rri', 'data-rxi', 'data-sri'];

export const reactMarkers: MarkerRule[] = [
  {
    id: 'react-comment',
    match: (node) => (isComment(node) && REACT_COMMENT.test(node.text) ? 'drop' : undefined),
  },
  {
    id: 'react-stream-holder',
    match: (node) => {
      if (!isElement(node)) return undefined;
      const id = getAttr(node, 'id');
      if (node.tag === 'template') {
        if (id !== null && REACT_HOLDER_ID.test(id)) return 'drop';
        if (REACT_TEMPLATE_DATA.some((name) => getAttr(node, name) !== null)) return 'drop';
        if (getAttr(node, 'data-dgst') !== null) return 'drop';
      }
      if (id !== null && /(?:^|:)S:[0-9a-z]+$/i.test(id) && getAttr(node, 'hidden') !== null) return 'drop';
      return undefined;
    },
  },
  {
    id: 'react-stream-script',
    match: (node) => {
      if (!isElement(node) || node.tag !== 'script') return undefined;
      const first = node.children[0];
      return isText(first) && REACT_RUNTIME_SCRIPT.test(first.text) ? 'drop' : undefined;
    },
  },
];

export const genericMarkers: MarkerRule[] = [
  {
    // <noscript> content is raw text with scripting on and markup with it off.
    id: 'noscript',
    match: (node) => (isElement(node) && node.tag === 'noscript' ? 'opaque' : undefined),
  },
  {
    id: 'hydration-proof-internal',
    match: (node) => (isElement(node) && getAttr(node, 'data-hydration-proof-internal') !== null ? 'drop' : undefined),
  },
  {
    // Framework dev overlays mount into (script) hosts at the end of <body>.
    id: 'dev-tooling',
    match: (node) =>
      isElement(node) &&
      (node.tag === 'nextjs-portal' ||
        node.tag === 'vite-error-overlay' ||
        getAttr(node, 'data-nextjs-dev-overlay') !== null ||
        (node.tag === 'script' && node.children.some((child) => isElement(child) && child.tag === 'nextjs-portal')))
        ? 'drop'
        : undefined,
  },
];

function matches(name: string, patterns: readonly (string | RegExp)[]): boolean {
  for (const pattern of patterns) {
    if (typeof pattern === 'string' ? pattern === name : pattern.test(name)) return true;
  }
  return false;
}

export const DEFAULT_NORMALIZE: NormalizeOptions = {
  markers: [...reactMarkers, ...genericMarkers],
  dropInterElementWhitespace: false,
  mergeText: true,
  maskAttributes: ['nonce'],
  ignoreAttributes: [],
};

function normalizeChildren(
  parent: SElement | SFragment,
  options: NormalizeOptions,
  dropped: Map<number, string>,
): void {
  const children = parent.children;
  const out: SNode[] = [];
  const keepWhitespace = isElement(parent) && PRESERVE_WHITESPACE.has(parent.tag);
  for (const child of children) {
    let action: MarkerAction | undefined;
    let rule = '';
    for (const marker of options.markers) {
      action = marker.match(child, parent);
      if (action !== undefined) {
        rule = marker.id;
        break;
      }
    }
    if (action === 'drop') {
      dropped.set(child.id, rule);
      continue;
    }
    if (isElement(child)) {
      normalizeElement(child, options, dropped, action === 'opaque');
    }
    if (isText(child) && options.mergeText) {
      const last = out[out.length - 1];
      if (isText(last)) {
        last.text += child.text;
        if (child.client !== undefined || last.client !== undefined) {
          last.client = (last.client ?? last.text) + (child.client ?? child.text);
        }
        dropped.set(child.id, 'merged-text');
        continue;
      }
    }
    out.push(child);
  }
  if (options.dropInterElementWhitespace && !keepWhitespace) {
    parent.children = out.filter((node) => {
      if (node.k !== TEXT || node.text.trim() !== '') return true;
      dropped.set(node.id, 'whitespace');
      return false;
    });
  } else {
    parent.children = out;
  }
}

function normalizeElement(el: SElement, options: NormalizeOptions, dropped: Map<number, string>, opaque: boolean): void {
  if (options.ignoreAttributes.length > 0 || options.maskAttributes.length > 0) {
    const attrs: [string, string][] = [];
    for (const [name, value] of el.attrs) {
      const lower = name.toLowerCase();
      if (matches(lower, options.ignoreAttributes)) continue;
      attrs.push([name, matches(lower, options.maskAttributes) ? '<masked>' : value]);
    }
    el.attrs = attrs;
  }
  if (opaque) {
    // Content is parsed differently depending on scripting; never compared.
    for (const child of el.children) dropped.set(child.id, 'opaque');
    el.children = [];
    return;
  }
  if (el.content) {
    const fragment: SFragment = { k: 11, id: -el.id, children: el.content };
    normalizeChildren(fragment, options, dropped);
    el.content = fragment.children;
  }
  if (el.shadow) {
    const fragment: SFragment = { k: 11, id: -el.id, children: el.shadow };
    normalizeChildren(fragment, options, dropped);
    el.shadow = fragment.children;
  }
  normalizeChildren(el, options, dropped);
}

export function normalizeTree(tree: SFragment, options: NormalizeOptions = DEFAULT_NORMALIZE): NormalizeResult {
  const copy = cloneTree(tree);
  const dropped = new Map<number, string>();
  normalizeChildren(copy, options, dropped);
  return { tree: copy, dropped };
}

/** Normalize a detached subtree (e.g. a replaced branch) the same way. */
export function normalizeNode(node: SNode, options: NormalizeOptions = DEFAULT_NORMALIZE): SNode {
  const fragment = normalizeTree({ k: 11, id: 0, children: [node] }, options).tree;
  return fragment.children[0] ?? node;
}

/** Whitespace-insensitive, order-insensitive class comparison. */
export function sameClassList(a: string | null, b: string | null): boolean {
  const left = new Set((a ?? '').split(/\s+/).filter(Boolean));
  const right = new Set((b ?? '').split(/\s+/).filter(Boolean));
  if (left.size !== right.size) return false;
  for (const name of left) if (!right.has(name)) return false;
  return true;
}

/** Parse an inline style attribute into a property map (Node-side approximation). */
export function parseStyle(text: string | null): Map<string, string> {
  const out = new Map<string, string>();
  for (const declaration of (text ?? '').split(';')) {
    const colon = declaration.indexOf(':');
    if (colon <= 0) continue;
    const name = declaration.slice(0, colon).trim();
    const value = declaration.slice(colon + 1).trim().replace(/\s+/g, ' ');
    if (name) out.set(name.startsWith('--') ? name : name.toLowerCase(), value);
  }
  return out;
}

export function sameStyle(a: string | null, b: string | null): boolean {
  const left = parseStyle(a);
  const right = parseStyle(b);
  if (left.size !== right.size) return false;
  for (const [name, value] of left) if (right.get(name) !== value) return false;
  return true;
}

export { childrenOf };
