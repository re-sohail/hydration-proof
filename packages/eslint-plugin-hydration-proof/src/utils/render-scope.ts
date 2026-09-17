// Render-scope analysis: which code runs while React renders a component (on
// the server and again during hydration) and which runs later (effects,
// event handlers, callbacks).
import type * as ESTree from 'estree';
import type { FunctionNode, Node } from './ast.ts';
import {
  argumentIndex,
  boundName,
  calleeObject,
  effectiveParent,
  hookName,
  isFunction,
  parentOf,
  propertyName,
  unwrap,
  walk,
} from './ast.ts';

/** Array methods whose callbacks run synchronously when called. */
export const ARRAY_CALLBACK_METHODS: ReadonlySet<string> = new Set([
  'map',
  'flatMap',
  'filter',
  'reduce',
  'reduceRight',
  'forEach',
  'some',
  'every',
  'find',
  'findIndex',
  'findLast',
  'findLastIndex',
  'sort',
  'toSorted',
]);
export const SORT_METHODS: ReadonlySet<string> = new Set(['sort', 'toSorted']);
const COMPONENT_WRAPPERS = new Set(['memo', 'forwardRef']);
const JSX_TYPES = new Set(['JSXElement', 'JSXFragment']);

export type RenderKind = 'component' | 'hook' | 'class';

export interface StateInitializer {
  /** `useState`, `useReducer`, `useRef` or `state` (class components). */
  hook: string;
  /** The initial value expression or lazy initializer function. */
  node: Node;
}

export interface RenderContext {
  /** The component or hook function, or the class member, that renders. */
  root: Node;
  kind: RenderKind;
  /** Set when the node is part of a state/ref initial value. */
  initializer: StateInitializer | null;
  /** Set when the node is inside a `sort`/`toSorted` comparator. */
  comparator: FunctionNode | null;
}

type FunctionRole =
  | { kind: 'iife' | 'memo' | 'array-callback'; call: Node }
  | { kind: 'comparator'; call: Node }
  | { kind: 'lazy-initializer'; call: Node; hook: string };

const kindCache = new WeakMap<Node, RenderKind | null>();

export function isHookName(name: string | null | undefined): boolean {
  return name !== null && name !== undefined && /^use[A-Z0-9]/.test(name);
}

function isComponentName(name: string | null | undefined): boolean {
  return name !== null && name !== undefined && /^[A-Z]/.test(name);
}

/** Whether the value is (or may be) JSX: `<div/>`, `cond ? <a/> : null`, `createElement(...)`. */
export function isJSXValue(node: Node | null | undefined): boolean {
  if (!node) return false;
  const value = unwrap(node);
  if (JSX_TYPES.has(value.type)) return true;
  switch (value.type) {
    case 'ConditionalExpression':
      return isJSXValue(value.consequent as Node) || isJSXValue(value.alternate as Node);
    case 'LogicalExpression':
      return isJSXValue(value.left as Node) || isJSXValue(value.right as Node);
    case 'SequenceExpression':
      return isJSXValue(value.expressions.at(-1) as Node | undefined);
    case 'CallExpression':
      return hookName(value) === 'createElement';
    default:
      return false;
  }
}

/** Whether a function returns JSX (not counting nested functions). */
export function returnsJSX(fn: FunctionNode): boolean {
  if (fn.body.type !== 'BlockStatement') return isJSXValue(fn.body as Node);
  let found = false;
  walk(fn.body as Node, {}, (node) => {
    if (found || isFunction(node) || node.type.startsWith('Class')) return false;
    if (node.type === 'ReturnStatement' && isJSXValue(node.argument as Node | null)) found = true;
    return !found;
  });
  return found;
}

/** Whether a function is a component or a custom hook, judged by its name and wrappers. */
export function componentKind(fn: FunctionNode): RenderKind | null {
  const cached = kindCache.get(fn);
  if (cached !== undefined) return cached;
  const names = [fn.type !== 'ArrowFunctionExpression' ? fn.id?.name : undefined, boundName(fn)];
  let kind: RenderKind | null = null;
  if (names.some(isHookName)) kind = 'hook';
  else if (names.some((name) => isComponentName(name) && (!/^[A-Z0-9_]{2,}$/.test(name!) || returnsJSX(fn)))) kind = 'component';
  else {
    const { parent, child } = effectiveParent(fn);
    if (parent?.type === 'CallExpression' && argumentIndex(parent, child) === 0 && COMPONENT_WRAPPERS.has(hookName(parent) ?? '')) {
      kind = 'component';
    } else if (parent?.type === 'ExportDefaultDeclaration' && returnsJSX(fn)) {
      kind = 'component';
    }
  }
  kindCache.set(fn, kind);
  return kind;
}

function classOf(member: Node): ESTree.ClassDeclaration | ESTree.ClassExpression | null {
  const body = parentOf(member);
  const cls = body ? parentOf(body) : null;
  return cls?.type === 'ClassDeclaration' || cls?.type === 'ClassExpression' ? cls : null;
}

/** `class X extends Component`, `React.PureComponent`, ... */
export function isComponentClass(cls: ESTree.ClassDeclaration | ESTree.ClassExpression | null): boolean {
  if (!cls?.superClass) return false;
  const superClass = unwrap(cls.superClass as Node);
  const name = superClass.type === 'Identifier' ? superClass.name : propertyName(superClass);
  return name === 'Component' || name === 'PureComponent';
}

function memberKeyName(member: ESTree.MethodDefinition | ESTree.PropertyDefinition): string | null {
  if (member.computed) return null;
  return member.key.type === 'Identifier' ? member.key.name : null;
}

/** For a function that is a class component's `render()` or constructor. */
function isClassRenderFunction(fn: FunctionNode): boolean {
  const parent = parentOf(fn);
  if (parent?.type === 'MethodDefinition' && parent.value === fn && !parent.static) {
    if (parent.kind !== 'constructor' && memberKeyName(parent) !== 'render') return false;
    return isComponentClass(classOf(parent));
  }
  if (parent?.type === 'PropertyDefinition' && parent.value === fn && !parent.static && memberKeyName(parent) === 'render') {
    return isComponentClass(classOf(parent));
  }
  return false;
}

/** How a nested function is used, when that use runs it during render. */
function functionRole(fn: FunctionNode): FunctionRole | null {
  const { parent, child } = effectiveParent(fn);
  if (!parent) return null;
  if (parent.type === 'CallExpression') {
    if (parent.callee === child) return { kind: 'iife', call: parent };
    const index = argumentIndex(parent, child);
    if (index < 0) return null;
    const hook = hookName(parent);
    if (hook === 'useMemo' && index === 0) return { kind: 'memo', call: parent };
    if (hook === 'useState' && index === 0) return { kind: 'lazy-initializer', call: parent, hook };
    if (hook === 'useReducer' && index === 2) return { kind: 'lazy-initializer', call: parent, hook };
    const callee = unwrap(parent.callee as Node);
    const method = propertyName(callee);
    if (method !== null && ARRAY_CALLBACK_METHODS.has(method) && index === 0) {
      return { kind: SORT_METHODS.has(method) ? 'comparator' : 'array-callback', call: parent };
    }
    const object = calleeObject(parent);
    if (method === 'from' && index === 1 && object?.type === 'Identifier' && object.name === 'Array') return { kind: 'array-callback', call: parent };
    return null;
  }
  // (function () { ... }).call(this)
  if (parent.type === 'MemberExpression' && parent.object === child) {
    const method = propertyName(parent);
    const call = parentOf(parent);
    if ((method === 'call' || method === 'apply') && call?.type === 'CallExpression' && call.callee === parent) return { kind: 'iife', call };
  }
  return null;
}

/** Whether a non-function value passed to a hook is a state/ref initial value. */
function initialValueHook(call: Node, child: Node): string | null {
  const hook = hookName(call);
  const index = argumentIndex(call, child);
  if ((hook === 'useState' || hook === 'useRef') && index === 0) return hook;
  if (hook === 'useReducer' && index === 1) return hook;
  return null;
}

function isThisState(node: Node): boolean {
  const target = unwrap(node);
  return target.type === 'MemberExpression' && unwrap(target.object as Node).type === 'ThisExpression' && propertyName(target) === 'state';
}

/**
 * Where `node` runs: inside the render of a component or hook (including
 * `useMemo` callbacks, state initializers, IIFEs and array callbacks), or
 * null when it runs at another time (effects, handlers, module level).
 */
export function renderContext(node: Node): RenderContext | null {
  let child = node;
  let parent = parentOf(node);
  let initializer: StateInitializer | null = null;
  let comparator: FunctionNode | null = null;
  while (parent) {
    if (isFunction(parent)) {
      const kind = componentKind(parent);
      if (kind) return { root: parent, kind, initializer, comparator };
      if (isClassRenderFunction(parent)) return { root: parent, kind: 'class', initializer, comparator };
      const role = functionRole(parent);
      if (!role) return null;
      if (role.kind === 'lazy-initializer') initializer ??= { hook: role.hook, node: parent };
      if (role.kind === 'comparator') comparator ??= parent;
      child = role.call;
      parent = parentOf(role.call);
      continue;
    }
    switch (parent.type) {
      case 'CallExpression': {
        const hook = initializer ? null : initialValueHook(parent, child);
        if (hook) initializer = { hook, node: child };
        break;
      }
      case 'AssignmentExpression':
        if (!initializer && parent.right === child && isThisState(parent.left as Node)) initializer = { hook: 'state', node: child };
        break;
      case 'PropertyDefinition': {
        if (parent.value !== child || parent.static || !isComponentClass(classOf(parent))) return null;
        if (!initializer && memberKeyName(parent) === 'state') initializer = { hook: 'state', node: child };
        return { root: parent, kind: 'class', initializer, comparator };
      }
      case 'StaticBlock':
      case 'Program':
        return null;
      default:
        break;
    }
    child = parent;
    parent = parentOf(parent);
  }
  return null;
}

/**
 * Whether a nested function runs as part of render when its enclosing code
 * does (IIFE, `useMemo`, lazy initializers, array callbacks).
 */
export function runsDuringRender(fn: FunctionNode): boolean {
  return functionRole(fn) !== null;
}
