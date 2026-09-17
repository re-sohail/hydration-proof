import type { Rule } from 'eslint';
import type { Node } from '../utils/ast.ts';
import { callArguments, estree, propertyName, sourceText, unwrap } from '../utils/ast.ts';
import { hasSpreadBefore, isMissingLocale, quote, setArgument } from '../utils/fixes.ts';
import { LOCALE_METHODS, intlConstructor, resolvedOptionsRead } from '../utils/intl.ts';
import { renderContext } from '../utils/render-scope.ts';
import { createRule, ruleOptions } from '../utils/rule.ts';

export interface NoLocaleWithoutExplicitLocaleOptions {
  /** Locale inserted by the suggestion. Default `'en-US'`. */
  defaultLocale?: string;
}

export const noLocaleWithoutExplicitLocale: Rule.RuleModule = createRule({
  name: 'no-locale-without-explicit-locale',
  meta: {
    type: 'problem',
    docs: { description: 'Require an explicit locale for locale-sensitive formatting during render' },
    hasSuggestions: true,
    schema: [
      {
        type: 'object',
        properties: { defaultLocale: { type: 'string', minLength: 1 } },
        additionalProperties: false,
      },
    ],
    messages: {
      missingLocale:
        "`{{call}}` uses the default locale of whichever runtime renders it. The server's locale and the visitor's browser locale usually differ, so the text does not match during hydration. Pass an explicit locale that is the same on the server and in the browser.",
      runtimeLocale:
        "`{{call}}` reads the runtime's default locale, which differs between the server and the browser. Pass the locale from the server instead.",
      addLocale: "Use the '{{locale}}' locale.",
    },
  },
  create(context) {
    const { defaultLocale } = ruleOptions<Required<NoLocaleWithoutExplicitLocaleOptions>>(context, { defaultLocale: 'en-US' });
    const sourceCode = context.sourceCode;

    function report(node: Node, localeIndex: number): void {
      context.report({
        node: estree(node),
        messageId: 'missingLocale',
        data: { call: sourceText(sourceCode, node) },
        suggest: [
          {
            messageId: 'addLocale',
            data: { locale: defaultLocale },
            fix: (fixer) => setArgument(fixer, sourceCode, node, localeIndex, quote(defaultLocale)),
          },
        ],
      });
    }

    const check = (node: Node): void => {
      const intl = intlConstructor(context, node);
      if (intl !== null) {
        if (hasSpreadBefore(node, 0) || !isMissingLocale(callArguments(node)[0]) || !renderContext(node)) return;
        const resolved = resolvedOptionsRead(node);
        if (resolved) {
          // Intl.DateTimeFormat().resolvedOptions().timeZone is a time zone read (no-timezone-without-explicit-timezone).
          if (resolved.property === 'locale') {
            context.report({ node: estree(resolved.call), messageId: 'runtimeLocale', data: { call: sourceText(sourceCode, resolved.call) } });
          }
          return;
        }
        report(node, 0);
        return;
      }
      if (node.type !== 'CallExpression') return;
      const method = propertyName(unwrap(node.callee as Node));
      if (method === null) return;
      const localeIndex = LOCALE_METHODS.has(method) ? 0 : method === 'localeCompare' ? 1 : -1;
      if (localeIndex < 0 || hasSpreadBefore(node, localeIndex) || !isMissingLocale(callArguments(node)[localeIndex])) return;
      const render = renderContext(node);
      if (!render) return;
      // localeCompare inside a sort comparator: require-deterministic-list-order.
      if (method === 'localeCompare' && render.comparator) return;
      report(node, localeIndex);
    };
    return { CallExpression: check, NewExpression: check };
  },
});
