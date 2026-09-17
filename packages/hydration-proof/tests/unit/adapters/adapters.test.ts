import { request } from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ADAPTERS, noneAdapter, selectAdapter } from '../../../src/adapters/index.ts';
import { parseRunRequest, startDashboard } from '../../../src/dev/dashboard.ts';
import { editorArguments, openInEditor } from '../../../src/dev/editor.ts';
import { routesFor } from '../../../src/dev/watch.ts';
import { DEFAULT_NORMALIZE, normalizeTree } from '../../../src/dom/normalize.ts';
import { runDetectors } from '../../../src/engine/enrich.ts';
import { defineAdapter, definePlugin, toMarker } from '../../../src/plugins/index.ts';
import type { Issue } from '../../../src/report/model.ts';
import { discoverAstroRoutes, flattenRouteTree, toPatternSegment } from '../../../src/routes/route-tree.ts';
import type { RoutePlan } from '../../../src/run/plan.ts';
import type { SElement } from '../../../src/shared/protocol.ts';
import { doc, el, text } from '../../helpers/tree.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'hp-adapter-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

const pkg = (deps: Record<string, string>, scripts: Record<string, string> = {}): string => JSON.stringify({ dependencies: deps, scripts });

describe('route trees', () => {
  it('converts route segments', () => {
    expect(['users', ':id', ':lang?', '*', 'docs?'].map(toPatternSegment)).toEqual(['users', '[id]', '[[lang]]', '[...splat]', 'docs']);
  });

  it('flattens React Router and Remix route trees', () => {
    const tree = [
      {
        id: 'root',
        path: '',
        file: 'root.tsx',
        children: [
          { id: 'routes/_index', index: true, file: 'routes/_index.tsx' },
          { id: 'routes/about', path: 'about', file: 'routes/about.tsx' },
          {
            id: 'routes/dashboard',
            path: 'dashboard',
            file: 'routes/dashboard.tsx',
            children: [
              { id: 'routes/dashboard._index', index: true, file: 'routes/dashboard._index.tsx' },
              { id: 'routes/dashboard.$team', path: ':team', file: 'routes/dashboard.$team.tsx' },
            ],
          },
          { id: 'routes/_auth', file: 'routes/_auth.tsx', children: [{ id: 'routes/_auth.login', path: 'login', file: 'routes/_auth.login.tsx' }] },
          { id: 'routes/docs.$', path: 'docs/*', file: 'routes/docs.$.tsx' },
        ],
      },
    ];
    expect(flattenRouteTree(tree, 'app')).toEqual([
      { pattern: '/', dynamic: false, router: 'react-router', file: 'app/routes/_index.tsx', wrappers: ['app/root.tsx'] },
      { pattern: '/about', dynamic: false, router: 'react-router', file: 'app/routes/about.tsx', wrappers: ['app/root.tsx'] },
      { pattern: '/dashboard', dynamic: false, router: 'react-router', file: 'app/routes/dashboard._index.tsx', wrappers: ['app/root.tsx', 'app/routes/dashboard.tsx'] },
      { pattern: '/dashboard/[team]', dynamic: true, router: 'react-router', file: 'app/routes/dashboard.$team.tsx', wrappers: ['app/root.tsx', 'app/routes/dashboard.tsx'] },
      { pattern: '/docs/[...splat]', dynamic: true, router: 'react-router', file: 'app/routes/docs.$.tsx', wrappers: ['app/root.tsx'] },
      { pattern: '/login', dynamic: false, router: 'react-router', file: 'app/routes/_auth.login.tsx', wrappers: ['app/root.tsx', 'app/routes/_auth.tsx'] },
    ]);
  });

  it('discovers Astro pages', () => {
    const root = project({
      'src/pages/index.astro': '',
      'src/pages/about.md': '',
      'src/pages/blog/[slug].astro': '',
      'src/pages/docs/[...path].astro': '',
      'src/pages/_draft.astro': '',
      'src/pages/_partials/nav.astro': '',
      'src/pages/api/data.json.ts': '',
    });
    expect(discoverAstroRoutes(root).map((route) => [route.pattern, route.dynamic, route.file])).toEqual([
      ['/', false, 'src/pages/index.astro'],
      ['/about', false, 'src/pages/about.md'],
      ['/blog/[slug]', true, 'src/pages/blog/[slug].astro'],
      ['/docs/[...path]', true, 'src/pages/docs/[...path].astro'],
    ]);
  });
});

describe('adapters', () => {
  it.each([
    ['next', pkg({ next: '16', react: '19' }), {}],
    ['react-router', pkg({ '@react-router/dev': '8', 'react-dom': '19' }, { start: 'react-router-serve ./build/server/index.js' }), {}],
    ['remix', pkg({ '@remix-run/dev': '2', 'react-dom': '18' }, { start: 'remix-serve ./build/server/index.js' }), { 'vite.config.ts': '' }],
    ['astro', pkg({ astro: '7', '@astrojs/react': '6', '@astrojs/node': '11', 'react-dom': '19' }, { start: 'node ./dist/server/entry.mjs' }), {}],
    ['vite', pkg({ vite: '8', 'react-dom': '19' }, { build: 'vite build', start: 'node server.js', dev: 'node server.js' }), { 'server.js': '' }],
    ['node', pkg({ express: '5', 'react-dom': '19' }, { start: 'node server.js' }), {}],
    ['none', pkg({ react: '19' }), {}],
  ])('detects %s', (name, packageJson, files) => {
    const root = project({ 'package.json': packageJson, ...files });
    expect(selectAdapter('auto', root).name).toBe(name);
  });

  it('builds the right commands', () => {
    const remix = project({ 'package.json': pkg({ '@remix-run/dev': '2' }, { build: 'remix vite:build' }), 'vite.config.ts': '' });
    expect(selectAdapter('remix', remix).commands({ rootDir: remix, packageManager: 'pnpm' })).toEqual({
      build: 'pnpm run build',
      start: 'pnpm exec remix-serve ./build/server/index.js',
      dev: 'pnpm exec remix vite:dev --port {port} --strictPort --host 127.0.0.1',
      buildOutput: 'build/server/index.js',
    });
    const astro = project({ 'package.json': pkg({ astro: '7' }) });
    expect(selectAdapter('astro', astro).commands({ rootDir: astro, packageManager: 'npm' })).toMatchObject({
      start: 'npx --no-install astro preview --port {port} --host 127.0.0.1',
      buildOutput: 'dist',
      env: { HOST: '127.0.0.1', ASTRO_DEV_BACKGROUND: '1' },
    });
    const vite = project({ 'package.json': pkg({ vite: '8' }, { build: 'vite build', preview: 'node server.js' }) });
    expect(selectAdapter('vite', vite).commands({ rootDir: vite, packageManager: 'yarn' })).toMatchObject({ build: 'yarn build', start: 'yarn preview', dev: '' });
    expect(ADAPTERS.map((adapter) => adapter.name)).toEqual(['next', 'react-router', 'remix', 'astro', 'vite', 'node']);
  });

  it('selects plugin adapters and adapter objects, and rejects unknown names', () => {
    const custom = defineAdapter({ name: 'waku', detect: () => true, commands: () => ({ start: 'waku start', dev: 'waku dev' }), notFound: true });
    expect(custom).toMatchObject({ name: 'waku', markers: [], notFound: true });
    expect(selectAdapter('waku', '/nowhere', [custom])).toBe(custom);
    expect(selectAdapter('auto', '/nowhere', [custom])).toBe(custom);
    expect(selectAdapter(custom, '/nowhere')).toBe(custom);
    expect(selectAdapter('none', '/nowhere', [custom])).toBe(noneAdapter);
    expect(() => selectAdapter('gatsby', '/nowhere')).toThrow(/Unknown adapter "gatsby"/);
    expect(defineAdapter({ name: 'bare' }).detect('/x')).toBe(false);
  });
});

describe('normalization', () => {
  it('ignores attributes only on the listed elements', () => {
    const tree = doc([el('astro-island', { ssr: '', uid: 'a', 'data-x': '1' }, [el('p', { ssr: 'kept' }, [text('x')])])]);
    const normalized = normalizeTree(tree, { ...DEFAULT_NORMALIZE, elementAttributes: { 'astro-island': ['ssr', 'uid'] } }).tree;
    const island = normalized.children[0] as SElement;
    expect(island.attrs).toEqual([['data-x', '1']]);
    expect((island.children[0] as SElement).attrs).toEqual([['ssr', 'kept']]);
  });

  it('runs plugin normalizers as markers', () => {
    const plugin = definePlugin({
      name: 'widgets',
      normalizers: [{ name: 'chat', match: (node) => (node.k === 1 && node.tag === 'chat-widget' ? 'drop' : undefined) }],
    });
    const tree = doc([el('main', {}, [el('chat-widget'), el('p')])]);
    const normalized = normalizeTree(tree, { ...DEFAULT_NORMALIZE, markers: [...DEFAULT_NORMALIZE.markers, ...plugin.normalizers!.map(toMarker)] });
    expect((normalized.tree.children[0] as SElement).children.map((child) => (child as SElement).tag)).toEqual(['p']);
    expect([...normalized.dropped.values()]).toContain('chat');
  });
});

describe('plugin cause detectors', () => {
  const issue = (): Issue => ({
    fingerprint: 'f',
    code: 'HP1001',
    title: 't',
    severity: 'error',
    confidence: 0.9,
    message: 'm',
    route: { url: 'http://x/', pattern: '/' },
    scenario: 'default',
    stage: 'hydration',
    evidence: [],
    suggestions: ['generic'],
    docsUrl: '',
    server: 'Plan: free',
    client: 'Plan: pro',
    cause: { id: 'data', title: 'Data', confidence: 0.5 },
  });

  it('replaces a weaker cause and survives failing detectors', () => {
    const target = issue();
    runDetectors(
      target,
      [
        {
          name: 'broken',
          detect: () => {
            throw new Error('boom');
          },
        },
        {
          name: 'flags',
          detect: (found) =>
            found.client?.includes('pro') ? { id: 'feature-flag', title: 'Feature flag', confidence: 0.8, reason: 'The plan comes from a flag.', fixes: ['Read flags on the server.'] } : undefined,
        },
        { name: 'weak', detect: () => ({ id: 'weak', title: 'Weak', confidence: 0.1 }) },
      ],
      { scenario: {}, server: {} },
    );
    expect(target.cause).toEqual({ id: 'feature-flag', title: 'Feature flag', confidence: 0.8 });
    expect(target.suggestions).toEqual(['Read flags on the server.', 'generic']);
    expect(target.evidence.map((entry) => entry.message)).toEqual([
      'Likely cause (flags): Feature flag. The plan comes from a flag.',
      'The cause detector "broken" failed: boom',
    ]);
  });

  it('never overrides a proven cause', () => {
    const target = { ...issue(), cause: { id: 'time', title: 'Time', confidence: 0.99, proven: true } };
    runDetectors(target, [{ name: 'x', detect: () => ({ id: 'x', title: 'X', confidence: 1 }) }], { scenario: {}, server: {} });
    expect(target.cause.id).toBe('time');
  });
});

describe('editor', () => {
  it('builds editor arguments', () => {
    expect(editorArguments('/usr/local/bin/code', '/p/a.tsx', 3, 7)).toEqual(['-g', '/p/a.tsx:3:7']);
    expect(editorArguments('webstorm', '/p/a.tsx', 3)).toEqual(['--line', '3', '--column', '1', '/p/a.tsx']);
    expect(editorArguments('nvim', '/p/a.tsx', 3)).toEqual(['+3', '/p/a.tsx']);
    expect(editorArguments('zed.exe', '/p/a.tsx', 3, 2)).toEqual(['/p/a.tsx:3:2']);
    expect(editorArguments('myeditor', '/p/a.tsx', 3)).toEqual(['/p/a.tsx']);
  });

  it('only opens files inside the project', () => {
    const root = project({ 'src/a.tsx': '' });
    expect(openInEditor('/etc/hosts', 1, undefined, root, { PATH: '' }).message).toMatch(/outside the project/);
    expect(openInEditor('src/missing.tsx', 1, undefined, root, { PATH: '' }).message).toMatch(/does not exist/);
    expect(openInEditor('src/a.tsx', 1, undefined, root, { PATH: '' })).toEqual({ opened: false, message: expect.stringMatching(/No editor found/) });
  });
});

describe('dashboard', () => {
  it('validates run requests', () => {
    expect(parseRunRequest({ routes: ['pricing', ' /blog '], mode: 'both', probe: true, navigation: false, grep: 'x' })).toEqual({
      routes: ['/pricing', '/blog'],
      mode: 'both',
      probes: true,
      navigation: false,
      grep: 'x',
    });
    expect(() => parseRunRequest({ command: 'rm -rf /' })).toThrow(/Unknown option "command"/);
    expect(() => parseRunRequest({ mode: 'fast' })).toThrow(/mode/);
    expect(() => parseRunRequest({ routes: '/x' })).toThrow(/list of strings/);
    expect(() => parseRunRequest([])).toThrow(/JSON object/);
  });

  it('requires the token, its own host name and origin', async () => {
    const root = project({ 'report/report.html': '<p>report</p>', 'report/screenshots/a.jpg': 'jpg', 'secret.txt': 'secret' });
    const dashboard = await startDashboard({ cwd: root, outputDir: join(root, 'report'), write: () => {} });
    try {
      const url = new URL(dashboard.url);
      const token = url.searchParams.get('token')!;
      const origin = url.origin;
      const get = (path: string): Promise<Response> => fetch(`${origin}${path}`);
      expect((await get(`/?token=${token}`)).status).toBe(200);
      expect((await get('/?token=wrong')).status).toBe(403);
      expect((await get('/')).status).toBe(403);
      expect(await (await get(`/report/${token}/report.html`)).text()).toBe('<p>report</p>');
      expect((await get(`/report/${token}/screenshots/a.jpg`)).headers.get('content-type')).toBe('image/jpeg');
      expect((await get('/report/wrong/report.html')).status).toBe(403);
      expect((await get(`/report/${token}/..%2Fsecret.txt`)).status).toBe(403);
      expect((await get(`/report/${token}/missing.html`)).status).toBe(404);
      const post = (path: string, body: string, headers: Record<string, string>): Promise<Response> => fetch(`${origin}${path}`, { method: 'POST', body, headers });
      expect((await post('/api/run', '{}', { 'content-type': 'application/json' })).status).toBe(403);
      expect((await post('/api/run', '{}', { 'content-type': 'application/json', 'x-hydration-proof-token': token, origin: 'http://evil.test' })).status).toBe(403);
      expect((await post('/api/run', '{"x":1}', { 'content-type': 'application/json', 'x-hydration-proof-token': token })).status).toBe(400);
      expect((await post('/api/run', '{}', { 'content-type': 'text/plain', 'x-hydration-proof-token': token })).status).toBe(415);
      expect((await post('/api/stop', '{}', { 'content-type': 'application/json', 'x-hydration-proof-token': token })).status).toBe(202);
      const status = await new Promise<number>((resolve) => {
        const req = request({ host: '127.0.0.1', port: url.port, path: `/?token=${token}`, headers: { host: `evil.test:${url.port}` } }, (res) => resolve(res.statusCode ?? 0));
        req.end();
      });
      expect(status).toBe(403);
    } finally {
      await dashboard.close();
    }
  });
});

describe('watch mode', () => {
  it('selects the planned routes of affected patterns', () => {
    const plan = {
      routes: [
        { path: '/', pattern: '/', source: 'discovered' },
        { path: '/products/1', pattern: '/products/[id]', source: 'manifest' },
        { path: '/products/2', pattern: '/products/[id]', source: 'manifest', expectStatus: [200] },
        { path: '/hydration-proof-not-found', pattern: '(not found)', source: 'not-found' },
      ],
      patterns: [],
      flags: {},
      discovered: [],
    } as RoutePlan;
    expect(routesFor(plan, new Set(['/products/[id]', '(not found)']))).toEqual([
      { path: '/products/1', pattern: '/products/[id]' },
      { path: '/products/2', pattern: '/products/[id]', expectStatus: [200] },
    ]);
  });
});
