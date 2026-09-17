// AST types and helpers shared by every rule. ESTree has no JSX or TypeScript
// nodes, so the few we need are declared here.
import type * as ESTree from 'estree';

interface NodeBase {
  range?: [number, number] | undefined;
  loc?: ESTree.SourceLocation | null | undefined;
}

export interface JSXIdentifier extends NodeBase {
  type: 'JSXIdentifier';
  name: string;
}
export interface JSXNamespacedName extends NodeBase {
  type: 'JSXNamespacedName';
  namespace: JSXIdentifier;
  name: JSXIdentifier;
}
export interface JSXMemberExpression extends NodeBase {
  type: 'JSXMemberExpression';
  object: JSXIdentifier | JSXMemberExpression;
  property: JSXIdentifier;
}
export type JSXTagName = JSXIdentifier | JSXNamespacedName | JSXMemberExpression;
export interface JSXExpressionContainer extends NodeBase {
  type: 'JSXExpressionContainer';
  expression: ESTree.Expression | JSXEmptyExpression;
}
export interface JSXEmptyExpression extends NodeBase {
  type: 'JSXEmptyExpression';
}
export interface JSXAttribute extends NodeBase {
  type: 'JSXAttribute';
  name: JSXIdentifier | JSXNamespacedName;
  value: ESTree.Literal | JSXExpressionContainer | JSXElement | JSXFragment | null;
}
export interface JSXSpreadAttribute extends NodeBase {
  type: 'JSXSpreadAttribute';
  argument: ESTree.Expression;
}
export interface JSXOpeningElement extends NodeBase {
  type: 'JSXOpeningElement';
  name: JSXTagName;
  attributes: (JSXAttribute | JSXSpreadAttribute)[];
  selfClosing: boolean;
}
export interface JSXClosingElement extends NodeBase {
  type: 'JSXClosingElement';
  name: JSXTagName;
}
export interface JSXText extends NodeBase {
  type: 'JSXText';
  value: string;
}
export interface JSXSpreadChild extends NodeBase {
  type: 'JSXSpreadChild';
  expression: ESTree.Expression;
}
export type JSXChild = JSXElement | JSXFragment | JSXExpressionContainer | JSXText | JSXSpreadChild;
export interface JSXElement extends NodeBase {
  type: 'JSXElement';
  openingElement: JSXOpeningElement;
  closingElement: JSXClosingElement | null;
  children: JSXChild[];
}
export interface JSXFragment extends NodeBase {
  type: 'JSXFragment';
  children: JSXChild[];
}
export type JSXNode =
  | JSXIdentifier
  | JSXNamespacedName
  | JSXMemberExpression
  | JSXExpressionContainer
  | JSXEmptyExpression
  | JSXAttribute
  | JSXSpreadAttribute
  | JSXOpeningElement
  | JSXClosingElement
  | JSXText
  | JSXSpreadChild
  | JSXElement
  | JSXFragment;

/** TypeScript nodes that wrap a value without changing it. */
export interface TSExpressionWrapper extends NodeBase {
  type: 'TSAsExpression' | 'TSSatisfiesExpression' | 'TSNonNullExpression' | 'TSTypeAssertion' | 'TSInstantiationExpression';
  expression: ESTree.Expression;
}

export type Node = ESTree.Node | JSXNode | TSExpressionWrapper;
export type FunctionNode = ESTree.FunctionDeclaration | ESTree.FunctionExpression | ESTree.ArrowFunctionExpression;
export type VisitorKeys = Readonly<Record<string, readonly string[] | undefined>>;

const TS_WRAPPERS = new Set(['TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'TSTypeAssertion', 'TSInstantiationExpression']);

export function parentOf(node: Node): Node | null {
  return (node as { parent?: Node | null }).parent ?? null;
}

/** Casts one of our nodes to the ESTree type ESLint's API is declared with. */
export function estree(node: Node): ESTree.Node {
  return node as ESTree.Node;
}

export function isFunction(node: Node | null | undefined): node is FunctionNode {
  return node?.type === 'FunctionDeclaration' || node?.type === 'FunctionExpression' || node?.type === 'ArrowFunctionExpression';
}

export function isWrapper(node: Node): node is TSExpressionWrapper | ESTree.ChainExpression {
  return TS_WRAPPERS.has(node.type) || node.type === 'ChainExpression';
}

/** Removes TypeScript assertions and optional-chain wrappers. */
export function unwrap(node: Node): Node {
  let current = node;
  while (isWrapper(current)) current = current.expression as Node;
  return current;
}

/**
 * The first ancestor that is not a transparent wrapper, together with the
 * child through which it was reached (the outermost wrapper, or the node).
 */
export function effectiveParent(node: Node): { parent: Node | null; child: Node } {
  let child = node;
  let parent = parentOf(node);
  while (parent && isWrapper(parent)) {
    child = parent;
    parent = parentOf(parent);
  }
  return { parent, child };
}

/** The static name of a member expression's property, if it has one. */
export function propertyName(node: Node): string | null {
  if (node.type !== 'MemberExpression') return null;
  const property = node.property as Node;
  if (!node.computed) return property.type === 'Identifier' ? property.name : null;
  return staticString(property);
}

/** The value of a string literal or a template literal without expressions. */
export function staticString(node: Node | null | undefined): string | null {
  if (!node) return null;
  const inner = unwrap(node);
  if (inner.type === 'Literal' && typeof inner.value === 'string') return inner.value;
  if (inner.type === 'TemplateLiteral' && inner.expressions.length === 0) return inner.quasis[0]?.value.cooked ?? null;
  return null;
}

/** The name of a plain call (`useState()`) or a namespaced call (`React.useState()`). */
export function hookName(call: Node): string | null {
  if (call.type !== 'CallExpression') return null;
  const callee = unwrap(call.callee as Node);
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && unwrap(callee.object as Node).type === 'Identifier') return propertyName(callee);
  return null;
}

/** The callee's object for `object.method()` calls. */
export function calleeObject(call: Node): Node | null {
  if (call.type !== 'CallExpression' && call.type !== 'NewExpression') return null;
  const callee = unwrap(call.callee as Node);
  return callee.type === 'MemberExpression' ? unwrap(callee.object as Node) : null;
}

export function callArguments(call: Node): Node[] {
  if (call.type !== 'CallExpression' && call.type !== 'NewExpression') return [];
  return call.arguments as Node[];
}

/** Position of `child` (or the wrapper around it) in a call's argument list. */
export function argumentIndex(call: Node, child: Node): number {
  return callArguments(call).indexOf(child);
}

export function isUndefinedValue(node: Node | undefined): boolean {
  if (!node) return true;
  const inner = unwrap(node);
  if (inner.type === 'Identifier') return inner.name === 'undefined';
  return inner.type === 'UnaryExpression' && inner.operator === 'void';
}

export function jsxTagName(name: JSXTagName): string {
  if (name.type === 'JSXIdentifier') return name.name;
  if (name.type === 'JSXNamespacedName') return `${name.namespace.name}:${name.name.name}`;
  return `${jsxTagName(name.object)}.${name.property.name}`;
}

/** Lowercase, unqualified JSX names are HTML (or SVG, or custom) elements. */
export function isHostTag(name: string): boolean {
  return /^[a-z]/.test(name) && !name.includes('.');
}

export function isFragmentTag(name: string): boolean {
  return name === 'Fragment' || name.endsWith('.Fragment');
}

export function jsxAttribute(element: JSXOpeningElement, name: string): JSXAttribute | undefined {
  return element.attributes.find(
    (attribute): attribute is JSXAttribute => attribute.type === 'JSXAttribute' && attribute.name.type === 'JSXIdentifier' && attribute.name.name === name,
  );
}

export function jsxAttributeName(attribute: JSXAttribute): string {
  return attribute.name.type === 'JSXIdentifier' ? attribute.name.name : `${attribute.name.namespace.name}:${attribute.name.name.name}`;
}

/** The static string value of a JSX attribute (`a="x"`, `a={'x'}`), or null. */
export function jsxAttributeString(attribute: JSXAttribute | undefined): string | null {
  const value = attribute?.value;
  if (!value) return null;
  if (value.type === 'JSXExpressionContainer') return value.expression.type === 'JSXEmptyExpression' ? null : staticString(value.expression);
  return value.type === 'Literal' ? staticString(value) : null;
}

/** Whether a boolean JSX attribute is on: `a`, `a={true}`, or any non-literal value. */
export function jsxAttributeEnabled(attribute: JSXAttribute | undefined): boolean {
  if (!attribute) return false;
  const value = attribute.value;
  if (value === null) return true;
  if (value.type === 'JSXExpressionContainer') {
    const expression = value.expression as Node;
    if (expression.type === 'Literal') return Boolean(expression.value);
    return !(expression.type === 'Identifier' && expression.name === 'undefined');
  }
  return true;
}

/**
 * Walks a subtree depth first. Return false from `visit` to skip a node's children.
 */
export function walk(root: Node, visitorKeys: VisitorKeys, visit: (node: Node) => boolean | void): void {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (visit(node) === false) continue;
    const keys = visitorKeys[node.type] ?? fallbackKeys(node);
    for (let index = keys.length - 1; index >= 0; index--) {
      const value = (node as unknown as Record<string, unknown>)[keys[index]!];
      if (Array.isArray(value)) {
        for (let item = value.length - 1; item >= 0; item--) {
          if (isNodeLike(value[item])) stack.push(value[item]);
        }
      } else if (isNodeLike(value)) {
        stack.push(value);
      }
    }
  }
}

function isNodeLike(value: unknown): value is Node {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

function fallbackKeys(node: Node): string[] {
  return Object.keys(node).filter((key) => key !== 'parent' && key !== 'loc' && key !== 'range' && key !== 'tokens' && key !== 'comments');
}

/** Whether `node` is inside `ancestor` (or is it). */
export function isInside(node: Node, ancestor: Node): boolean {
  const [start, end] = ancestor.range ?? [0, -1];
  const range = node.range;
  return range !== undefined && range[0] >= start && range[1] <= end;
}

/** Whether the identifier sits in a TypeScript type position (`let x: typeof window`). */
export function isInTypePosition(node: Node): boolean {
  let parent = parentOf(node);
  while (parent && (parent.type as string) === 'TSQualifiedName') parent = parentOf(parent);
  return (parent?.type as string | undefined) === 'TSTypeQuery';
}

/** The variable name a function or value is bound to: `const Foo = ...`, `Foo = ...`, `X.Foo = ...`. */
export function boundName(node: Node): string | null {
  const { parent, child } = effectiveParent(node);
  if (!parent) return null;
  if (parent.type === 'VariableDeclarator' && parent.init === child && parent.id.type === 'Identifier') return parent.id.name;
  if (parent.type === 'AssignmentExpression' && parent.right === child) {
    const left = parent.left as Node;
    if (left.type === 'Identifier') return left.name;
    return propertyName(left);
  }
  return null;
}

/** Whether every code path through a statement ends in return or throw. */
export function alwaysExits(statement: Node | null | undefined): boolean {
  if (!statement) return false;
  switch (statement.type) {
    case 'ReturnStatement':
    case 'ThrowStatement':
      return true;
    case 'BlockStatement':
      return statement.body.some((child) => alwaysExits(child as Node));
    case 'IfStatement':
      return alwaysExits(statement.consequent as Node) && alwaysExits(statement.alternate as Node | null);
    default:
      return false;
  }
}

const PATTERN_TYPES = new Set(['ArrayPattern', 'ObjectPattern', 'Property', 'RestElement', 'AssignmentPattern']);

/**
 * The expression that writes a variable when `identifier` is its target
 * (`count++`, `count += 1`, `[count] = ...`); otherwise the identifier itself.
 */
export function writeExpression(identifier: Node): Node {
  let child = identifier;
  let current = parentOf(identifier);
  while (current && PATTERN_TYPES.has(current.type)) {
    if (current.type === 'Property' && current.value !== child) return identifier;
    if (current.type === 'AssignmentPattern' && current.left !== child) return identifier;
    child = current;
    current = parentOf(current);
  }
  if (current?.type === 'UpdateExpression') return current;
  if (current?.type === 'AssignmentExpression' && current.left === child) return current;
  return identifier;
}

export function sourceText(sourceCode: { getText(node?: ESTree.Node): string }, node: Node): string {
  const text = sourceCode.getText(estree(node));
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}
