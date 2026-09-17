import type { Rule } from 'eslint';
import type { JSXAttribute, JSXChild, JSXElement, JSXOpeningElement, Node } from '../utils/ast.ts';
import { estree, isHostTag, jsxAttributeEnabled, jsxAttributeName, jsxTagName, parentOf, propertyName, staticString, unwrap } from '../utils/ast.ts';
import { isJSXValue, returnsJSX } from '../utils/render-scope.ts';
import { createRule, ruleOptions } from '../utils/rule.ts';

export interface AuditSuppressHydrationWarningOptions {
  /**
   * Elements where any use is accepted. Default `['html', 'body']`: theme and
   * extension scripts change their attributes before React hydrates.
   */
  allowOn?: string[];
  /** Report every other use too, so each one must be justified in a disable comment. Default `false`. */
  reportAll?: boolean;
}

const NON_CONTENT_ATTRIBUTE = /^(?:key|ref|suppressHydrationWarning|on[A-Z].*)$/;

function isStaticValue(node: Node): boolean {
  const value = unwrap(node);
  switch (value.type) {
    case 'Literal':
      return true;
    case 'TemplateLiteral':
      return value.expressions.length === 0;
    case 'UnaryExpression':
      return isStaticValue(value.argument as Node);
    case 'ArrayExpression':
      return value.elements.every((element) => element !== null && element.type !== 'SpreadElement' && isStaticValue(element as Node));
    case 'ObjectExpression':
      return value.properties.every(
        (property) => property.type === 'Property' && !property.computed && property.kind === 'init' && isStaticValue(property.value as Node),
      );
    case 'Identifier':
      return value.name === 'undefined';
    default:
      return false;
  }
}

function rendersElements(expression: Node): boolean {
  if (isJSXValue(expression)) return true;
  const value = unwrap(expression);
  if (value.type !== 'CallExpression') return false;
  const method = propertyName(unwrap(value.callee as Node));
  const callback = value.arguments[0] as Node | undefined;
  return (
    (method === 'map' || method === 'flatMap') &&
    (callback?.type === 'ArrowFunctionExpression' || callback?.type === 'FunctionExpression') &&
    returnsJSX(callback)
  );
}

function hasElementChildren(children: readonly JSXChild[]): boolean {
  return children.some((child) => {
    if (child.type === 'JSXElement') return true;
    if (child.type === 'JSXFragment') return hasElementChildren(child.children);
    if (child.type === 'JSXExpressionContainer') return child.expression.type !== 'JSXEmptyExpression' && rendersElements(child.expression as Node);
    return false;
  });
}

function isStaticElement(opening: JSXOpeningElement, children: readonly JSXChild[]): boolean {
  const attributesStatic = opening.attributes.every((attribute) => {
    if (attribute.type === 'JSXSpreadAttribute') return false;
    if (NON_CONTENT_ATTRIBUTE.test(jsxAttributeName(attribute))) return true;
    const value = attribute.value;
    if (value === null || value.type === 'Literal') return true;
    if (value.type !== 'JSXExpressionContainer') return false;
    return value.expression.type === 'JSXEmptyExpression' || isStaticValue(value.expression as Node);
  });
  const childrenStatic = children.every((child) => {
    if (child.type === 'JSXText') return true;
    if (child.type !== 'JSXExpressionContainer') return false;
    return child.expression.type === 'JSXEmptyExpression' || staticString(child.expression as Node) !== null || isStaticValue(child.expression as Node);
  });
  return attributesStatic && childrenStatic;
}

export const auditSuppressHydrationWarning: Rule.RuleModule = createRule({
  name: 'audit-suppress-hydration-warning',
  meta: {
    type: 'suggestion',
    docs: { description: 'Report suppressHydrationWarning where it has no effect or hides more than intended' },
    hasSuggestions: true,
    schema: [
      {
        type: 'object',
        properties: {
          allowOn: { type: 'array', items: { type: 'string' }, uniqueItems: true },
          reportAll: { type: 'boolean' },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      tooDeep:
        '`suppressHydrationWarning` on `<{{tag}}>` only covers its own attributes and text, not the elements inside it: a mismatch in a child is still an error. Put it on the element whose content differs.',
      unused:
        '`suppressHydrationWarning` on `<{{tag}}>` has nothing to suppress: its attributes and text are static. Remove it so that real mismatches added later are not hidden.',
      onComponent:
        '`suppressHydrationWarning` on `<{{tag}}>` does nothing unless the component passes it to an HTML element. Put it on the element that renders the differing content, or make sure `{{tag}}` forwards it.',
      audit:
        '`suppressHydrationWarning` hides hydration mismatches on `<{{tag}}>`. Render the same value on the server and in the browser instead, or explain why it is needed in an eslint-disable comment.',
      remove: 'Remove suppressHydrationWarning.',
    },
  },
  checksServerComponents: true,
  create(context) {
    const options = ruleOptions<Required<AuditSuppressHydrationWarningOptions>>(context, { allowOn: ['html', 'body'], reportAll: false });
    const allowOn = new Set(options.allowOn);
    const sourceCode = context.sourceCode;
    return {
      JSXAttribute(node) {
        const attribute = node as JSXAttribute;
        if (jsxAttributeName(attribute) !== 'suppressHydrationWarning' || !jsxAttributeEnabled(attribute)) return;
        const opening = parentOf(attribute) as JSXOpeningElement;
        const element = parentOf(opening) as JSXElement;
        const tag = jsxTagName(opening.name);
        const report = (messageId: string, suggest: Rule.SuggestionReportDescriptor[] = []): void => {
          context.report({ node: estree(attribute), messageId, data: { tag }, suggest });
        };
        if (allowOn.has(tag)) return;
        if (!isHostTag(tag)) return report('onComponent');
        if (hasElementChildren(element.children)) return report('tooDeep');
        if (isStaticElement(opening, element.children)) {
          return report('unused', [
            {
              messageId: 'remove',
              fix: (fixer) => {
                const before = sourceCode.getTokenBefore(estree(attribute));
                const start = before?.range[1] ?? attribute.range![0];
                return fixer.removeRange([start, attribute.range![1]]);
              },
            },
          ]);
        }
        if (options.reportAll) report('audit');
      },
    };
  },
});
