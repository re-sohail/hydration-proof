import { normalizeReactText, propsView } from '../shared/attr-map.ts';
import type { ClientView, FormView, SElement, SText } from '../shared/protocol.ts';
import { HTML_NS } from './env.ts';
import { fiberOf, hostPropsOf, ownerName } from './fiber.ts';
import { nativeHandlers, TRACKED_EVENTS } from './listeners.ts';
import type { SerializeHooks } from './serialize.ts';

// An inert document: markup parsed here never runs scripts or loads images.
let scratch: Document | undefined;
function scratchDocument(): Document {
  scratch ??= document.implementation.createHTMLDocument('');
  return scratch;
}

function styleFromDeclarations(declarations: [string, string][]): string {
  const el = scratchDocument().createElement('div');
  const style = el.style as CSSStyleDeclaration & Record<string, string>;
  for (const [name, value] of declarations) {
    if (name.startsWith('--')) style.setProperty(name, value);
    else if (name === 'float') style.cssFloat = value;
    else style[name] = value;
  }
  return style.cssText;
}

function styleFromAttribute(text: string): string {
  const el = scratchDocument().createElement('div');
  el.setAttribute('style', text);
  return el.style.cssText;
}

function sameMarkup(el: Element, html: string): boolean {
  const probe = scratchDocument().createElement(el.localName);
  probe.innerHTML = html;
  return probe.innerHTML === el.innerHTML;
}

const isText = (value: unknown): value is string | number => typeof value === 'string' || typeof value === 'number';

/**
 * What a form control's props ask for, and what it holds now. React applies
 * these as properties, so they never appear in the mutation log; `<select>` is
 * read as its own value rather than per option, because that is where React
 * puts `value`/`defaultValue`.
 */
function formViewOf(el: Element, props: Record<string, unknown>): FormView | undefined {
  const tag = el.localName;
  if (tag === 'input') {
    const input = el as HTMLInputElement;
    const type = typeof props['type'] === 'string' ? props['type'].toLowerCase() : 'text';
    if (type === 'file' || type === 'image' || type === 'submit' || type === 'reset' || type === 'button') return undefined;
    if (type === 'checkbox' || type === 'radio') {
      const controlled = typeof props['checked'] === 'boolean';
      const wanted = controlled ? props['checked'] : props['defaultChecked'];
      if (typeof wanted !== 'boolean') return undefined;
      return { property: 'checked', client: String(wanted), dom: String(input.checked), ...(controlled ? { controlled: true } : {}) };
    }
    const controlled = isText(props['value']);
    const wanted = controlled ? props['value'] : props['defaultValue'];
    if (!isText(wanted)) return undefined;
    return { property: 'value', client: String(wanted), dom: input.value, ...(controlled ? { controlled: true } : {}) };
  }
  if (tag === 'textarea') {
    const controlled = isText(props['value']);
    const wanted = controlled ? props['value'] : (props['defaultValue'] ?? (isText(props['children']) ? props['children'] : undefined));
    if (!isText(wanted)) return undefined;
    return { property: 'value', client: String(wanted), dom: (el as HTMLTextAreaElement).value, ...(controlled ? { controlled: true } : {}) };
  }
  if (tag === 'select') {
    const select = el as HTMLSelectElement;
    // A multiple select holds a list; comparing one value would be wrong.
    if (select.multiple || Array.isArray(props['value']) || Array.isArray(props['defaultValue'])) return undefined;
    const controlled = isText(props['value']);
    const wanted = controlled ? props['value'] : props['defaultValue'];
    if (!isText(wanted)) return undefined;
    return { property: 'value', client: String(wanted), dom: select.value, ...(controlled ? { controlled: true } : {}) };
  }
  return undefined;
}

export function clientViewOf(el: Element): ClientView | undefined {
  const props = hostPropsOf(el);
  if (props === undefined) return undefined;
  const foreign = el.namespaceURI !== HTML_NS;
  const view = propsView(el.localName, foreign, props);

  const out: ClientView = { attrs: view.attrs };
  if (view.skipped.length > 0) out.skipped = view.skipped;
  if (view.suppress) out.suppress = true;
  if (view.opaque !== undefined) {
    out.opaque = view.opaque;
    return out;
  }
  if (view.text !== undefined) out.text = view.text;
  if (view.styles !== undefined) {
    out.style = styleFromDeclarations(view.styles);
    out.domStyle = styleFromAttribute(el.getAttribute('style') ?? '');
  }
  if (view.html !== undefined && !foreign) out.htmlMatch = sameMarkup(el, view.html);
  if (!foreign) {
    const form = formViewOf(el, props);
    if (form !== undefined) out.form = form;
  }
  const doubled = nativeHandlers(el).filter((type) => TRACKED_EVENTS.get(type)!.some((name) => typeof props[name] === 'function'));
  if (doubled.length > 0) out.handlers = doubled;
  return out;
}

/** Serializer hooks that attach React's client-side expectations. */
export const clientViewHooks: SerializeHooks = {
  element(node, out: SElement) {
    const fiber = fiberOf(node);
    if (fiber === undefined) return;
    const view = clientViewOf(node);
    if (view !== undefined) out.client = view;
    const owner = ownerName(fiber);
    if (owner !== undefined) out.owner = owner;
  },
  text(node, out: SText) {
    const fiber = fiberOf(node);
    if (fiber === undefined) return;
    const props: unknown = fiber.memoizedProps;
    if (typeof props !== 'string' && typeof props !== 'number') return;
    const expected = normalizeReactText(String(props));
    if (expected !== normalizeReactText(node.data)) out.client = expected;
  },
};
