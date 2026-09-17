import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nextAdapter } from '../../../src/adapters/next.ts';
import { resolveConfig } from '../../../src/config/resolve.ts';
import type { HydrationProofConfig } from '../../../src/config/types.ts';
import { linksFromSnapshot, patternFor } from '../../../src/routes/crawl.ts';
import { readNextManifests } from '../../../src/routes/manifests.ts';
import { readSitemaps } from '../../../src/routes/sitemap.ts';
import { NOT_FOUND_PATH, planServerRoutes, planStaticRoutes } from '../../../src/run/plan.ts';
import { doc, el, resetIds, text } from '../../helpers/tree.ts';

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function project(files: Record<string, string>): string {
  dir = mkdtempSync(join(tmpdir(), 'hp-plan-'));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

const manifests = {
  '.next/BUILD_ID': 'build-1',
  '.next/prerender-manifest.json': JSON.stringify({
    version: 4,
    routes: {
      '/blog/hello': { srcRoute: '/blog/[slug]' },
      '/blog/world': { srcRoute: '/blog/[slug]' },
      '/about': { srcRoute: null },
    },
  }),
  '.next/routes-manifest.json': JSON.stringify({ i18n: { locales: ['en', 'fr'], defaultLocale: 'en' } }),
};

function plan(config: HydrationProofConfig, rootDir: string) {
  const notes: string[] = [];
  const resolved = resolveConfig(config, { rootDir, env: {} });
  return { plan: planStaticRoutes({ ...resolved, cache: false }, nextAdapter, 'npm', notes), notes, resolved };
}

describe('Next.js build manifests', () => {
  it('reads pre-rendered examples, build id and locales', () => {
    const root = project(manifests);
    const info = readNextManifests(root);
    expect(info.buildId).toBe('build-1');
    expect(info.examples.get('/blog/[slug]')).toEqual(['/blog/hello', '/blog/world']);
    expect(info.locales).toEqual({ locales: ['en', 'fr'], defaultLocale: 'en' });
  });
});

describe('planStaticRoutes', () => {
  it('combines discovery, manifest examples, dynamic values and query variants', () => {
    const root = project({
      ...manifests,
      'package.json': JSON.stringify({ dependencies: { next: '16.3.5' } }),
      'app/page.tsx': '',
      'app/blog/[slug]/page.tsx': '',
      'app/products/[id]/page.tsx': '',
      'app/users/[name]/page.tsx': '',
      'app/search/page.tsx': '',
      'app/api/health/route.ts': '',
    });
    const { plan: result, notes } = plan(
      { routes: { dynamic: { '/products/[id]': ['1', '2'] }, query: { '/search': ['?q=shoes', 'page=2'] } } },
      root,
    );
    expect(result.routes.map((route) => [route.path, route.pattern, route.source])).toEqual([
      ['/', '/', 'discovered'],
      ['/blog/hello', '/blog/[slug]', 'manifest'],
      ['/blog/world', '/blog/[slug]', 'manifest'],
      ['/search', '/search', 'discovered'],
      ['/products/1', '/products/[id]', 'config'],
      ['/products/2', '/products/[id]', 'config'],
      ['/search?q=shoes', '/search', 'discovered'],
      ['/search?page=2', '/search', 'discovered'],
    ]);
    expect(notes[0]).toMatch(/Skipped 1 dynamic route without example values \(\/users\/\[name\]\)/);
    expect(result.patterns).toEqual(expect.arrayContaining(['/users/[name]', '/blog/[slug]']));
  });

  it('applies include, exclude and --grep', () => {
    const root = project({ 'package.json': '{"dependencies":{"next":"16"}}', 'app/page.tsx': '', 'app/a/page.tsx': '', 'app/b/page.tsx': '', 'app/admin/x/page.tsx': '' });
    expect(plan({ routes: { exclude: ['/admin/**'] } }, root).plan.routes.map((route) => route.path)).toEqual(['/', '/a', '/b']);
    expect(plan({ routes: { include: ['/a', '/admin/**'] } }, root).plan.routes.map((route) => route.path)).toEqual(['/a', '/admin/x']);
  });
});

describe('planServerRoutes', () => {
  it('adds sitemap routes on the tested host and the not-found probe', async () => {
    const root = project({ 'package.json': '{"dependencies":{"next":"16"}}', 'app/page.tsx': '' });
    const { plan: base, resolved } = plan({ routes: { sitemap: true } }, root);
    const pages: Record<string, string> = {
      'http://127.0.0.1:3000/robots.txt': 'User-agent: *\nSitemap: https://example.com/sitemap-index.xml\n',
      'http://127.0.0.1:3000/sitemap-index.xml':
        '<?xml version="1.0"?><sitemapindex><sitemap><loc>https://example.com/pages.xml</loc></sitemap></sitemapindex>',
      'http://127.0.0.1:3000/pages.xml':
        '<urlset><url><loc>https://example.com/</loc></url><url><loc>https://example.com/pricing?plan=pro&amp;x=1</loc></url></urlset>',
    };
    const notes: string[] = [];
    const result = await planServerRoutes({ ...resolved, cache: false }, nextAdapter, base, 'http://127.0.0.1:3000', async (url) => pages[url], notes);
    expect(result.routes.map((route) => [route.path, route.source])).toEqual([
      ['/', 'discovered'],
      ['/pricing?plan=pro&x=1', 'sitemap'],
      [NOT_FOUND_PATH, 'not-found'],
    ]);
    expect(result.routes.at(-1)?.expectStatus).toEqual([404]);
    expect(notes).toEqual([]);
  });

  it('reads a given sitemap and stops at the limit', async () => {
    const xml = `<urlset>${Array.from({ length: 10 }, (_, i) => `<url><loc>/p/${i}</loc></url>`).join('')}</urlset>`;
    const result = await readSitemaps('http://h.test', async (url) => (url === 'http://h.test/custom.xml' ? xml : undefined), '/custom.xml', 3);
    expect(result.paths).toEqual(['/p/0', '/p/1', '/p/2']);
  });
});

describe('crawling', () => {
  it('collects same-origin page links from a snapshot', () => {
    resetIds();
    const tree = doc([
      el('body', {}, [
        el('a', { href: '/about' }, [text('About')]),
        el('a', { href: 'pricing?x=1#plans' }),
        el('a', { href: 'https://other.test/x' }),
        el('a', { href: 'mailto:hi@x.test' }),
        el('a', { href: '/files/report.pdf' }),
        el('a', { href: '/export', download: '' }),
        el('a', { href: '#top' }),
      ]),
    ]);
    expect(linksFromSnapshot(tree, 'http://h.test/docs/')).toEqual(['/about', '/docs/pricing?x=1']);
  });

  it('maps crawled paths to the most specific pattern', () => {
    const patterns = ['/', '/blog', '/blog/[slug]', '/blog/[...rest]', '/shop/[[...filters]]', '/blog/new'];
    expect(patternFor('/blog/hello', patterns)).toBe('/blog/[slug]');
    expect(patternFor('/blog/new', patterns)).toBe('/blog/new');
    expect(patternFor('/blog/a/b', patterns)).toBe('/blog/[...rest]');
    expect(patternFor('/shop', patterns)).toBe('/shop/[[...filters]]');
    expect(patternFor('/unknown?x=1', patterns)).toBe('/unknown');
  });
});
