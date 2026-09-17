import type { Rule } from 'eslint';
import { estree } from '../utils/ast.ts';
import { idSources } from '../utils/ids.ts';
import { renderContext } from '../utils/render-scope.ts';
import { createRule } from '../utils/rule.ts';
import { randomSource } from '../utils/sources.ts';

export const noRandomInRender: Rule.RuleModule = createRule({
  name: 'no-random-in-render',
  meta: {
    type: 'problem',
    docs: { description: 'Disallow random values while a component renders' },
    schema: [],
    messages: {
      random:
        '`{{source}}` returns a different value on the server and during hydration, so the rendered output does not match. Create the value on the server and pass it down, use useId() for ids, or generate it in useEffect after hydration.',
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const source = randomSource(context, node);
        if (source === null) return;
        const render = renderContext(node);
        // Ids belong to no-unstable-id, sort comparators to require-deterministic-list-order.
        if (!render || render.comparator || idSources(context).has(node)) return;
        context.report({ node: estree(node), messageId: 'random', data: { source } });
      },
    };
  },
});
