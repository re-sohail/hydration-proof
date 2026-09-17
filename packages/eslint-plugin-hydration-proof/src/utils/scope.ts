// Scope analysis helpers: real globals (not local variables that happen to be
// called `window`), variable lookup, and imports.
import type { Rule, Scope } from 'eslint';
import type * as ESTree from 'estree';
import type { Node } from './ast.ts';
import { estree, isInTypePosition, parentOf, propertyName, unwrap } from './ast.ts';

/** Names through which browser code reaches the global object. */
export const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(['window', 'globalThis', 'self']);

interface FileScopeInfo {
  globals: Map<string, ESTree.Identifier[]>;
  globalIdentifiers: Set<Node>;
  imports: Map<string, ImportBinding>;
}

export interface ImportBinding {
  source: string;
  /** Imported name, `'default'` or `'*'`. */
  imported: string;
}

const cache = new WeakMap<object, FileScopeInfo>();

function fileInfo(context: Rule.RuleContext): FileScopeInfo {
  const sourceCode = context.sourceCode;
  let info = cache.get(sourceCode);
  if (info) return info;
  const globals = new Map<string, ESTree.Identifier[]>();
  const globalIdentifiers = new Set<Node>();
  const add = (reference: Scope.Reference): void => {
    const identifier = reference.identifier as ESTree.Identifier;
    // JSX tag references (`<Foo />`) are components, never browser globals.
    if ((identifier as { type: string }).type !== 'Identifier') return;
    if ((reference as { isValueReference?: boolean }).isValueReference === false) return;
    if (isInTypePosition(identifier as Node)) return;
    const list = globals.get(identifier.name) ?? [];
    list.push(identifier);
    globals.set(identifier.name, list);
    globalIdentifiers.add(identifier as Node);
  };
  const globalScope = sourceCode.scopeManager.globalScope;
  if (globalScope) {
    for (const reference of globalScope.through) add(reference);
    for (const variable of globalScope.variables) {
      if (variable.defs.length === 0) for (const reference of variable.references) add(reference);
    }
  }
  const imports = new Map<string, ImportBinding>();
  for (const statement of sourceCode.ast.body as Node[]) {
    if (statement.type !== 'ImportDeclaration') continue;
    if ((statement as { importKind?: string }).importKind === 'type') continue;
    const source = String(statement.source.value);
    for (const specifier of statement.specifiers) {
      if ((specifier as { importKind?: string }).importKind === 'type') continue;
      const imported =
        specifier.type === 'ImportDefaultSpecifier'
          ? 'default'
          : specifier.type === 'ImportNamespaceSpecifier'
            ? '*'
            : specifier.imported.type === 'Identifier'
              ? specifier.imported.name
              : String(specifier.imported.value);
      imports.set(specifier.local.name, { source, imported });
    }
  }
  info = { globals, globalIdentifiers, imports };
  cache.set(sourceCode, info);
  return info;
}

/** Every value reference to a global variable, grouped by name. */
export function globalReferences(context: Rule.RuleContext): ReadonlyMap<string, readonly ESTree.Identifier[]> {
  return fileInfo(context).globals;
}

export function isGlobalIdentifier(context: Rule.RuleContext, node: Node): boolean {
  return node.type === 'Identifier' && fileInfo(context).globalIdentifiers.has(node);
}

/**
 * The global an expression refers to, looking through `window.`, `self.` and
 * `globalThis.`: `window.localStorage` gives "localStorage", `Date` gives
 * "Date", `window` gives "window". Null when it is not a global.
 */
export function globalName(context: Rule.RuleContext, expression: Node): string | null {
  const node = unwrap(expression);
  if (node.type === 'Identifier') return isGlobalIdentifier(context, node) ? node.name : null;
  if (node.type !== 'MemberExpression') return null;
  const object = globalName(context, node.object as Node);
  if (object === null || !GLOBAL_OBJECTS.has(object)) return null;
  return propertyName(node);
}

export interface GlobalAccess {
  /** The global that is read, after looking through `window.` and friends. */
  name: string;
  /** The outermost node of the access (`window.localStorage` for `window`). */
  node: Node;
  /** Whether the access went through `window` or `self`, which do not exist on the server. */
  viaBrowserObject: boolean;
}

/**
 * Starting at a global identifier, climbs `window.x.y` chains while the
 * current value is the global object.
 */
export function globalAccess(identifier: ESTree.Identifier): GlobalAccess {
  let node: Node = identifier as Node;
  let name = identifier.name;
  let viaBrowserObject = false;
  for (;;) {
    let parent = parentOf(node);
    let child = node;
    while (parent && (parent.type === 'TSNonNullExpression' || parent.type === 'TSAsExpression' || parent.type === 'TSSatisfiesExpression')) {
      child = parent;
      parent = parentOf(parent);
    }
    if (!GLOBAL_OBJECTS.has(name) || !parent || parent.type !== 'MemberExpression' || parent.object !== child) break;
    const property = propertyName(parent);
    if (property === null) break;
    if (name !== 'globalThis') viaBrowserObject = true;
    name = property;
    node = parent;
  }
  return { name, node, viaBrowserObject };
}

/** Finds the variable an identifier refers to, walking out from its scope. */
export function findVariable(context: Rule.RuleContext, identifier: Node): Scope.Variable | null {
  if (identifier.type !== 'Identifier') return null;
  let scope: Scope.Scope | null = context.sourceCode.getScope(estree(identifier));
  while (scope) {
    const variable = scope.set.get(identifier.name);
    if (variable) return variable;
    scope = scope.upper;
  }
  return null;
}

/** The import an identifier is bound to, if it is an (unshadowed) import. */
export function importBinding(context: Rule.RuleContext, identifier: Node): ImportBinding | null {
  if (identifier.type !== 'Identifier') return null;
  const binding = fileInfo(context).imports.get(identifier.name);
  if (!binding) return null;
  const variable = findVariable(context, identifier);
  return variable?.defs.some((def) => def.type === 'ImportBinding') ? binding : null;
}

/**
 * For `name()` or `namespace.name()` where the function comes from an import,
 * returns the import source and the imported function name.
 */
export function importedCallee(context: Rule.RuleContext, callee: Node): ImportBinding | null {
  const node = unwrap(callee);
  if (node.type === 'Identifier') return importBinding(context, node);
  if (node.type !== 'MemberExpression') return null;
  const object = importBinding(context, unwrap(node.object as Node));
  const property = propertyName(node);
  if (!object || property === null || (object.imported !== '*' && object.imported !== 'default')) return null;
  return { source: object.source, imported: property };
}

/** Whether a variable is declared at the top level of the module. */
export function isModuleLevel(variable: Scope.Variable): boolean {
  const type = variable.scope.type;
  return type === 'module' || type === 'global';
}

/** The declarator of a `const`/`let`/`var` variable, when it has exactly one definition. */
export function variableDeclarator(variable: Scope.Variable | null): ESTree.VariableDeclarator | null {
  if (!variable || variable.defs.length !== 1) return null;
  const def = variable.defs[0]!;
  return def.type === 'Variable' ? (def.node as ESTree.VariableDeclarator) : null;
}

export function declarationKind(variable: Scope.Variable): string | null {
  const def = variable.defs[0];
  return def?.type === 'Variable' ? (def.parent as ESTree.VariableDeclaration).kind : null;
}
