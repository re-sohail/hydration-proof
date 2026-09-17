import { describe, expect, it } from 'vitest';
import { expandPattern, isDynamicPattern, matchesAny, matchesGlob, pathOf } from '../../../src/routes/pattern.ts';

describe('route globs', () => {
  it.each([
    ['/api/**', '/api', true],
    ['/api/**', '/api/users/1', true],
    ['/api/**', '/apix', false],
    ['/blog/*', '/blog/post', true],
    ['/blog/*', '/blog/post/comments', false],
    ['/**', '/', true],
    ['/products/[id]', '/products/[id]', true],
    ['/p?ge', '/page', true],
  ])('%s matches %s: %s', (glob, path, expected) => {
    expect(matchesGlob(path, glob)).toBe(expected);
  });

  it('matches any of several globs', () => {
    expect(matchesAny('/admin/users', ['/blog/**', '/admin/**'])).toBe(true);
    expect(matchesAny('/', [])).toBe(false);
  });

  it('strips query and hash', () => {
    expect(pathOf('/a/b?x=1#top')).toBe('/a/b');
    expect(pathOf('?x')).toBe('/');
  });
});

describe('dynamic patterns', () => {
  it('fills parameters in order', () => {
    expect(isDynamicPattern('/products/[id]')).toBe(true);
    expect(isDynamicPattern('/about')).toBe(false);
    expect(expandPattern('/products/[id]', '42')).toBe('/products/42');
    expect(expandPattern('/[lang]/products/[id]', 'en/42')).toBe('/en/products/42');
    expect(expandPattern('/users/[name]', 'a b')).toBe('/users/a%20b');
  });

  it('gives catch-alls the remaining segments', () => {
    expect(expandPattern('/docs/[...slug]', 'a/b/c')).toBe('/docs/a/b/c');
    expect(expandPattern('/shop/[[...slug]]', '')).toBe('/shop');
    expect(expandPattern('/[[...slug]]', '')).toBe('/');
  });
});
