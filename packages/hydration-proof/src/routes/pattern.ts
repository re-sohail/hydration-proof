// Route globs and dynamic segment expansion.

const cache = new Map<string, RegExp>();

/** `**` matches any number of segments, `*` one segment, `?` one character. */
export function globToRegExp(glob: string): RegExp {
  const cached = cache.get(glob);
  if (cached) return cached;
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          source += '(?:.*/)?';
        } else {
          source += '.*';
        }
      } else {
        source += '[^/]*';
      }
    } else if (ch === '?') {
      source += '[^/]';
    } else {
      source += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  const regexp = new RegExp(`^${source}/?$`);
  cache.set(glob, regexp);
  return regexp;
}

export function matchesGlob(path: string, glob: string): boolean {
  return globToRegExp(glob).test(path);
}

export function matchesAny(path: string, globs: readonly string[]): boolean {
  return globs.some((glob) => matchesGlob(path, glob));
}

export function pathOf(url: string): string {
  const withoutHash = url.split('#')[0] ?? url;
  return withoutHash.split('?')[0] || '/';
}

const SEGMENT = /\[\[\.\.\.([^\]]+)\]\]|\[\.\.\.([^\]]+)\]|\[([^\]]+)\]/g;

export function isDynamicPattern(pattern: string): boolean {
  return /\[[^\]]+\]/.test(pattern);
}

/**
 * Fill a dynamic pattern with one example value. Values for several
 * parameters are separated by `/`; a catch-all takes the remaining parts.
 *   expandPattern('/products/[id]', '42')            -> '/products/42'
 *   expandPattern('/[lang]/blog/[...slug]', 'en/a/b') -> '/en/blog/a/b'
 */
export function expandPattern(pattern: string, value: string): string {
  const parts = value.split('/').filter((part, index, all) => part !== '' || all.length === 1);
  let cursor = 0;
  const filled = pattern.replace(SEGMENT, (_match, optionalCatchAll: string | undefined, catchAll: string | undefined) => {
    if (optionalCatchAll !== undefined || catchAll !== undefined) {
      const rest = parts.slice(cursor).join('/');
      cursor = parts.length;
      return rest;
    }
    return encodeURIComponent(parts[cursor++] ?? '');
  });
  const normalized = filled.replace(/\/{2,}/g, '/');
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
}
