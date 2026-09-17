import type { Rule } from 'eslint';
import { estree } from '../utils/ast.ts';
import { idSources } from '../utils/ids.ts';
import { createRule } from '../utils/rule.ts';

export const noUnstableId: Rule.RuleModule = createRule({
  name: 'no-unstable-id',
  meta: {
    type: 'problem',
    docs: { description: 'Disallow ids built from random values, the clock or module-level counters' },
    schema: [],
    messages: {
      unstableId:
        '`{{source}}` makes `{{sink}}` differ between the server render and hydration, so the id and every reference to it (labels, ARIA attributes) do not match. Use React useId() to create ids.',
    },
  },
  create(context) {
    return {
      'Program:exit'() {
        for (const [node, { source, sink }] of idSources(context)) {
          context.report({ node: estree(node), messageId: 'unstableId', data: { source, sink } });
        }
      },
    };
  },
});
