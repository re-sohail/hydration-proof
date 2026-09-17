import type { SFragment } from '../shared/protocol.ts';
import { getAttr, isElement, walk } from '../dom/tree.ts';

// Link discovery from a page snapshot, and mapping URLs to route patterns.

const SKIPPED_EXTENSIONS = /\.(?:pdf|zip|gz|png|jpe?g|gif|svg|webp|avif|ico|mp4|webm|mp3|wav|css|js|json|xml|txt|csv|woff2?)$/i;

/** Same-origin page paths (with query, without hash) linked from the snapshot. */
export function linksFromSnapshot(tree: SFragment, pageUrl: string): string[] {
  const page = new URL(pageUrl);
  const out = new Set<string>();
  walk(tree, (node) => {
    if (!isElement(node) || (node.tag !== 'a' && node.tag !== 'area')) return;
    const href = getAttr(node, 'href');
    if (!href || href.startsWith('#') || /^(?:mailto|tel|javascript|data):/i.test(href)) return;
    if (getAttr(node, 'download') !== null) return;
    let url: URL;
    try {
      url = new URL(href, page);
    } catch {
      return;
    }
    if (url.origin !== page.origin || SKIPPED_EXTENSIONS.test(url.pathname)) return;
    out.add(`${url.pathname}${url.search}`);
  });
  return [...out];
}

function patternToRegExp(pattern: string): RegExp {
  let source = '';
  for (const part of pattern.split('/').filter(Boolean)) {
    if (/^\[\[\.\.\..+\]\]$/.test(part)) source += '(?:/.*)?';
    else if (/^\[\.\.\..+\]$/.test(part)) source += '/.+';
    else if (/^\[.+\]$/.test(part)) source += '/[^/]+';
    else source += `/${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`;
  }
  return new RegExp(`^${source || '/'}/?$`);
}

/** The most specific known pattern for `path`, or the path itself. */
export function patternFor(path: string, patterns: readonly string[]): string {
  const clean = path.split('?')[0] || '/';
  let best: string | undefined;
  let bestScore = -1;
  for (const pattern of patterns) {
    if (!patternToRegExp(pattern).test(clean)) continue;
    // Fewer dynamic segments = more specific.
    const score = 100 - (pattern.match(/\[/g)?.length ?? 0) * 10 - (pattern.includes('...') ? 5 : 0);
    if (score > bestScore) {
      best = pattern;
      bestScore = score;
    }
  }
  return best ?? clean;
}
