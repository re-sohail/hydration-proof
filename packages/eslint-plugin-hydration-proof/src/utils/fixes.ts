// Text edits used by suggestions. Suggestions only add explicit arguments;
// they never change what the code computes beyond the reported problem.
import type { Rule, SourceCode } from 'eslint';
import type { Node } from './ast.ts';
import { callArguments, estree, isUndefinedValue, unwrap } from './ast.ts';

export function quote(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
}

/** Sets argument `index` of a call, filling skipped positions with `undefined`. */
export function setArgument(fixer: Rule.RuleFixer, sourceCode: SourceCode, call: Node, index: number, text: string): Rule.Fix {
  const args = callArguments(call);
  const existing = args[index];
  if (existing) return fixer.replaceText(estree(existing), text);
  const insertion = [...Array.from({ length: index - args.length }, () => 'undefined'), text].join(', ');
  const last = args.at(-1);
  if (last) return fixer.insertTextAfter(estree(last), `, ${insertion}`);
  const closing = sourceCode.getLastToken(estree(call));
  if (closing?.value === ')') return fixer.insertTextBefore(closing, insertion);
  // `new Intl.NumberFormat` without parentheses
  return fixer.insertTextAfter(estree(call), `(${insertion})`);
}

/** Whether a locale argument is missing: absent, `undefined` or `[]`. */
export function isMissingLocale(arg: Node | undefined): boolean {
  if (!arg) return true;
  if (arg.type === 'SpreadElement') return false;
  const inner = unwrap(arg);
  if (inner.type === 'ArrayExpression') return inner.elements.length === 0;
  return isUndefinedValue(inner);
}

/** Whether the call has a spread argument at or before `index` (positions unknown). */
export function hasSpreadBefore(call: Node, index: number): boolean {
  return callArguments(call)
    .slice(0, index + 1)
    .some((arg) => arg.type === 'SpreadElement');
}
