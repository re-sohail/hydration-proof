// Browser-only reads and environment checks (`typeof window`, `isServer`),
// analysed once per file and shared by the rules so that each construct is
// reported by exactly one of them.
import type { Rule } from 'eslint';
import type { Node, VisitorKeys } from './ast.ts';
import { alwaysExits, effectiveParent, isInside, parentOf, propertyName, staticString, unwrap, walk } from './ast.ts';
import { renderContext } from './render-scope.ts';
import type { BrowserReadOwner } from './sources.ts';
import { BROWSER_GLOBALS, MATCH_MEDIA, STORAGE_GLOBALS, browserReadOwner } from './sources.ts';
import type { HydrationProofSettings } from './files.ts';
import { GLOBAL_OBJECTS, findVariable, globalAccess, globalName, globalReferences, isModuleLevel, variableDeclarator } from './scope.ts';

/** Identifiers commonly used as "are we in the browser?" flags. */
export const DEFAULT_ENVIRONMENT_FLAGS: readonly string[] = [
  'isServer',
  'isBrowser',
  'isClient',
  'canUseDOM',
  'canUseDom',
  'isSSR',
  'IS_BROWSER',
  'IS_SERVER',
  'IS_CLIENT',
];

/** Globals whose existence is tested to tell the browser from the server. */
const ENVIRONMENT_GLOBALS: ReadonlySet<string> = new Set([
  ...BROWSER_GLOBALS,
  ...STORAGE_GLOBALS,
  MATCH_MEDIA,
  'IntersectionObserver',
  'ResizeObserver',
  'MutationObserver',
  'requestAnimationFrame',
  'requestIdleCallback',
  'HTMLElement',
  'customElements',
]);
const COMPARISON = new Set(['==', '===', '!=', '!==']);

export interface BrowserAccess {
  /** The read, e.g. `window.innerWidth` (outermost node of the chain). */
  node: Node;
  name: string;
  owner: Exclude<BrowserReadOwner, null>;
  /** `typeof window`: an existence check, not a read. */
  typeofOperand: boolean;
}

export interface EnvironmentCheck {
  node: Node;
  /** Code whose result depends on the check (branches, the rest of the block). */
  regions: Node[];
}

interface CheckIndex {
  checks: EnvironmentCheck[];
  /** The checks each guarded region belongs to. */
  byRegion: Map<Node, EnvironmentCheck[]>;
  nodes: Set<Node>;
  /** Checks whose regions read storage or call matchMedia. */
  guardingStorage: Set<EnvironmentCheck>;
  reported: Map<EnvironmentCheck, boolean>;
}

interface FileAnalysis {
  accesses: BrowserAccess[];
  index: CheckIndex | null;
}

const cache = new WeakMap<object, FileAnalysis>();

/** A node and its ancestors, nearest first. */
function* selfAndAncestors(node: Node): Generator<Node> {
  for (let current: Node | null = node; current; current = parentOf(current)) yield current;
}

function analysis(context: Rule.RuleContext): FileAnalysis {
  const sourceCode = context.sourceCode;
  let result = cache.get(sourceCode);
  if (result) return result;
  const accesses: BrowserAccess[] = [];
  const seen = new Set<Node>();
  for (const identifiers of globalReferences(context).values()) {
    for (const identifier of identifiers) {
      const access = globalAccess(identifier);
      const owner = browserReadOwner(access.name, access.viaBrowserObject);
      if (!owner || seen.has(access.node)) continue;
      seen.add(access.node);
      accesses.push({ node: access.node, name: access.name, owner, typeofOperand: isTypeofOperand(access.node) });
    }
  }
  result = { accesses, index: null };
  cache.set(sourceCode, result);
  return result;
}

export function isTypeofOperand(node: Node): boolean {
  const { parent } = effectiveParent(node);
  return parent?.type === 'UnaryExpression' && parent.operator === 'typeof';
}

/** Every read of a browser-only global in the file (after resolving `window.`). */
export function browserAccesses(context: Rule.RuleContext): readonly BrowserAccess[] {
  return analysis(context).accesses;
}

export function environmentFlags(context: Rule.RuleContext): ReadonlySet<string> {
  const settings = context.settings['hydration-proof'] as HydrationProofSettings | undefined;
  const flags: unknown = settings?.environmentFlags;
  const extra = Array.isArray(flags) ? flags.filter((flag): flag is string => typeof flag === 'string') : [];
  return new Set([...DEFAULT_ENVIRONMENT_FLAGS, ...extra]);
}

/** Whether `typeof <operand>` tests for a browser-only global. */
function isEnvironmentOperand(context: Rule.RuleContext, operand: Node): boolean {
  let root = unwrap(operand);
  const name = globalName(context, root);
  if (name !== null && ENVIRONMENT_GLOBALS.has(name)) return true;
  while (root.type === 'MemberExpression') root = unwrap(root.object as Node);
  const rootName = globalName(context, root);
  return rootName !== null && ENVIRONMENT_GLOBALS.has(rootName);
}

function isTypeofEnvironment(context: Rule.RuleContext, node: Node): boolean {
  const inner = unwrap(node);
  return inner.type === 'UnaryExpression' && inner.operator === 'typeof' && isEnvironmentOperand(context, inner.argument as Node);
}

function isComparedValue(node: Node): boolean {
  const inner = unwrap(node);
  if (staticString(inner) !== null) return true;
  if (inner.type === 'UnaryExpression' && inner.operator === 'typeof') return true;
  if (inner.type === 'Literal') return inner.value === null || typeof inner.value === 'boolean';
  return inner.type === 'Identifier' && inner.name === 'undefined';
}

/**
 * Whether a value decides a branch: the test of `if`/`?:`, the left side of
 * `&&`/`||`/`??`, possibly negated or compared with a literal.
 */
export function isTestPosition(node: Node): boolean {
  let current = node;
  for (;;) {
    const { parent, child } = effectiveParent(current);
    if (!parent) return false;
    if (parent.type === 'UnaryExpression' && parent.operator === '!') current = parent;
    else if (parent.type === 'BinaryExpression' && COMPARISON.has(parent.operator)) {
      const other = (parent.left === child ? parent.right : parent.left) as Node;
      if (!isComparedValue(other)) return false;
      current = parent;
    } else if (parent.type === 'LogicalExpression') {
      if (parent.left === child) return true;
      current = parent;
    } else if (parent.type === 'IfStatement' || parent.type === 'ConditionalExpression') {
      return parent.test === child;
    } else return false;
  }
}

function flagReference(context: Rule.RuleContext, node: Node, flags: ReadonlySet<string>): boolean {
  if (node.type === 'Identifier') {
    if (!flags.has(node.name)) return false;
    const variable = findVariable(context, node);
    // Imports, module-level constants and globals. Locals (often the result
    // of a hook such as useIsClient) are not flags.
    return variable === null || isModuleLevel(variable);
  }
  if (node.type !== 'MemberExpression') return false;
  const property = propertyName(node);
  let root = unwrap(node.object as Node);
  // import.meta.env.SSR (Vite)
  if (property === 'SSR' && root.type === 'MemberExpression' && propertyName(root) === 'env' && unwrap(root.object as Node).type === 'MetaProperty') {
    return true;
  }
  if (property === 'browser' && root.type === 'Identifier' && root.name === 'process') return true;
  if (property === null || !flags.has(property)) return false;
  while (root.type === 'MemberExpression') root = unwrap(root.object as Node);
  if (root.type !== 'Identifier') return false;
  const variable = findVariable(context, root);
  return variable === null || isModuleLevel(variable);
}

/** Whether `node` is an environment check; `typeof` comparisons count anywhere, flags only as branch tests. */
export function isEnvironmentCheck(context: Rule.RuleContext, node: Node, flags: ReadonlySet<string>): boolean {
  if (node.type === 'BinaryExpression') {
    if (COMPARISON.has(node.operator)) {
      const left = node.left as Node;
      const right = node.right as Node;
      return (isTypeofEnvironment(context, left) && isComparedValue(right)) || (isTypeofEnvironment(context, right) && isComparedValue(left));
    }
    if (node.operator === 'in') {
      const key = staticString(node.left as Node);
      const target = globalName(context, node.right as Node);
      return key !== null && ENVIRONMENT_GLOBALS.has(key) && target !== null && GLOBAL_OBJECTS.has(target);
    }
    return false;
  }
  if (node.type === 'Identifier' || node.type === 'MemberExpression') {
    if (!isTestPosition(node)) return false;
    if (flagReference(context, node, flags)) return true;
    // globalThis.window, globalThis.document used as a test: safe on the server, but branches.
    if (node.type === 'MemberExpression' && unwrap(node.object as Node).type === 'Identifier') {
      const object = globalName(context, node.object as Node);
      const name = globalName(context, node);
      return object === 'globalThis' && name !== null && ENVIRONMENT_GLOBALS.has(name);
    }
  }
  return false;
}

function followingStatements(statement: Node): Node[] {
  const block = parentOf(statement);
  if (!block || (block.type !== 'BlockStatement' && block.type !== 'Program' && block.type !== 'StaticBlock')) return [];
  const body = block.body as Node[];
  return body.slice(body.indexOf(statement) + 1);
}

/** The code that only runs (or only matters) on one side of the check. */
function guardedRegions(context: Rule.RuleContext, check: Node, depth = 0): Node[] {
  const regions: Node[] = [];
  let current = check;
  for (;;) {
    const { parent, child } = effectiveParent(current);
    if (!parent) break;
    if (parent.type === 'UnaryExpression' && parent.operator === '!') {
      current = parent;
      continue;
    }
    if (parent.type === 'BinaryExpression' && COMPARISON.has(parent.operator)) {
      current = parent;
      continue;
    }
    if (parent.type === 'LogicalExpression') {
      if (parent.left === child) regions.push(parent.right as Node);
      current = parent;
      continue;
    }
    if (parent.type === 'ConditionalExpression' && parent.test === child) {
      regions.push(parent.consequent as Node, parent.alternate as Node);
    } else if (parent.type === 'IfStatement' && parent.test === child) {
      regions.push(parent.consequent as Node);
      if (parent.alternate) regions.push(parent.alternate as Node);
      if (alwaysExits(parent.consequent as Node)) regions.push(...followingStatements(parent));
    } else if (parent.type === 'VariableDeclarator' && parent.init === child && parent.id.type === 'Identifier' && depth === 0) {
      // const isClient = typeof window !== 'undefined'; ... isClient ? a : b
      const variable = findVariable(context, parent.id as Node);
      if (variable && variableDeclarator(variable) === parent) {
        for (const reference of variable.references) {
          if (reference.identifier !== parent.id) regions.push(...guardedRegions(context, reference.identifier as Node, 1));
        }
      }
    }
    break;
  }
  return regions;
}

function checkIndex(context: Rule.RuleContext): CheckIndex {
  const result = analysis(context);
  if (result.index) return result.index;
  const flags = environmentFlags(context);
  const index: CheckIndex = { checks: [], byRegion: new Map(), nodes: new Set(), guardingStorage: new Set(), reported: new Map() };
  walk(context.sourceCode.ast as Node, context.sourceCode.visitorKeys as VisitorKeys, (node) => {
    if (node.type !== 'BinaryExpression' && node.type !== 'Identifier' && node.type !== 'MemberExpression') return;
    if (!isEnvironmentCheck(context, node, flags)) return;
    const check: EnvironmentCheck = { node, regions: guardedRegions(context, node) };
    index.checks.push(check);
    index.nodes.add(node);
    for (const region of check.regions) index.byRegion.set(region, [...(index.byRegion.get(region) ?? []), check]);
    return false;
  });
  for (const access of result.accesses) {
    if (access.owner === 'browser-global' || access.typeofOperand) continue;
    for (const ancestor of selfAndAncestors(access.node)) {
      for (const check of index.byRegion.get(ancestor) ?? []) index.guardingStorage.add(check);
    }
  }
  result.index = index;
  return index;
}

/** Every environment check in the file with the code it guards. */
export function environmentChecks(context: Rule.RuleContext): readonly EnvironmentCheck[] {
  return checkIndex(context).checks;
}

/**
 * Whether no-window-render-branch reports this check. Checks inside state
 * initializers belong to no-client-only-initial-state, and checks that guard
 * storage or matchMedia reads are covered by the rules for those reads.
 */
export function isReportedCheck(context: Rule.RuleContext, check: EnvironmentCheck): boolean {
  const index = checkIndex(context);
  let reported = index.reported.get(check);
  if (reported === undefined) {
    const render = renderContext(check.node);
    reported = render !== null && render.initializer === null && !index.guardingStorage.has(check);
    index.reported.set(check, reported);
  }
  return reported;
}

/** Whether a read is part of an environment check (`globalThis.window ? ...`). */
export function isPartOfCheck(context: Rule.RuleContext, node: Node): boolean {
  const { nodes } = checkIndex(context);
  for (const ancestor of selfAndAncestors(node)) if (nodes.has(ancestor)) return true;
  return false;
}

/** Whether a read only happens behind a check that no-window-render-branch reports. */
export function isGuardedByReportedCheck(context: Rule.RuleContext, node: Node): boolean {
  const { byRegion } = checkIndex(context);
  for (const ancestor of selfAndAncestors(node)) {
    if (byRegion.get(ancestor)?.some((check) => isReportedCheck(context, check))) return true;
  }
  return false;
}

/** Whether storage or matchMedia is read inside `node`. */
export function readsStorageOrMatchMedia(context: Rule.RuleContext, node: Node): boolean {
  return browserAccesses(context).some((access) => access.owner !== 'browser-global' && !access.typeofOperand && isInside(access.node, node));
}
