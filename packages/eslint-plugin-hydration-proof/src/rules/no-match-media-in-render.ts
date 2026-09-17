import type { Rule } from 'eslint';
import type { Node } from '../utils/ast.ts';
import { effectiveParent, estree, sourceText } from '../utils/ast.ts';
import { browserAccesses } from '../utils/browser.ts';
import { renderContext } from '../utils/render-scope.ts';
import { createRule } from '../utils/rule.ts';

export const noMatchMediaInRender: Rule.RuleModule = createRule({
  name: 'no-match-media-in-render',
  meta: {
    type: 'problem',
    docs: { description: 'Disallow evaluating media queries with matchMedia while a component renders' },
    schema: [],
    messages: {
      matchMedia:
        '`{{read}}` evaluates a media query during render. The server has no screen or user preferences, so it renders a different branch than the browser does while hydrating. Render a neutral default and evaluate the query in useEffect or useSyncExternalStore (with getServerSnapshot), or use a CSS media query.',
    },
  },
  create(context) {
    return {
      'Program:exit'() {
        for (const access of browserAccesses(context)) {
          if (access.owner !== 'match-media' || access.typeofOperand || !renderContext(access.node)) continue;
          const { parent, child } = effectiveParent(access.node);
          const node: Node = parent?.type === 'CallExpression' && parent.callee === child ? parent : access.node;
          context.report({ node: estree(node), messageId: 'matchMedia', data: { read: sourceText(context.sourceCode, node) } });
        }
      },
    };
  },
});
