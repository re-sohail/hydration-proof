import type { Rule } from 'eslint';
import type { FunctionNode, Node, VisitorKeys } from '../utils/ast.ts';
import { callArguments, estree, hookName, isFunction, isInside, isUndefinedValue, sourceText, unwrap, walk } from '../utils/ast.ts';
import { browserAccesses, environmentChecks } from '../utils/browser.ts';
import { enclosingFunction } from '../utils/intl.ts';
import { findVariable, variableDeclarator } from '../utils/scope.ts';
import { createRule } from '../utils/rule.ts';
import { randomSource, timeSource } from '../utils/sources.ts';

const STORE_HOOKS = new Set(['useSyncExternalStore']);

/** An inline function, or a function declared in this file under the given name. */
function resolveFunction(context: Rule.RuleContext, node: Node): FunctionNode | null {
  const value = unwrap(node);
  if (isFunction(value)) return value;
  if (value.type !== 'Identifier') return null;
  const variable = findVariable(context, value);
  const def = variable?.defs.length === 1 ? variable.defs[0] : undefined;
  if (def?.type === 'FunctionName') return def.node as FunctionNode;
  const init = variableDeclarator(variable)?.init;
  const fn = init ? unwrap(init as Node) : null;
  return isFunction(fn) ? fn : null;
}

export const requireStableServerSnapshot: Rule.RuleModule = createRule({
  name: 'require-stable-server-snapshot',
  meta: {
    type: 'problem',
    docs: { description: 'Require useSyncExternalStore to have a getServerSnapshot that returns the same value on the server and during hydration' },
    schema: [],
    messages: {
      missingServerSnapshot:
        '`useSyncExternalStore` has no getServerSnapshot. React needs it to render on the server and to hydrate: without it the server render errors and the component is rendered again in the browser. Pass a third argument that returns the value the server renders.',
      unstableServerSnapshot:
        'getServerSnapshot reads `{{read}}`. It must return the same value on the server and while hydrating, so it cannot depend on the browser, the clock or randomness. Return a constant or data passed from the server.',
    },
  },
  create(context) {
    const inspected = new Set<Node>();
    const keys = context.sourceCode.visitorKeys as VisitorKeys;

    function report(node: Node): void {
      context.report({ node: estree(node), messageId: 'unstableServerSnapshot', data: { read: sourceText(context.sourceCode, node) } });
    }

    function inspect(fn: FunctionNode): void {
      if (inspected.has(fn)) return;
      inspected.add(fn);
      const ownCode = (node: Node): boolean => isInside(node, fn) && enclosingFunction(node) === fn;
      const checks = environmentChecks(context).filter((check) => ownCode(check.node));
      for (const check of checks) report(check.node);
      for (const access of browserAccesses(context)) {
        if (access.typeofOperand || !ownCode(access.node) || checks.some((check) => isInside(access.node, check.node))) continue;
        report(access.node);
      }
      walk(fn.body as Node, keys, (node) => {
        if (isFunction(node)) return false;
        if ((node.type === 'CallExpression' || node.type === 'NewExpression') && (timeSource(context, node) ?? randomSource(context, node)) !== null) {
          report(node);
        }
        return;
      });
    }

    return {
      CallExpression(node) {
        if (!STORE_HOOKS.has(hookName(node) ?? '')) return;
        const args = callArguments(node);
        if (args.some((arg) => arg.type === 'SpreadElement')) return;
        const server = args[2];
        if (!server || isUndefinedValue(server)) {
          context.report({ node: estree(node), messageId: 'missingServerSnapshot' });
          return;
        }
        const fn = resolveFunction(context, server);
        if (fn) inspect(fn);
      },
    };
  },
});
