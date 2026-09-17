import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { discoverNextRoutes } from '../../../src/routes/next.ts';

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function tree(files: string[]): string {
  dir = mkdtempSync(join(tmpdir(), 'hp-next-'));
  for (const file of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), '');
  }
  return dir;
}

describe('discoverNextRoutes', () => {
  it('handles App Router conventions', () => {
    const root = tree([
      'app/page.tsx',
      'app/layout.tsx',
      'app/(marketing)/pricing/page.tsx',
      'app/blog/[slug]/page.mdx',
      'app/docs/[...path]/page.js',
      'app/shop/[[...filters]]/page.jsx',
      'app/_components/page.tsx',
      'app/@modal/login/page.tsx',
      'app/feed/(..)photo/[id]/page.tsx',
      'app/api/users/route.ts',
      'app/%5Fescaped/page.tsx',
    ]);
    expect(discoverNextRoutes(root).map((route) => [route.pattern, route.dynamic, route.router])).toEqual([
      ['/', false, 'app'],
      ['/_escaped', false, 'app'],
      ['/blog/[slug]', true, 'app'],
      ['/docs/[...path]', true, 'app'],
      ['/pricing', false, 'app'],
      ['/shop/[[...filters]]', true, 'app'],
    ]);
  });

  it('handles Pages Router conventions', () => {
    const root = tree([
      'src/pages/index.tsx',
      'src/pages/_app.tsx',
      'src/pages/_document.tsx',
      'src/pages/404.tsx',
      'src/pages/about.jsx',
      'src/pages/blog/index.js',
      'src/pages/blog/[id].tsx',
      'src/pages/api/hello.ts',
      'src/pages/utils.test.ts',
    ]);
    const routes = discoverNextRoutes(root);
    expect(routes.map((route) => route.pattern)).toEqual(['/', '/404', '/about', '/blog', '/blog/[id]']);
    expect(routes.find((route) => route.pattern === '/404')?.expectStatus).toEqual([404]);
  });

  it('discovers the fixture apps', () => {
    const root = new URL('../../../../../fixtures/next-app', import.meta.url).pathname;
    const routes = discoverNextRoutes(root);
    expect(routes.map((route) => route.pattern)).toContain('/date-now');
    expect(routes.every((route) => route.router === 'app')).toBe(true);
    dir = mkdtempSync(join(tmpdir(), 'hp-next-'));
  });
});
