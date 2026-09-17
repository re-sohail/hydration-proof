import type { Rule } from 'eslint';
import { estree, sourceText } from '../utils/ast.ts';
import { browserAccesses } from '../utils/browser.ts';
import { renderContext } from '../utils/render-scope.ts';
import { createRule } from '../utils/rule.ts';

export const noStorageInInitialRender: Rule.RuleModule = createRule({
  name: 'no-storage-in-initial-render',
  meta: {
    type: 'problem',
    docs: { description: 'Disallow reading localStorage or sessionStorage while a component renders, including state initializers' },
    schema: [],
    messages: {
      storage:
        '`{{read}}` is read during render. Storage only exists in the browser, so the server renders without the stored value and hydration sees a different result. Render the default first and read storage in useEffect, or use useSyncExternalStore with a getServerSnapshot.',
      storageInitialState:
        'The initial value of `{{hook}}` reads `{{read}}`. Storage only exists in the browser, so the server renders the default while the browser starts from the stored value and hydration does not match. Start from the default and load the stored value in useEffect.',
    },
  },
  create(context) {
    return {
      'Program:exit'() {
        for (const access of browserAccesses(context)) {
          if (access.owner !== 'storage' || access.typeofOperand) continue;
          const render = renderContext(access.node);
          if (!render) continue;
          const read = sourceText(context.sourceCode, access.node);
          if (render.initializer) {
            context.report({ node: estree(access.node), messageId: 'storageInitialState', data: { read, hook: render.initializer.hook } });
          } else {
            context.report({ node: estree(access.node), messageId: 'storage', data: { read } });
          }
        }
      },
    };
  },
});
