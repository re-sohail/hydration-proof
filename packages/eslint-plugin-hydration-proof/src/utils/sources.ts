// Recognisers for values that differ between the server render and the
// hydration render: the clock, randomness, browser-only globals.
import type { Rule } from 'eslint';
import type { Node } from './ast.ts';
import { callArguments, propertyName, unwrap } from './ast.ts';
import { findVariable, globalName, importedCallee, isModuleLevel, variableDeclarator } from './scope.ts';

/** Browser-only globals that do not exist during server rendering. */
export const BROWSER_GLOBALS: ReadonlySet<string> = new Set([
  'window',
  'self',
  'document',
  'navigator',
  'location',
  'screen',
  'history',
  'innerWidth',
  'innerHeight',
  'outerWidth',
  'outerHeight',
  'devicePixelRatio',
  'visualViewport',
  'scrollX',
  'scrollY',
  'pageXOffset',
  'pageYOffset',
]);
export const STORAGE_GLOBALS: ReadonlySet<string> = new Set(['localStorage', 'sessionStorage']);
export const MATCH_MEDIA = 'matchMedia';
/**
 * Globals that exist on both sides; reads through `window.` are left to the
 * rule that owns the call (`window.Date.now()` is a clock read).
 */
const SHARED_GLOBALS: ReadonlySet<string> = new Set(['Date', 'Math', 'performance', 'crypto', 'Intl', 'Temporal']);

export type BrowserReadOwner = 'browser-global' | 'storage' | 'match-media' | null;

/** Which rule family owns a read of this global name (after resolving `window.`). */
export function browserReadOwner(name: string, viaBrowserObject: boolean): BrowserReadOwner {
  if (STORAGE_GLOBALS.has(name)) return 'storage';
  if (name === MATCH_MEDIA) return 'match-media';
  if (SHARED_GLOBALS.has(name)) return null;
  if (BROWSER_GLOBALS.has(name) || viaBrowserObject) return 'browser-global';
  return null;
}

/** `Date.now()`, `new Date()`, `Date()`, `performance.now()`, `Temporal.Now.*()`. */
export function timeSource(context: Rule.RuleContext, node: Node): string | null {
  if (node.type !== 'CallExpression' && node.type !== 'NewExpression') return null;
  const callee = unwrap(node.callee as Node);
  if (globalName(context, callee) === 'Date') {
    if (callArguments(node).length > 0) return null;
    return node.type === 'NewExpression' ? 'new Date()' : 'Date()';
  }
  if (node.type !== 'CallExpression' || callee.type !== 'MemberExpression') return null;
  const method = propertyName(callee);
  const object = unwrap(callee.object as Node);
  const objectName = globalName(context, object);
  if (method === 'now' && objectName === 'Date') return 'Date.now()';
  if (method === 'now' && objectName === 'performance') return 'performance.now()';
  if (object.type === 'MemberExpression' && propertyName(object) === 'Now' && globalName(context, object.object as Node) === 'Temporal') {
    return `Temporal.Now.${method ?? 'call'}()`;
  }
  return null;
}

const UUID_RANDOM = new Set(['v1', 'v4', 'v6', 'v7']);
const LODASH_RANDOM = new Set(['uniqueId', 'random', 'sample']);
const LODASH_SHUFFLE = new Set(['shuffle', 'sampleSize']);
const NODE_CRYPTO_RANDOM = new Set(['randomUUID', 'randomBytes', 'randomInt', 'getRandomValues']);
const NANOID_FACTORIES = new Set(['customAlphabet', 'customRandom']);

function lodashFunction(source: string, imported: string): string | null {
  // lodash, lodash-es, lodash/uniqueId, lodash-es/uniqueId, lodash.uniqueid
  const match = /^lodash(?:-es)?(?:\/(\w+))?$|^lodash\.(\w+)$/.exec(source);
  if (!match) return null;
  const single = match[1] ?? match[2];
  if (single !== undefined) {
    if (imported !== 'default') return null;
    const all = [...LODASH_RANDOM, ...LODASH_SHUFFLE];
    return all.find((name) => name.toLowerCase() === single.toLowerCase()) ?? null;
  }
  return imported;
}

function isNanoid(source: string): boolean {
  return source === 'nanoid' || source.startsWith('nanoid/');
}

/**
 * Random values: `Math.random()`, `crypto.randomUUID()`,
 * `crypto.getRandomValues()`, and imported id/random helpers
 * (uuid, nanoid, lodash).
 */
export function randomSource(context: Rule.RuleContext, node: Node): string | null {
  if (node.type !== 'CallExpression') return null;
  const callee = unwrap(node.callee as Node);
  if (callee.type === 'MemberExpression') {
    const method = propertyName(callee);
    const objectName = globalName(context, callee.object as Node);
    if (objectName === 'Math' && method === 'random') return 'Math.random()';
    if (objectName === 'crypto' && (method === 'randomUUID' || method === 'getRandomValues')) return `crypto.${method}()`;
  }
  const imported = importedCallee(context, callee);
  if (imported) {
    const { source, imported: name } = imported;
    if (source === 'uuid' && UUID_RANDOM.has(name)) return `uuid ${name}()`;
    if (isNanoid(source) && name === 'nanoid') return 'nanoid()';
    if ((source === 'crypto' || source === 'node:crypto') && NODE_CRYPTO_RANDOM.has(name)) return `crypto.${name}()`;
    const lodash = lodashFunction(source, name);
    if (lodash !== null && LODASH_RANDOM.has(lodash)) return `lodash ${lodash}()`;
  }
  // const makeId = customAlphabet('abc', 8) at module level, then makeId()
  if (callee.type === 'Identifier') {
    const variable = findVariable(context, callee);
    const declarator = variableDeclarator(variable);
    const init = declarator?.init ? unwrap(declarator.init as Node) : null;
    if (variable && isModuleLevel(variable) && init?.type === 'CallExpression') {
      const factory = importedCallee(context, init.callee as Node);
      if (factory && isNanoid(factory.source) && NANOID_FACTORIES.has(factory.imported)) return `${callee.name}() (nanoid)`;
    }
  }
  return null;
}

/** `shuffle(list)` / `sampleSize(list, n)` from lodash. */
export function shuffleHelper(context: Rule.RuleContext, node: Node): string | null {
  if (node.type !== 'CallExpression') return null;
  const imported = importedCallee(context, node.callee as Node);
  if (!imported) return null;
  const lodash = lodashFunction(imported.source, imported.imported);
  return lodash !== null && LODASH_SHUFFLE.has(lodash) ? lodash : null;
}
