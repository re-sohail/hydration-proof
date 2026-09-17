// Short, human-readable labels for DOM nodes. Precise selectors are built on
// the Node side from snapshots; these are only for summaries and containers.

const MAX_CLASSES = 2;

export function describeNode(node: Node): string {
  switch (node.nodeType) {
    case Node.ELEMENT_NODE: {
      const el = node as Element;
      let label = el.localName;
      if (el.id) label += `#${el.id}`;
      const classes = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean) : [];
      for (const name of classes.slice(0, MAX_CLASSES)) label += `.${name}`;
      return label;
    }
    case Node.TEXT_NODE:
      return '#text';
    case Node.COMMENT_NODE:
      return '#comment';
    case Node.DOCUMENT_NODE:
      return '#document';
    default:
      return node.nodeName.toLowerCase();
  }
}

/** A CSS selector that identifies `el` in its document. */
export function cssPath(el: Element): string {
  if (el.id && el.ownerDocument.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
    return `#${CSS.escape(el.id)}`;
  }
  const parts: string[] = [];
  let current: Element | null = el;
  while (current !== null && current.nodeType === Node.ELEMENT_NODE) {
    const tag: string = current.localName;
    if (tag === 'html' || tag === 'body' || tag === 'head') {
      parts.unshift(tag);
      break;
    }
    const parent: Element | null = current.parentElement;
    let part = tag;
    if (parent !== null) {
      const same = Array.from(parent.children).filter((child) => child.localName === tag);
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    current = parent;
  }
  return parts.join(' > ');
}

const TOOLING_SELECTOR = 'nextjs-portal, [data-nextjs-dev-overlay], [data-hydration-proof-internal], vite-error-overlay';

/** Inside developer tooling UI (framework dev overlays), including their shadow roots. */
export function isToolingNode(node: Node): boolean {
  let current: Node | null = node;
  while (current) {
    if (current.nodeType === Node.ELEMENT_NODE && (current as Element).matches(TOOLING_SELECTOR)) return true;
    current = current.parentNode ?? (current instanceof ShadowRoot ? current.host : null);
  }
  return false;
}
