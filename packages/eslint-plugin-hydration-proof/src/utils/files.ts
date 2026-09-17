// Which files take part in hydration. Server Components render once on the
// server and never re-render in the browser, so render-time values there
// cannot differ between server and client.
import type { Rule } from 'eslint';
import type { Node } from './ast.ts';
import { unwrap } from './ast.ts';

export type ServerComponentsMode = 'none' | 'next-app';

/** Shape of `settings['hydration-proof']` in an ESLint config. */
export interface HydrationProofSettings {
  /**
   * How Server Components are recognised.
   * - `'none'` (default): every file is a client file.
   * - `'next-app'`: files under an `app/` directory without a `'use client'`
   *   directive are Server Components and are skipped.
   */
  serverComponents?: ServerComponentsMode;
  /** Extra identifiers treated as "running in the browser/server" flags by no-window-render-branch. */
  environmentFlags?: string[];
}

const cache = new WeakMap<object, boolean>();

export function serverComponentsMode(context: Rule.RuleContext): ServerComponentsMode {
  const settings = context.settings['hydration-proof'] as HydrationProofSettings | undefined;
  return settings?.serverComponents === 'next-app' ? 'next-app' : 'none';
}

/** The directive prologue of a module: `'use client'`, `'use server'`, `'use strict'`. */
export function directives(program: { body: readonly unknown[] }): string[] {
  const found: string[] = [];
  for (const statement of program.body as Node[]) {
    if (statement.type !== 'ExpressionStatement') break;
    const directive = (statement as { directive?: string }).directive;
    const expression = unwrap(statement.expression as Node);
    if (typeof directive === 'string') found.push(directive);
    else if (expression.type === 'Literal' && typeof expression.value === 'string') found.push(expression.value);
    else break;
  }
  return found;
}

function relativePath(filename: string, cwd: string): string {
  const file = filename.replaceAll('\\', '/');
  const base = cwd.replaceAll('\\', '/').replace(/\/+$/, '');
  return base && file.startsWith(`${base}/`) ? file.slice(base.length + 1) : file;
}

/** Whether a path has an `app` directory segment (`app/page.tsx`, `src/app/x/page.tsx`). */
export function isUnderAppDirectory(filename: string, cwd: string): boolean {
  const segments = relativePath(filename, cwd).split('/');
  return segments.slice(0, -1).includes('app');
}

/**
 * True for files whose components never hydrate: modules marked `'use server'`,
 * and (with `serverComponents: 'next-app'`) App Router files without `'use client'`.
 */
export function isServerOnlyFile(context: Rule.RuleContext): boolean {
  const sourceCode = context.sourceCode;
  const cached = cache.get(sourceCode);
  if (cached !== undefined) return cached;
  const found = directives(sourceCode.ast);
  let result = found.includes('use server');
  if (!result && serverComponentsMode(context) === 'next-app' && !found.includes('use client')) {
    result = isUnderAppDirectory(context.filename, context.cwd);
  }
  cache.set(sourceCode, result);
  return result;
}
