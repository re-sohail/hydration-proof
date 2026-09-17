import type { Rule } from 'eslint';
import { estree, sourceText } from '../utils/ast.ts';
import { environmentChecks, isReportedCheck } from '../utils/browser.ts';
import { createRule } from '../utils/rule.ts';

export const noWindowRenderBranch: Rule.RuleModule = createRule({
  name: 'no-window-render-branch',
  meta: {
    type: 'problem',
    docs: { description: 'Disallow rendering different output depending on whether the code runs on the server or in the browser' },
    schema: [],
    messages: {
      environmentBranch:
        '`{{check}}` makes the render output depend on where the code runs. The server takes one branch and the browser the other while hydrating, so the HTML does not match. Render the same output first and switch after mount (useEffect and state), or use useSyncExternalStore with a getServerSnapshot.',
    },
  },
  create(context) {
    return {
      'Program:exit'() {
        for (const check of environmentChecks(context)) {
          if (!isReportedCheck(context, check)) continue;
          context.report({ node: estree(check.node), messageId: 'environmentBranch', data: { check: sourceText(context.sourceCode, check.node) } });
        }
      },
    };
  },
});
