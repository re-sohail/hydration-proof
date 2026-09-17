import type { Rule } from 'eslint';
import type { Node } from '../utils/ast.ts';
import { estree, writeExpression } from '../utils/ast.ts';
import { idSources } from '../utils/ids.ts';
import { renderContext } from '../utils/render-scope.ts';
import { createRule, ruleOptions } from '../utils/rule.ts';
import { declarationKind } from '../utils/scope.ts';

export interface NoGlobalRenderCounterOptions {
  /** Module-level variable names that may be written during render (for example a deliberate cache). */
  allow?: string[];
}

export const noGlobalRenderCounter: Rule.RuleModule = createRule({
  name: 'no-global-render-counter',
  meta: {
    type: 'problem',
    docs: { description: 'Disallow changing module-level variables while a component renders' },
    schema: [
      {
        type: 'object',
        properties: { allow: { type: 'array', items: { type: 'string' }, uniqueItems: true } },
        additionalProperties: false,
      },
    ],
    messages: {
      moduleWrite:
        'Module-level `{{name}}` is changed during render. The server keeps its value across every request while the browser starts from the initial value, so anything derived from it does not match during hydration (and React may render twice in development). Keep the value in state or a ref, or use useId() for ids.',
    },
  },
  create(context) {
    const allow = new Set(ruleOptions<Required<NoGlobalRenderCounterOptions>>(context, { allow: [] }).allow);
    return {
      'Program:exit'() {
        const ids = idSources(context);
        for (const scope of context.sourceCode.scopeManager.scopes) {
          if (scope.type !== 'module' && scope.type !== 'global') continue;
          for (const variable of scope.variables) {
            const kind = declarationKind(variable);
            if ((kind !== 'let' && kind !== 'var') || allow.has(variable.name)) continue;
            for (const reference of variable.references) {
              if (!reference.isWrite() || reference.init) continue;
              const write = writeExpression(reference.identifier as Node);
              if (!renderContext(write) || ids.has(write)) continue;
              context.report({ node: estree(write), messageId: 'moduleWrite', data: { name: variable.name } });
            }
          }
        }
      },
    };
  },
});
