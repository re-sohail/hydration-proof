import type { MarkerRule } from '../dom/normalize.ts';
import { getAttr, isElement, isText } from '../dom/tree.ts';

// Helpers to describe framework markup that is not page content.

/** Drop inline scripts whose text matches. */
export function inlineScript(id: string, pattern: RegExp): MarkerRule {
  return {
    id,
    match: (node) => {
      if (!isElement(node) || node.tag !== 'script') return undefined;
      const text = node.children.map((child) => (isText(child) ? child.text : '')).join('');
      return pattern.test(text) ? 'drop' : undefined;
    },
  };
}

/** Drop external scripts whose src matches. */
export function scriptSource(id: string, pattern: RegExp): MarkerRule {
  return {
    id,
    match: (node) => (isElement(node) && node.tag === 'script' && pattern.test(getAttr(node, 'src') ?? '') ? 'drop' : undefined),
  };
}

/** Drop elements by tag name. */
export function elementTag(id: string, tags: readonly string[]): MarkerRule {
  const set = new Set(tags);
  return { id, match: (node) => (isElement(node) && set.has(node.tag) ? 'drop' : undefined) };
}

/** A client router navigation function for window.<name>.navigate(url). */
export function routerNavigate(global: string): string {
  return `(url) => { const router = window[${JSON.stringify(global)}]; if (!router || typeof router.navigate !== 'function') return false; void Promise.resolve(router.navigate(url)).catch(() => {}); return true; }`;
}
