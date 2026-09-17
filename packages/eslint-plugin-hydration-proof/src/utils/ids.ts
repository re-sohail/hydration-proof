// Finds time/random/counter values that end up in id-like attributes. Used by
// no-unstable-id, and by the rules it takes precedence over.
import type { Rule } from 'eslint';
import type { JSXAttribute, JSXOpeningElement, Node, VisitorKeys } from './ast.ts';
import {
  callArguments,
  hookName,
  isFunction,
  isHostTag,
  jsxAttributeName,
  jsxTagName,
  parentOf,
  propertyName,
  unwrap,
  walk,
  writeExpression,
} from './ast.ts';
import { renderContext, runsDuringRender } from './render-scope.ts';
import { declarationKind, findVariable, importBinding, isModuleLevel, variableDeclarator } from './scope.ts';
import { randomSource, timeSource } from './sources.ts';

/** Attributes whose value must match an id elsewhere in the document. */
export const ID_ATTRIBUTES: ReadonlySet<string> = new Set([
  'id',
  'htmlFor',
  'for',
  'aria-labelledby',
  'aria-describedby',
  'aria-controls',
  'aria-owns',
  'aria-activedescendant',
  'aria-details',
  'aria-errormessage',
  'list',
  'popoverTarget',
]);
const FORM_FIELDS = new Set(['input', 'select', 'textarea', 'button', 'fieldset', 'output']);
const STATE_HOOKS = new Set(['useState', 'useRef', 'useMemo']);

export interface IdSource {
  /** What makes the value unstable, e.g. `Math.random()`. */
  source: string;
  /** Where it ends up, e.g. `id` or `htmlFor`. */
  sink: string;
}

const cache = new WeakMap<object, Map<Node, IdSource>>();

export function isIdAttribute(name: string, tag: string): boolean {
  if (ID_ATTRIBUTES.has(name)) return true;
  if (name === 'name') return FORM_FIELDS.has(tag);
  // Component props such as labelId or triggerId.
  return !isHostTag(tag) && /[a-z]Id$/.test(name);
}

function isIdName(name: string): boolean {
  return /^id$|Id$|ID$|_id$|^idRef$|IdRef$/.test(name);
}

/** Whether a node runs during render, or while the module initialises a top-level variable. */
function runsOnBothSides(node: Node): boolean {
  if (renderContext(node)) return true;
  let current = parentOf(node);
  while (current) {
    if (isFunction(current) && !runsDuringRender(current)) return false;
    if (current.type === 'VariableDeclarator') {
      const declaration = parentOf(current);
      const container = declaration ? parentOf(declaration) : null;
      if (container?.type === 'Program' || container?.type === 'ExportNamedDeclaration') return true;
    }
    if (current.type.startsWith('Class')) return false;
    current = parentOf(current);
  }
  return false;
}

function classPropertyValue(node: Node, name: string): Node | null {
  let current = parentOf(node);
  while (current && current.type !== 'ClassBody') current = parentOf(current);
  if (!current) return null;
  for (const member of current.body as Node[]) {
    if (member.type === 'PropertyDefinition' && !member.static && !member.computed && member.key.type === 'Identifier' && member.key.name === name) {
      return (member.value as Node | null) ?? null;
    }
  }
  return null;
}

class Collector {
  readonly found = new Map<Node, IdSource>();
  private readonly visited = new Set<unknown>();
  private readonly context: Rule.RuleContext;
  private readonly keys: VisitorKeys;

  constructor(context: Rule.RuleContext, keys: VisitorKeys) {
    this.context = context;
    this.keys = keys;
  }

  private add(node: Node, source: string, sink: string): void {
    if (!this.found.has(node) && runsOnBothSides(node)) this.found.set(node, { source, sink });
  }

  collect(root: Node, sink: string): void {
    walk(root, this.keys, (node) => {
      if (isFunction(node)) return runsDuringRender(node);
      if (node.type === 'CallExpression' || node.type === 'NewExpression') {
        const source = timeSource(this.context, node) ?? randomSource(this.context, node);
        if (source) this.add(node, source, sink);
        return;
      }
      if (node.type === 'MemberExpression') {
        const object = unwrap(node.object as Node);
        const name = propertyName(node);
        if (object.type === 'ThisExpression' && name !== null) {
          const value = classPropertyValue(node, name);
          if (value && !this.visited.has(value)) {
            this.visited.add(value);
            this.collect(value, sink);
          }
          return false;
        }
        if (!node.computed) {
          // Only the object is a reference; the property is a name.
          this.collect(node.object as Node, sink);
          return false;
        }
        return;
      }
      if (node.type === 'Identifier') this.followIdentifier(node, sink);
      return;
    });
  }

  private followIdentifier(identifier: Node, sink: string): void {
    if (importBinding(this.context, identifier)) return;
    const variable = findVariable(this.context, identifier);
    if (!variable) return;
    const kind = declarationKind(variable);
    if (isModuleLevel(variable) && (kind === 'let' || kind === 'var')) {
      const label = `module-level counter \`${variable.name}\``;
      const write = writeExpression(identifier);
      if (write !== identifier) {
        // `id={`f${counter++}`}`
        if (renderContext(write)) this.add(write, label, sink);
        return;
      }
      // A read: the writes made while rendering the same component feed the id.
      const root = renderContext(identifier)?.root;
      if (!root) return;
      for (const reference of variable.references) {
        const target = reference.identifier as Node;
        if (!reference.isWrite() || reference.init) continue;
        const other = writeExpression(target);
        if (other !== target && renderContext(other)?.root === root) this.add(other, label, sink);
      }
      return;
    }
    if (this.visited.has(variable)) return;
    this.visited.add(variable);
    const declarator = variableDeclarator(variable);
    const init = declarator?.init ? unwrap(declarator.init as Node) : null;
    if (!init) return;
    if (init.type === 'CallExpression' && STATE_HOOKS.has(hookName(init) ?? '')) {
      const initial = callArguments(init)[0];
      if (initial) this.collect(initial, sink);
      return;
    }
    this.collect(init, sink);
  }
}

/** Unstable values (time, randomness, module counters) that flow into ids, keyed by the node that produces them. */
export function idSources(context: Rule.RuleContext): ReadonlyMap<Node, IdSource> {
  const sourceCode = context.sourceCode;
  const cached = cache.get(sourceCode);
  if (cached) return cached;
  const keys = sourceCode.visitorKeys as VisitorKeys;
  const collector = new Collector(context, keys);
  walk(sourceCode.ast as Node, keys, (node) => {
    if (node.type === 'JSXAttribute') {
      const attribute = node as JSXAttribute;
      const opening = parentOf(attribute) as JSXOpeningElement | null;
      const name = jsxAttributeName(attribute);
      const value = attribute.value;
      if (opening && value?.type === 'JSXExpressionContainer' && value.expression.type !== 'JSXEmptyExpression') {
        if (isIdAttribute(name, jsxTagName(opening.name))) collector.collect(value.expression as Node, name);
      }
      return;
    }
    if (node.type === 'VariableDeclarator') {
      const init = node.init ? unwrap(node.init as Node) : null;
      const hook = init ? hookName(init) : null;
      if (!init || (hook !== 'useState' && hook !== 'useRef')) return;
      const id = node.id as Node;
      const bound = id.type === 'Identifier' ? id : id.type === 'ArrayPattern' ? (id.elements[0] as Node | null) : null;
      const initial = callArguments(init)[0];
      if (bound?.type === 'Identifier' && isIdName(bound.name) && initial) collector.collect(initial, bound.name);
    }
    return;
  });
  cache.set(sourceCode, collector.found);
  return collector.found;
}
