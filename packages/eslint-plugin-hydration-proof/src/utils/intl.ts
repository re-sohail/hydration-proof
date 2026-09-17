// Recognisers for locale- and time-zone-dependent formatting.
import type { Rule } from 'eslint';
import type { FunctionNode, Node } from './ast.ts';
import { effectiveParent, isFunction, parentOf, propertyName, unwrap } from './ast.ts';
import { findVariable, globalName, variableDeclarator } from './scope.ts';

export const LOCALE_METHODS: ReadonlySet<string> = new Set(['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']);
export const INTL_LOCALE_CONSTRUCTORS: ReadonlySet<string> = new Set([
  'NumberFormat',
  'DateTimeFormat',
  'RelativeTimeFormat',
  'PluralRules',
  'Collator',
  'ListFormat',
  'DisplayNames',
]);

/** `Intl.X(...)` or `new Intl.X(...)`: returns X. */
export function intlConstructor(context: Rule.RuleContext, node: Node): string | null {
  if (node.type !== 'CallExpression' && node.type !== 'NewExpression') return null;
  const callee = unwrap(node.callee as Node);
  if (callee.type !== 'MemberExpression' || globalName(context, callee.object as Node) !== 'Intl') return null;
  const name = propertyName(callee);
  return name !== null && INTL_LOCALE_CONSTRUCTORS.has(name) ? name : null;
}

/** For `Intl.X(...).resolvedOptions().prop`, returns the property read (or `''` when not a static read). */
export function resolvedOptionsRead(node: Node): { call: Node; property: string } | null {
  const { parent: member, child } = effectiveParent(node);
  if (member?.type !== 'MemberExpression' || member.object !== child || propertyName(member) !== 'resolvedOptions') return null;
  const { parent: call, child: callee } = effectiveParent(member);
  if (call?.type !== 'CallExpression' || call.callee !== callee) return null;
  const { parent: read, child: object } = effectiveParent(call);
  const property = read?.type === 'MemberExpression' && read.object === object ? propertyName(read) : null;
  return { call, property: property ?? '' };
}

export function enclosingFunction(node: Node): FunctionNode | null {
  let current = parentOf(node);
  while (current && !isFunction(current)) current = parentOf(current);
  return current;
}

/** Whether an expression is clearly a Date: `new Date(...)` or a variable initialised with one in the same function. */
export function isDateValue(context: Rule.RuleContext, node: Node | null): boolean {
  if (!node) return false;
  const value = unwrap(node);
  if (value.type === 'NewExpression') return globalName(context, value.callee as Node) === 'Date';
  if (value.type !== 'Identifier') return false;
  const declarator = variableDeclarator(findVariable(context, value));
  if (!declarator?.init || declarator.id.type !== 'Identifier') return false;
  const init = unwrap(declarator.init as Node);
  return (
    init.type === 'NewExpression' &&
    globalName(context, init.callee as Node) === 'Date' &&
    enclosingFunction(declarator as Node) === enclosingFunction(value)
  );
}

/** The static key names of an object literal, or null when it has spreads or computed keys. */
export function objectKeys(node: Node | undefined): string[] | null {
  if (!node) return null;
  const object = unwrap(node);
  if (object.type !== 'ObjectExpression') return null;
  const keys: string[] = [];
  for (const property of object.properties as Node[]) {
    if (property.type !== 'Property' || property.computed) return null;
    const key = property.key as Node;
    if (key.type === 'Identifier') keys.push(key.name);
    else if (key.type === 'Literal') keys.push(String(key.value));
    else return null;
  }
  return keys;
}
