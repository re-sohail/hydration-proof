import type { Rule } from 'eslint';
import { estree, sourceText } from '../utils/ast.ts';
import { browserAccesses, isGuardedByReportedCheck, isPartOfCheck } from '../utils/browser.ts';
import { renderContext } from '../utils/render-scope.ts';
import { createRule } from '../utils/rule.ts';

export const noBrowserGlobalInRender: Rule.RuleModule = createRule({
  name: 'no-browser-global-in-render',
  meta: {
    type: 'problem',
    docs: { description: 'Disallow reading browser-only globals such as window and document while a component renders' },
    schema: [],
    messages: {
      browserGlobal:
        '`{{read}}` is read during render, but it does not exist when the server renders. The server output and the first browser render disagree (or the server crashes). Read it in useEffect after hydration, or use useSyncExternalStore with a getServerSnapshot.',
    },
  },
  create(context) {
    return {
      'Program:exit'() {
        for (const access of browserAccesses(context)) {
          // typeof checks: no-window-render-branch. Storage and matchMedia have their own rules.
          if (access.owner !== 'browser-global' || access.typeofOperand) continue;
          const render = renderContext(access.node);
          // State initializers: no-client-only-initial-state.
          if (!render || render.initializer) continue;
          if (isPartOfCheck(context, access.node) || isGuardedByReportedCheck(context, access.node)) continue;
          context.report({ node: estree(access.node), messageId: 'browserGlobal', data: { read: sourceText(context.sourceCode, access.node) } });
        }
      },
    };
  },
});
