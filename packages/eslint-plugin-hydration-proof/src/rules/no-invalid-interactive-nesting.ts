import type { Rule } from 'eslint';
import type { JSXElement, Node } from '../utils/ast.ts';
import {
  effectiveParent,
  estree,
  isFunction,
  isFragmentTag,
  isHostTag,
  jsxAttribute,
  jsxAttributeEnabled,
  jsxAttributeString,
  jsxTagName,
  parentOf,
  propertyName,
  unwrap,
} from '../utils/ast.ts';
import { createRule } from '../utils/rule.ts';

/** Start tags that close an open `<p>` in the HTML parser ("close a p element"). */
const CLOSES_PARAGRAPH = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'center',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'dd',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'li',
  'listing',
  'main',
  'menu',
  'nav',
  'ol',
  'p',
  'plaintext',
  'pre',
  'search',
  'section',
  'summary',
  'table',
  'ul',
  'xmp',
]);
/** Elements that end the parser's "button scope" when it looks for an open `<p>`. */
const BUTTON_SCOPE_BOUNDARIES = new Set(['button', 'applet', 'caption', 'html', 'table', 'td', 'th', 'marquee', 'object', 'template']);
/** Elements that may not contain their own kind. */
const NO_SELF_NESTING = new Set(['a', 'button', 'form', 'label']);
const INTERACTIVE_CONTAINERS = new Set(['a', 'button']);
const ALWAYS_INTERACTIVE = new Set(['a', 'button', 'select', 'textarea', 'label', 'details', 'iframe', 'embed']);
const TABLE_SECTIONS = new Set(['table', 'tbody', 'thead', 'tfoot']);
/** Foreign content: the HTML nesting rules do not apply inside. */
const FOREIGN = new Set(['svg', 'math']);
const LIST_RENDERERS = new Set(['map', 'flatMap']);

interface HostAncestor {
  tag: string;
  /** Whether it is the element's parent in the rendered HTML (ignoring fragments). */
  direct: boolean;
}

function isInteractive(element: JSXElement, tag: string): boolean {
  if (ALWAYS_INTERACTIVE.has(tag)) return true;
  const opening = element.openingElement;
  if (tag === 'input') {
    const type = jsxAttribute(opening, 'type');
    // A dynamic type could be "hidden": only report what is certain.
    if (type?.value && jsxAttributeString(type) === null) return false;
    return jsxAttributeString(type)?.toLowerCase() !== 'hidden';
  }
  if (tag === 'audio' || tag === 'video') return jsxAttributeEnabled(jsxAttribute(opening, 'controls'));
  return false;
}

/** For JSX returned from a `.map()` callback, the call that renders the list. */
function listCallOf(fn: Node): Node | null {
  if (!isFunction(fn)) return null;
  const { parent, child } = effectiveParent(fn);
  if (parent?.type !== 'CallExpression' || parent.arguments[0] !== child) return null;
  const method = propertyName(unwrap(parent.callee as Node));
  return method !== null && LIST_RENDERERS.has(method) ? parent : null;
}

/** The host elements that statically contain `element`, nearest first. */
function hostAncestors(element: JSXElement): HostAncestor[] {
  const ancestors: HostAncestor[] = [];
  let current: Node = element;
  let direct = true;
  for (;;) {
    const parent = parentOf(current);
    if (!parent) return ancestors;
    switch (parent.type) {
      case 'JSXElement': {
        const tag = jsxTagName(parent.openingElement.name);
        if (!isFragmentTag(tag)) {
          if (!isHostTag(tag)) return ancestors; // a component decides where children go
          ancestors.push({ tag, direct });
          direct = false;
          if (FOREIGN.has(tag)) return ancestors;
        }
        break;
      }
      case 'JSXFragment':
      case 'ConditionalExpression':
      case 'LogicalExpression':
      case 'ArrayExpression':
      case 'TSAsExpression':
      case 'TSSatisfiesExpression':
      case 'TSNonNullExpression':
        break;
      case 'JSXExpressionContainer':
        if (parentOf(parent)?.type === 'JSXAttribute') return ancestors; // a prop, not a child
        break;
      case 'ArrowFunctionExpression': {
        const call: Node | null = parent.body === current ? listCallOf(parent) : null;
        if (!call) return ancestors;
        current = call;
        continue;
      }
      case 'ReturnStatement': {
        let fn: Node | null = parentOf(parent);
        while (fn && !isFunction(fn)) fn = parentOf(fn);
        const call: Node | null = fn ? listCallOf(fn) : null;
        if (!call) return ancestors;
        current = call;
        continue;
      }
      default:
        return ancestors;
    }
    current = parent;
  }
}

export const noInvalidInteractiveNesting: Rule.RuleModule = createRule({
  name: 'no-invalid-interactive-nesting',
  meta: {
    type: 'problem',
    docs: { description: 'Disallow HTML nesting that the browser repairs while parsing, such as <div> in <p> or <a> in <a>' },
    schema: [],
    messages: {
      nestedSame:
        '`<{{child}}>` cannot be inside another `<{{parent}}>`. The browser repairs this HTML while parsing the server response, so the page no longer has the tree React rendered and hydration fails. Make them siblings or use a different element.',
      interactive:
        'Interactive `<{{child}}>` cannot be inside `<{{parent}}>`. The HTML is invalid, React reports it as a hydration error, and browsers handle clicks on it inconsistently. Move it outside the `<{{parent}}>`.',
      blockInParagraph:
        '`<{{child}}>` cannot be inside `<p>`. The browser closes the `<p>` before the `<{{child}}>` while parsing the server HTML, so the DOM no longer matches what React rendered and hydration fails. Use a `<div>` instead of the `<p>`, or a `<span>` instead of the `<{{child}}>`.',
      tableRow:
        '`<tr>` cannot be a direct child of `<table>`. The browser inserts a `<tbody>` while parsing the server HTML, so the DOM no longer matches what React rendered. Wrap the rows in `<tbody>`, `<thead>` or `<tfoot>`.',
      tableCell:
        '`<{{child}}>` must be inside a `<tr>`. The browser inserts a `<tr>` while parsing the server HTML, so the DOM no longer matches what React rendered. Wrap the cells in `<tr>`.',
    },
  },
  checksServerComponents: true,
  create(context) {
    return {
      JSXElement(node) {
        const element = node as JSXElement;
        const child = jsxTagName(element.openingElement.name);
        if (!isHostTag(child)) return;
        const report = (messageId: string, parent: string): void => {
          context.report({ node: estree(element.openingElement), messageId, data: { child, parent } });
        };
        const ancestors = hostAncestors(element);
        if (FOREIGN.has(child) || ancestors.some(({ tag }) => FOREIGN.has(tag))) return;
        const first = ancestors[0];
        if (first?.direct) {
          if (child === 'tr' && first.tag === 'table') return report('tableRow', first.tag);
          if ((child === 'td' || child === 'th') && TABLE_SECTIONS.has(first.tag)) return report('tableCell', first.tag);
        }
        const interactive = isInteractive(element, child);
        let paragraphScope = true;
        for (const { tag } of ancestors) {
          if (NO_SELF_NESTING.has(child) && tag === child) return report('nestedSame', tag);
          if (interactive && INTERACTIVE_CONTAINERS.has(tag)) return report('interactive', tag);
          if (paragraphScope && tag === 'p' && CLOSES_PARAGRAPH.has(child)) return report('blockInParagraph', tag);
          if (BUTTON_SCOPE_BOUNDARIES.has(tag)) paragraphScope = false;
        }
      },
    };
  },
});
