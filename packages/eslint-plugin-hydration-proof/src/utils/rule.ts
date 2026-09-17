import type { Rule } from 'eslint';
import type { Node } from './ast.ts';
import { isServerOnlyFile } from './files.ts';

export const DOCS_BASE_URL = 'https://hydration.jscrate.dev/docs/rules/';

export function docsUrl(name: string): string {
  return `${DOCS_BASE_URL}${name}`;
}

export type Listeners = Record<string, (node: Node) => void>;

export interface RuleSpec {
  name: string;
  meta: {
    type: 'problem' | 'suggestion' | 'layout';
    docs: { description: string };
    hasSuggestions?: boolean;
    schema: Rule.RuleMetaData['schema'];
    messages: Record<string, string>;
  };
  /**
   * Rules about the HTML structure keep running in Server Component files:
   * React still hydrates the elements a Server Component renders.
   */
  checksServerComponents?: boolean;
  create(context: Rule.RuleContext): Listeners;
}

export function createRule(spec: RuleSpec): Rule.RuleModule {
  return {
    meta: {
      ...spec.meta,
      docs: { ...spec.meta.docs, url: docsUrl(spec.name) },
    },
    create(context) {
      if (!spec.checksServerComponents && isServerOnlyFile(context)) return {};
      return spec.create(context) as unknown as Rule.RuleListener;
    },
  };
}

/** The first options object of a rule, merged over the defaults. */
export function ruleOptions<T extends object>(context: Rule.RuleContext, defaults: T): T {
  const given = (context.options[0] ?? {}) as Partial<T>;
  return { ...defaults, ...given };
}
