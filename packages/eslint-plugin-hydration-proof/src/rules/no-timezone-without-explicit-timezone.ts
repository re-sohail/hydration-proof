import type { Rule } from 'eslint';
import type { Node } from '../utils/ast.ts';
import { callArguments, calleeObject, estree, isUndefinedValue, propertyName, sourceText, unwrap } from '../utils/ast.ts';
import { hasSpreadBefore, quote, setArgument } from '../utils/fixes.ts';
import { intlConstructor, isDateValue, objectKeys, resolvedOptionsRead } from '../utils/intl.ts';
import { renderContext } from '../utils/render-scope.ts';
import { createRule, ruleOptions } from '../utils/rule.ts';

export interface NoTimezoneWithoutExplicitTimezoneOptions {
  /** Time zone inserted by the suggestion. Default `'UTC'`. */
  defaultTimeZone?: string;
}

const DATE_FORMAT_METHODS = new Set(['toLocaleDateString', 'toLocaleTimeString']);
const DATE_FIELDS = new Set([
  'dateStyle',
  'timeStyle',
  'weekday',
  'era',
  'year',
  'month',
  'day',
  'dayPeriod',
  'hour',
  'minute',
  'second',
  'fractionalSecondDigits',
  'timeZoneName',
  'hour12',
  'hourCycle',
]);
const UTC_GETTERS = new Map([
  ['getHours', 'getUTCHours'],
  ['getDate', 'getUTCDate'],
  ['getDay', 'getUTCDay'],
  ['getMonth', 'getUTCMonth'],
  ['getFullYear', 'getUTCFullYear'],
  ['getMinutes', 'getUTCMinutes'],
]);
const LOCAL_TIME_METHODS = new Set([...UTC_GETTERS.keys(), 'getTimezoneOffset', 'toDateString', 'toTimeString', 'toString']);

type OptionsState = 'missing' | 'no-time-zone' | 'ok';

function optionsState(options: Node | undefined): OptionsState {
  if (!options || isUndefinedValue(options)) return 'missing';
  const keys = objectKeys(options);
  if (keys === null) return 'ok'; // not a literal: cannot tell
  return keys.includes('timeZone') ? 'ok' : 'no-time-zone';
}

export const noTimezoneWithoutExplicitTimezone: Rule.RuleModule = createRule({
  name: 'no-timezone-without-explicit-timezone',
  meta: {
    type: 'problem',
    docs: { description: 'Require an explicit timeZone when dates are formatted or split into parts during render' },
    hasSuggestions: true,
    schema: [
      {
        type: 'object',
        properties: { defaultTimeZone: { type: 'string', minLength: 1 } },
        additionalProperties: false,
      },
    ],
    messages: {
      missingTimeZone:
        "`{{call}}` formats the date in the time zone of whichever runtime renders it. Servers usually run in UTC and browsers in the visitor's zone, so the text does not match during hydration. Pass an explicit `timeZone` option.",
      localTime:
        "`{{call}}` reads the date in the runtime's local time zone, which differs between the server and the browser. Use the UTC methods, or format with an explicit `timeZone`.",
      runtimeTimeZone:
        "`{{call}}` reads the runtime's time zone, which differs between the server and the browser. Pass the time zone from the server, or read it after hydration.",
      addTimeZone: "Add timeZone: '{{timeZone}}'.",
      useUtc: 'Use {{method}}() (UTC).',
    },
  },
  create(context) {
    const { defaultTimeZone } = ruleOptions<Required<NoTimezoneWithoutExplicitTimezoneOptions>>(context, { defaultTimeZone: 'UTC' });
    const sourceCode = context.sourceCode;
    const zone = `timeZone: ${quote(defaultTimeZone)}`;

    function addTimeZone(fixer: Rule.RuleFixer, call: Node): Rule.Fix {
      const options = callArguments(call)[1];
      const object = options ? unwrap(options) : null;
      if (object?.type === 'ObjectExpression') {
        const first = object.properties[0];
        if (!first) return fixer.replaceText(estree(object), `{ ${zone} }`);
        return fixer.insertTextBefore(first, `${zone}, `);
      }
      return setArgument(fixer, sourceCode, call, 1, `{ ${zone} }`);
    }

    function reportMissing(call: Node, at: Node): void {
      context.report({
        node: estree(at),
        messageId: 'missingTimeZone',
        data: { call: sourceText(sourceCode, call) },
        suggest: [{ messageId: 'addTimeZone', data: { timeZone: defaultTimeZone }, fix: (fixer) => addTimeZone(fixer, call) }],
      });
    }

    const check = (node: Node): void => {
      const intl = intlConstructor(context, node);
      if (intl !== null) {
        if (intl !== 'DateTimeFormat' || hasSpreadBefore(node, 1) || !renderContext(node)) return;
        if (optionsState(callArguments(node)[1]) === 'ok') return;
        const resolved = resolvedOptionsRead(node);
        if (resolved) {
          if (resolved.property === 'timeZone') {
            context.report({ node: estree(resolved.call), messageId: 'runtimeTimeZone', data: { call: sourceText(sourceCode, resolved.call) } });
          }
          return;
        }
        // Report on `DateTimeFormat`, so the location differs from no-locale-without-explicit-locale's.
        const callee = unwrap((node as { callee: Node }).callee);
        reportMissing(node, callee.type === 'MemberExpression' ? (callee.property as Node) : callee);
        return;
      }
      if (node.type !== 'CallExpression') return;
      const callee = unwrap(node.callee as Node);
      const method = propertyName(callee);
      if (method === null || callee.type !== 'MemberExpression') return;
      const receiver = calleeObject(node);

      if (DATE_FORMAT_METHODS.has(method) || method === 'toLocaleString') {
        if (hasSpreadBefore(node, 1)) return;
        const options = callArguments(node)[1];
        const state = optionsState(options);
        if (state === 'ok') return;
        if (method === 'toLocaleString') {
          const keys = objectKeys(options) ?? [];
          if (!isDateValue(context, receiver) && !keys.some((key) => DATE_FIELDS.has(key))) return;
        }
        if (!renderContext(node)) return;
        reportMissing(node, callee.property as Node);
        return;
      }

      if (LOCAL_TIME_METHODS.has(method) && isDateValue(context, receiver) && renderContext(node)) {
        const utc = UTC_GETTERS.get(method);
        const property = callee.property as Node;
        context.report({
          node: estree(property),
          messageId: 'localTime',
          data: { call: sourceText(sourceCode, node) },
          suggest:
            utc !== undefined && defaultTimeZone === 'UTC' && !callee.computed
              ? [{ messageId: 'useUtc', data: { method: utc }, fix: (fixer) => fixer.replaceText(estree(property), utc) }]
              : [],
        });
      }
    };
    return { CallExpression: check, NewExpression: check };
  },
});
