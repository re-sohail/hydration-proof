import type { Rule } from 'eslint';
import type { Node } from '../utils/ast.ts';
import { estree, sourceText } from '../utils/ast.ts';
import { browserAccesses, environmentChecks, isPartOfCheck, readsStorageOrMatchMedia } from '../utils/browser.ts';
import { renderContext } from '../utils/render-scope.ts';
import { createRule } from '../utils/rule.ts';

function hookLabel(hook: string): string {
  return hook === 'state' ? 'class state' : hook;
}

export const noClientOnlyInitialState: Rule.RuleModule = createRule({
  name: 'no-client-only-initial-state',
  meta: {
    type: 'problem',
    docs: { description: 'Disallow initial state and refs computed from browser-only values' },
    schema: [],
    messages: {
      browserRead:
        'The initial value of `{{hook}}` reads `{{read}}`, which only exists in the browser. The server renders with a fallback and the browser with the real value, so hydration does not match. Initialize with the value the server can render and update it in useEffect.',
      environmentCheck:
        'The initial value of `{{hook}}` depends on `{{check}}`, so the server and the browser start from different state and hydration does not match. Initialize with the value the server can render and update it in useEffect.',
    },
  },
  create(context) {
    return {
      'Program:exit'() {
        const withReads = new Set<Node>();
        for (const access of browserAccesses(context)) {
          if (access.owner !== 'browser-global' || access.typeofOperand || isPartOfCheck(context, access.node)) continue;
          const initializer = renderContext(access.node)?.initializer;
          if (!initializer) continue;
          withReads.add(initializer.node);
          context.report({
            node: estree(access.node),
            messageId: 'browserRead',
            data: { hook: hookLabel(initializer.hook), read: sourceText(context.sourceCode, access.node) },
          });
        }
        // Initializers that only branch on the environment: report the first check.
        const reported = new Set<Node>();
        for (const check of environmentChecks(context)) {
          const initializer = renderContext(check.node)?.initializer;
          if (!initializer || withReads.has(initializer.node) || reported.has(initializer.node)) continue;
          // Storage and matchMedia reads are reported by their own rules.
          if (readsStorageOrMatchMedia(context, initializer.node)) continue;
          reported.add(initializer.node);
          context.report({
            node: estree(check.node),
            messageId: 'environmentCheck',
            data: { hook: hookLabel(initializer.hook), check: sourceText(context.sourceCode, check.node) },
          });
        }
      },
    };
  },
});
