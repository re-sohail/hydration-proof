import type { Rule } from 'eslint';
import type { Node } from '../utils/ast.ts';
import { estree } from '../utils/ast.ts';
import { idSources } from '../utils/ids.ts';
import { renderContext } from '../utils/render-scope.ts';
import { createRule } from '../utils/rule.ts';
import { timeSource } from '../utils/sources.ts';

export const noDateInRender: Rule.RuleModule = createRule({
  name: 'no-date-in-render',
  meta: {
    type: 'problem',
    docs: { description: 'Disallow reading the current time while a component renders' },
    schema: [],
    messages: {
      currentTime:
        '`{{source}}` reads the clock during render. The server renders one time and the browser another while hydrating, so the output does not match. Pass the time from the server (props or data), or read it in useEffect after hydration.',
    },
  },
  create(context) {
    const check = (node: Node): void => {
      const source = timeSource(context, node);
      if (source === null || !renderContext(node) || idSources(context).has(node)) return;
      context.report({ node: estree(node), messageId: 'currentTime', data: { source } });
    };
    return { CallExpression: check, NewExpression: check };
  },
});
