import type { Rule } from 'eslint';
import type { FunctionNode, Node, VisitorKeys } from '../utils/ast.ts';
import { callArguments, estree, isFunction, propertyName, sourceText, unwrap, walk } from '../utils/ast.ts';
import { hasSpreadBefore, isMissingLocale, quote, setArgument } from '../utils/fixes.ts';
import { idSources } from '../utils/ids.ts';
import { SORT_METHODS, renderContext } from '../utils/render-scope.ts';
import { createRule, ruleOptions } from '../utils/rule.ts';
import { randomSource, shuffleHelper } from '../utils/sources.ts';

export interface RequireDeterministicListOrderOptions {
  /** Locale inserted by the `localeCompare` suggestion. Default `'en-US'`. */
  defaultLocale?: string;
}

const RELATIONAL = new Set(['<', '>', '<=', '>=']);
const BOOLEAN_OPERATORS = new Set([...RELATIONAL, '==', '===', '!=', '!==']);

function isBooleanValue(node: Node | null | undefined): boolean {
  if (!node) return false;
  const value = unwrap(node);
  if (value.type === 'BinaryExpression') return BOOLEAN_OPERATORS.has(value.operator);
  if (value.type === 'UnaryExpression') return value.operator === '!';
  return value.type === 'Literal' && typeof value.value === 'boolean';
}

function returnsBoolean(fn: FunctionNode, keys: VisitorKeys): boolean {
  if (fn.body.type !== 'BlockStatement') return isBooleanValue(fn.body as Node);
  const returns: (Node | null)[] = [];
  walk(fn.body as Node, keys, (node) => {
    if (isFunction(node)) return false;
    if (node.type === 'ReturnStatement') returns.push((node.argument as Node | null) ?? null);
    return;
  });
  return returns.length > 0 && returns.every(isBooleanValue);
}

/** Simple operands can be repeated in a rewritten comparator without side effects. */
function isSimpleOperand(node: Node): boolean {
  const value = unwrap(node);
  if (value.type === 'Identifier' || value.type === 'Literal') return true;
  if (value.type !== 'MemberExpression') return false;
  return isSimpleOperand(value.object as Node) && (!value.computed || isSimpleOperand(value.property as Node));
}

export const requireDeterministicListOrder: Rule.RuleModule = createRule({
  name: 'require-deterministic-list-order',
  meta: {
    type: 'problem',
    docs: { description: 'Require list ordering during render to be the same on the server and in the browser' },
    hasSuggestions: true,
    schema: [
      {
        type: 'object',
        properties: { defaultLocale: { type: 'string', minLength: 1 } },
        additionalProperties: false,
      },
    ],
    messages: {
      randomComparator:
        'Sorting with `{{source}}` shuffles the list differently on the server and while hydrating, so the items render in a different order. Shuffle on the server and pass the result down, or shuffle after mount.',
      shuffleHelper:
        '`{{helper}}()` picks a random order during render, which differs between the server and hydration. Shuffle on the server and pass the result down, or shuffle after mount.',
      localeComparator:
        "`{{call}}` sorts by the runtime's default locale, which differs between the server and the browser, so the list order does not match during hydration. Pass an explicit locale.",
      booleanComparator:
        'This comparator returns a boolean. Comparators must return a negative number, zero or a positive number; with a boolean the order depends on the JavaScript engine, so the server and the browser can order items differently. Return a number instead.',
      addLocale: "Use the '{{locale}}' locale.",
      threeWay: 'Return 1, -1 or 0.',
    },
  },
  create(context) {
    const { defaultLocale } = ruleOptions<Required<RequireDeterministicListOrderOptions>>(context, { defaultLocale: 'en-US' });
    const sourceCode = context.sourceCode;
    const keys = sourceCode.visitorKeys as VisitorKeys;

    function checkComparator(call: Node): void {
      const comparator = unwrap(callArguments(call)[0] ?? call);
      if (!isFunction(comparator) || !returnsBoolean(comparator, keys)) return;
      const body = comparator.body.type === 'BlockStatement' ? null : unwrap(comparator.body as Node);
      const suggest: Rule.SuggestionReportDescriptor[] = [];
      if (body?.type === 'BinaryExpression' && RELATIONAL.has(body.operator) && isSimpleOperand(body.left as Node) && isSimpleOperand(body.right as Node)) {
        const left = sourceCode.getText(estree(body.left as Node));
        const right = sourceCode.getText(estree(body.right as Node));
        const [first, second] = body.operator.startsWith('>') ? ['>', '<'] : ['<', '>'];
        suggest.push({
          messageId: 'threeWay',
          fix: (fixer) => fixer.replaceText(estree(comparator.body as Node), `(${left} ${first} ${right} ? 1 : ${left} ${second} ${right} ? -1 : 0)`),
        });
      }
      context.report({ node: estree(comparator), messageId: 'booleanComparator', suggest });
    }

    return {
      CallExpression(node) {
        if (node.type !== 'CallExpression') return;
        const render = renderContext(node);
        if (!render) return;

        const helper = shuffleHelper(context, node);
        if (helper !== null) {
          context.report({ node: estree(node), messageId: 'shuffleHelper', data: { helper } });
          return;
        }

        const method = propertyName(unwrap(node.callee as Node));
        if (method !== null && SORT_METHODS.has(method)) checkComparator(node);

        if (!render.comparator) return;
        const source = randomSource(context, node);
        if (source !== null) {
          if (!idSources(context).has(node)) context.report({ node: estree(node), messageId: 'randomComparator', data: { source } });
          return;
        }
        if (method === 'localeCompare' && !hasSpreadBefore(node, 1) && isMissingLocale(callArguments(node)[1])) {
          context.report({
            node: estree(node),
            messageId: 'localeComparator',
            data: { call: sourceText(sourceCode, node) },
            suggest: [
              {
                messageId: 'addLocale',
                data: { locale: defaultLocale },
                fix: (fixer) => setArgument(fixer, sourceCode, node, 1, quote(defaultLocale)),
              },
            ],
          });
        }
      },
    };
  },
});
