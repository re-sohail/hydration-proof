import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyBaseline, buildBaseline, readBaseline, writeBaseline } from '../../../src/ci/baseline.ts';
import { FINGERPRINT_VERSION } from '../../../src/issues/fingerprint.ts';
import { codeownersRegex, OwnerResolver, ownersOf, parseCodeowners } from '../../../src/ci/owners.ts';
import { createRedactor } from '../../../src/ci/redact.ts';
import { githubWorkflow, gitlabJob } from '../../../src/cli/ci-templates.ts';
import { parseTestArgs } from '../../../src/cli/commands/test.ts';
import { resolveConfig } from '../../../src/config/resolve.ts';
import type { HydrationProofConfig } from '../../../src/config/types.ts';
import { appendHistory, historyEntry, readHistory } from '../../../src/report/history.ts';
import { mergeReports } from '../../../src/report/merge.ts';
import type { Issue, PageResult, Report } from '../../../src/report/model.ts';
import { routesAffectedBy } from '../../../src/routes/changed.ts';
import { discoverNextRoutes } from '../../../src/routes/next.ts';
import { policy, summarize } from '../../../src/run/results.ts';
import { changedFiles } from '../../../src/util/git.ts';

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

function project(files: Record<string, string>): string {
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'hp-ci-')));
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), content);
  }
  return dir;
}

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    fingerprint: 'fp1',
    code: 'HP1001',
    title: 'Text differs between server and client',
    severity: 'error',
    confidence: 0.9,
    message: 'm',
    route: { url: 'http://127.0.0.1:4000/products/1', pattern: '/products/[id]' },
    scenario: 'default',
    stage: 'hydration',
    evidence: [],
    suggestions: [],
    docsUrl: '',
    selector: '#price',
    ...overrides,
  };
}

function page(overrides: Partial<PageResult> = {}): PageResult {
  return {
    id: '/products/1 [default]',
    route: { url: 'http://127.0.0.1:4000/products/1', pattern: '/products/[id]' },
    scenario: 'default',
    url: 'http://127.0.0.1:4000/products/1',
    finalUrl: 'http://127.0.0.1:4000/products/1',
    status: 'failed',
    outcome: 'hydrated',
    timings: { navigation: 1, total: 2 },
    issues: ['fp1'],
    counts: { error: 1, warning: 0, info: 0 },
    ...overrides,
  };
}

function report(pages: PageResult[], issues: Issue[], run: Partial<Report['run']> = {}): Report {
  return {
    schemaVersion: 1,
    fingerprintVersion: 1,
    tool: { name: 'hydration-proof', version: '0.7.0' },
    run: {
      startedAt: '2026-09-17T10:00:00.000Z',
      finishedAt: '2026-09-17T10:01:00.000Z',
      durationMs: 60_000,
      cwd: '/app',
      node: 'v24',
      platform: 'linux-x64',
      playwright: '1.63.0',
      browsers: ['chromium 140'],
      mode: 'production',
      baseUrl: 'http://127.0.0.1:4000',
      ...run,
    },
    summary: summarize(pages, issues),
    pages,
    issues,
  };
}

describe('redaction', () => {
  it('removes emails, tokens, card numbers and secret URL parameters', () => {
    const redactor = createRedactor({ patterns: [/ACME-\d{4}/] })!;
    const text = [
      'Signed in as jane.doe@example.com',
      'Bearer abcdefghijklmnopqrstuvwxyz0123',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      'card 4242 4242 4242 4242 but not 1234 5678 9012 3456',
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      'order ACME-1234',
      '/reset?token=abc123&page=2',
    ].join(' | ');
    expect(redactor.text(text)).toBe(
      [
        'Signed in as [email]',
        '[token]',
        '[jwt]',
        'card [card] but not 1234 5678 9012 3456',
        '[token]',
        'order [redacted]',
        '/reset?token=[redacted]&page=2',
      ].join(' | '),
    );
    expect(Object.fromEntries(redactor.counts)).toEqual({ email: 1, token: 2, jwt: 1, card: 1, custom: 1, 'url-parameter': 1 });
  });

  it('does not mistake timestamps and ids for card numbers', () => {
    const redactor = createRedactor({})!;
    // Millisecond timestamps pass the Luhn check about one time in ten.
    const values = ['1789667900435', '1789667889352', '1000000000009', '0000000000000', '9999999999999994', '12345678903555'];
    for (const value of values) expect(redactor.text(`Rendered at ${value}`)).toBe(`Rendered at ${value}`);
    for (const card of ['4111111111111111', '5500 0055 5555 5559', '3782-822463-10005', '6011000990139424']) {
      expect(redactor.text(`pay ${card}`)).toBe('pay [card]');
    }
  });

  it('redacts a whole report without touching fingerprints, and can be turned off', () => {
    const redactor = createRedactor({})!;
    const found = issue({ server: 'Hi jane@example.com', client: 'Hi guest', evidence: [{ kind: 'note', message: 'user jane@example.com' }] });
    const shown = redactor.report(report([page({ serverLogs: ['login failed for jane@example.com'] })], [found]));
    expect(shown.issues[0]).toMatchObject({ fingerprint: 'fp1', server: 'Hi [email]', client: 'Hi guest', evidence: [{ message: 'user [email]' }] });
    expect(shown.pages[0]!.serverLogs).toEqual(['login failed for [email]']);
    expect(found.server).toBe('Hi jane@example.com');
    const builtInOff = createRedactor({ builtIn: false })!;
    expect(builtInOff.text('jane@example.com')).toBe('jane@example.com');
    expect(createRedactor(false)).toBeUndefined();
  });
});

describe('owners', () => {
  it.each([
    ['*.js', 'src/app.js', true],
    ['*.js', 'app.jsx', false],
    ['/build/', 'build/out.js', true],
    ['/build/', 'src/build/out.js', false],
    ['docs/', 'packages/docs/a.md', true],
    ['apps/web/', 'apps/web/app/page.tsx', true],
    ['apps/*/page.tsx', 'apps/web/page.tsx', true],
    ['apps/*/page.tsx', 'apps/web/app/page.tsx', false],
    ['apps/**/page.tsx', 'apps/web/app/page.tsx', true],
    ['/src/components', 'src/components/Button.tsx', true],
    ['Button.tsx', 'src/components/Button.tsx', true],
  ])('%s matches %s: %s', (pattern, path, expected) => {
    expect(codeownersRegex(pattern).test(path)).toBe(expected);
  });

  it('uses the last matching CODEOWNERS line and route owners from the config', () => {
    const rules = parseCodeowners(['# owners', '*       @acme/frontend', '/apps/shop/ @acme/shop jane@example.com', '[Section]', '/apps/shop/legacy/'].join('\n'));
    expect(ownersOf(rules, 'apps/web/page.tsx')).toEqual(['@acme/frontend']);
    expect(ownersOf(rules, 'apps/shop/cart.tsx')).toEqual(['@acme/shop', 'jane@example.com']);
    expect(ownersOf(rules, 'apps/shop/legacy/old.tsx')).toEqual([]);

    const root = project({ '.git/HEAD': '', '.github/CODEOWNERS': '/apps/shop/ @acme/shop\n', 'apps/shop/cart.tsx': '' });
    const resolver = new OwnerResolver({ rootDir: join(root, 'apps', 'shop'), routes: { '/checkout/**': ['@acme/payments'] }, codeowners: true });
    const issues = [
      issue({ route: { url: 'http://x/checkout/pay', pattern: '/checkout/pay' } }),
      issue({ source: { file: 'cart.tsx', line: 3 } }),
      issue({ route: { url: 'http://x/', pattern: '/' } }),
    ];
    resolver.assign(issues);
    expect(issues.map((entry) => entry.owners)).toEqual([['@acme/payments'], ['@acme/shop'], undefined]);
  });
});

describe('baseline', () => {
  it('records findings, keeps reasons and marks new, known and expired findings', () => {
    const now = new Date('2026-09-17T12:00:00Z');
    const first = buildBaseline([issue(), issue({ scenario: 'dark' }), issue({ fingerprint: 'fp2', ignored: { reason: 'x', rule: 'ignore.issues' } })], undefined, now);
    expect(first.entries).toEqual([
      { fingerprint: 'fp1', code: 'HP1001', title: 'Text differs between server and client', route: '/products/[id]', selector: '#price', scenarios: ['dark', 'default'], firstSeen: '2026-09-17', lastSeen: '2026-09-17' },
    ]);
    first.entries[0]!.reason = 'Known price bug';
    first.entries[0]!.expires = '2026-09-30';
    const root = project({});
    const file = join(root, '.hydration-proof', 'baseline.json');
    writeBaseline(file, first, root);
    const read = readBaseline(file)!;
    expect(JSON.parse(readFileSync(file, 'utf8')).$schema).toBe('../node_modules/hydration-proof/schema/baseline.json');

    const later = buildBaseline([issue({ cause: { id: 'data', title: 'd', confidence: 0.7 } })], read, new Date('2026-10-01T00:00:00Z'));
    expect(later.entries[0]).toMatchObject({ firstSeen: '2026-09-17', lastSeen: '2026-10-01', reason: 'Known price bug', expires: '2026-09-30', cause: 'data' });

    const current = [issue(), issue({ fingerprint: 'fresh' })];
    expect(applyBaseline(current, read, { newOnly: true, now })).toEqual([]);
    expect(current[0]).toMatchObject({ baseline: { firstSeen: '2026-09-17', reason: 'Known price bug', expires: '2026-09-30' }, ignored: { rule: 'baseline', reason: 'Known price bug' } });
    expect(current[1]).toMatchObject({ new: true });
    expect(current[1]!.ignored).toBeUndefined();

    const expired = [issue()];
    expect(applyBaseline(expired, read, { newOnly: true, now: new Date('2026-10-02T00:00:00Z') })).toHaveLength(1);
    expect(expired[0]!.ignored).toBeUndefined();
  });

  it('recognises a baseline recorded with an older fingerprint recipe', () => {
    const now = new Date('2026-09-17T12:00:00Z');
    const recorded = buildBaseline([issue()], undefined, now);
    expect(recorded.fingerprintVersion).toBe(FINGERPRINT_VERSION);

    // The same finding, but fingerprints are computed differently now.
    const older = { ...recorded, fingerprintVersion: FINGERPRINT_VERSION - 1 };
    const current = [issue({ fingerprint: 'computed-differently' })];
    expect(applyBaseline(current, older, { newOnly: true, now })).toEqual([]);
    expect(current[0]).toMatchObject({ baseline: { firstSeen: '2026-09-17' }, ignored: { rule: 'baseline' } });
    expect(current[0]!.new).toBeUndefined();

    // A finding on another element is still new.
    const elsewhere = [issue({ fingerprint: 'other', selector: '#total' })];
    applyBaseline(elsewhere, older, { newOnly: true, now });
    expect(elsewhere[0]).toMatchObject({ new: true });

    // Same version: only the fingerprint counts, so this one is new.
    const sameVersion = [issue({ fingerprint: 'computed-differently' })];
    applyBaseline(sameVersion, recorded, { newOnly: true, now });
    expect(sameVersion[0]).toMatchObject({ new: true });

    // Two entries that share code, route and selector are no evidence at all.
    const ambiguous = {
      ...older,
      entries: [older.entries[0]!, { ...older.entries[0]!, fingerprint: 'fp-twin', scenarios: ['other'] }],
    };
    const unknown = [issue({ fingerprint: 'computed-differently' })];
    applyBaseline(unknown, ambiguous, { newOnly: true, now });
    expect(unknown[0]).toMatchObject({ new: true });
  });

  it('rejects broken baselines', () => {
    const root = project({ 'a.json': '{', 'b.json': '{"version":2,"entries":[]}', 'c.json': '{"version":1,"tool":"hydration-proof","updatedAt":"x","entries":[{"fingerprint":"f","expires":"soon"}]}' });
    expect(() => readBaseline(join(root, 'a.json'))).toThrow(/not valid JSON/);
    expect(() => readBaseline(join(root, 'b.json'))).toThrow(/unknown format/);
    expect(() => readBaseline(join(root, 'c.json'))).toThrow(/must be a date/);
    expect(readBaseline(join(root, 'missing.json'))).toBeUndefined();
  });
});

describe('policy', () => {
  const config = (ci: HydrationProofConfig['ci']) => resolveConfig({ ci }, { rootDir: '/app', env: {} });

  it('lets budgets replace the zero-tolerance rule and fail when exceeded', () => {
    const issues = [
      issue(),
      issue({ fingerprint: 'fp2', code: 'HP1004', route: { url: 'http://x/checkout', pattern: '/checkout' } }),
      issue({ fingerprint: 'fp3', severity: 'warning' }),
    ];
    const data = report([page()], issues);
    expect(policy(config({}), data, [])).toEqual(['2 issues at or above "error" severity.']);
    expect(policy(config({ budget: { error: 2 } }), data, [])).toEqual([]);
    expect(policy(config({ budget: { error: 1 } }), data, [])).toEqual(['2 errors exceed the budget of 1.']);
    expect(policy(config({ budget: { error: 5, routes: { '/checkout': { error: 0 } }, codes: { HP1004: 0 } } }), data, [])).toEqual([
      '1 error on routes /checkout exceeds the budget of 0.',
      '1 HP1004 finding exceeds the budget of 0.',
    ]);
    expect(policy(config({ failOn: 'warning', budget: { error: 5 } }), data, [])).toEqual(['1 issue at or above "warning" severity.']);
  });
});

describe('history', () => {
  it('appends one line per run and reads the latest runs', () => {
    const root = project({});
    const file = join(root, 'history.ndjson');
    const data = report([page()], [issue(), issue({ fingerprint: 'fp2', severity: 'warning' }), issue({ fingerprint: 'fp3', ignored: { reason: 'r', rule: 'x' } })], { commit: 'abc' });
    for (let run = 0; run < 3; run++) appendHistory(file, historyEntry(data));
    writeFileSync(file, `${readFileSync(file, 'utf8')}{broken\n`);
    const entries = readHistory(file, 2);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toEqual({
      date: '2026-09-17T10:01:00.000Z',
      commit: 'abc',
      durationMs: 60_000,
      pages: 1,
      failed: 1,
      issues: { error: 1, warning: 1, info: 0 },
      codes: { HP1001: 2 },
      fingerprints: ['fp1', 'fp2'],
    });
  });
});

describe('merge-reports', () => {
  it('combines shards, removes duplicates and tags projects', () => {
    const a = report([page()], [issue()], { startedAt: '2026-09-17T10:00:00.000Z', finishedAt: '2026-09-17T10:02:00.000Z', baseUrl: 'http://a' });
    const b = report(
      [page(), page({ id: '/ [default]', url: 'http://127.0.0.1:4000/', status: 'passed', issues: [], counts: { error: 0, warning: 0, info: 0 } })],
      [issue()],
      { startedAt: '2026-09-17T09:59:00.000Z', finishedAt: '2026-09-17T10:01:00.000Z', baseUrl: 'http://b', browsers: ['firefox 130'] },
    );
    const merged = mergeReports([
      { report: a, label: 'shard-1' },
      { report: b, label: 'shard-2' },
    ]);
    expect(merged.pages.map((entry) => entry.id)).toEqual(['/products/1 [default]', '/ [default]']);
    expect(merged.issues).toHaveLength(1);
    expect(merged.summary).toMatchObject({ pages: 2, failed: 1, passed: 1, issues: { error: 1, warning: 0, info: 0 } });
    expect(merged.run).toMatchObject({ durationMs: 180_000, browsers: ['chromium 140', 'firefox 130'], shards: ['shard-1', 'shard-2'], baseUrl: 'http://a, http://b' });

    const projects = mergeReports([
      { report: a, label: 'web', project: 'web' },
      { report: a, label: 'admin', project: 'admin' },
    ]);
    expect(projects.pages.map((entry) => entry.project)).toEqual(['web', 'admin']);
    expect(projects.issues.map((entry) => entry.project)).toEqual(['web', 'admin']);
  });
});

describe('--changed', () => {
  it('parses the optional ref', () => {
    expect(parseTestArgs(['--changed']).overrides.changed).toBe(true);
    expect(parseTestArgs(['--changed', 'origin/main', '--headed']).overrides).toEqual({ changed: 'origin/main', headed: true });
    expect(parseTestArgs(['--changed=develop']).overrides.changed).toBe('develop');
    expect(parseTestArgs(['--changed', '--new-only', '--update-baseline', '--project', 'web']).overrides).toEqual({
      changed: true,
      newOnly: true,
      updateBaseline: true,
      projects: ['web'],
    });
  });

  it('maps changed files to the routes that import them', () => {
    const root = project({
      'package.json': '{}',
      'tsconfig.json': '{ // comment\n "compilerOptions": { "baseUrl": ".", "paths": { "@/*": ["./src/*"] } }, }',
      'app/layout.tsx': 'export default function L({ children }) { return children; }',
      'app/page.tsx': "import { Hero } from '@/components/Hero';\nexport default () => <Hero />;",
      'app/shop/page.tsx': "import Price from '../../src/components/Price.js';\nexport default () => <Price />;",
      'app/shop/[id]/page.tsx': "export { default } from './Detail';",
      'app/shop/[id]/Detail.tsx': "import styles from './detail.module.css';\nimport { format } from 'workspace-lib';\nexport default () => <p className={styles.a}>{format(1)}</p>;",
      'app/shop/[id]/detail.module.css': '.a {}',
      'app/blog/layout.tsx': "import '../../src/blog.css';\nexport default ({ children }) => children;",
      'app/blog/page.tsx': 'export default () => null;',
      'src/components/Hero.tsx': "import { Price } from './Price';\nexport const Hero = () => <Price />;",
      'src/components/Price.tsx': 'export default function Price() { return 1; }',
      'src/blog.css': 'body {}',
      'packages/lib/package.json': '{ "name": "workspace-lib", "main": "src/index.ts" }',
      'packages/lib/src/index.ts': 'export const format = (n) => String(n);',
      'README.md': '# app',
    });
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    execFileSync('ln', ['-s', '../packages/lib', join(root, 'node_modules', 'workspace-lib')]);
    const routes = discoverNextRoutes(root);
    const affected = (files: string[]) => {
      const result = routesAffectedBy(files, routes, root, root);
      return result.all ? `all: ${result.reason}` : [...result.patterns].sort();
    };
    expect(affected(['src/components/Price.tsx'])).toEqual(['/', '/shop']);
    expect(affected(['packages/lib/src/index.ts'])).toEqual(['/shop/[id]']);
    expect(affected(['app/shop/[id]/detail.module.css'])).toEqual(['/shop/[id]']);
    expect(affected(['src/blog.css'])).toEqual(['/blog']);
    expect(affected(['app/layout.tsx'])).toEqual(['/', '/blog', '/shop', '/shop/[id]']);
    expect(affected(['README.md'])).toEqual([]);
    expect(affected(['package.json'])).toBe('all: package.json changed');
    expect(affected(['tsconfig.json'])).toBe('all: tsconfig.json changed');
  });

  it('lists files changed since a git ref', () => {
    const root = project({ 'a.txt': 'a', 'b.txt': 'b' });
    const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' });
    git('init', '-q', '-b', 'main');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '.');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'one');
    git('checkout', '-qb', 'feature');
    writeFileSync(join(root, 'a.txt'), 'changed');
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qam', 'two');
    writeFileSync(join(root, 'b.txt'), 'dirty');
    writeFileSync(join(root, 'c.txt'), 'new');
    expect(changedFiles(root, 'main')).toEqual(['a.txt', 'b.txt', 'c.txt']);
    expect(changedFiles(root, 'no-such-ref')).toBeUndefined();
  });
});

describe('config and CI templates', () => {
  it('adds the GitHub reporter on GitHub Actions and resolves CI options', () => {
    expect(resolveConfig({}, { rootDir: '/app', env: { GITHUB_ACTIONS: 'true' } }).reporters).toEqual(['list', 'json', 'html', 'github']);
    expect(resolveConfig({ reporters: ['json'] }, { rootDir: '/app', env: { GITHUB_ACTIONS: 'true' } }).reporters).toEqual(['json', 'github']);
    expect(resolveConfig({}, { rootDir: '/app', env: { GITHUB_ACTIONS: 'true' }, overrides: { reporters: ['list'] } }).reporters).toEqual(['list']);
    const config = resolveConfig(
      {
        ci: { history: true, budget: { warning: 3 } },
        owners: { routes: { '/a': '@x' } },
        redact: { patterns: [/secret/], selectors: ['.card'] },
        projects: ['apps/web', { path: 'apps/admin', name: 'back-office' }],
      },
      { rootDir: '/repo', env: {}, overrides: { newOnly: true, changed: 'main', projects: ['back-office'] } },
    );
    expect(config.ci).toMatchObject({ baseline: '/repo/.hydration-proof/baseline.json', history: '/repo/.hydration-proof/history.ndjson', newIssuesOnly: true, budget: { warning: 3 } });
    expect(config.owners).toEqual({ routes: { '/a': ['@x'] }, codeowners: true });
    expect(config.redact).toEqual({ builtIn: true, patterns: [/secret/], selectors: ['.card'] });
    expect(config.changed).toEqual({ ref: 'main' });
    expect(config.projects).toEqual([{ name: 'back-office', dir: '/repo/apps/admin' }]);
    expect(resolveConfig({ redact: false }, { rootDir: '/repo', env: {} }).redact).toBe(false);
    expect(() => resolveConfig({ projects: ['a'] }, { rootDir: '/repo', env: {}, overrides: { projects: ['b'] } })).toThrow(/Unknown project "b"/);
    expect(() => resolveConfig({ projects: ['x/web', 'y/web'] }, { rootDir: '/repo', env: {} })).toThrow(/unique/);
  });

  it('writes workflows for the detected package manager', () => {
    const github = githubWorkflow('pnpm', '/app');
    expect(github).toContain('- uses: pnpm/action-setup@v4');
    expect(github).toContain('cache: pnpm');
    expect(github).toContain('- run: pnpm install --frozen-lockfile');
    expect(github).toContain('- run: pnpm exec hydration-proof test --reporter list,html,json,github,sarif');
    expect(github).toContain('fetch-depth: 0');
    const gitlab = gitlabJob('npm', '/app');
    expect(gitlab).toContain('    - npm ci');
    expect(gitlab).toContain('codequality: .hydration-proof/report/gl-code-quality.json');
    expect(gitlabJob('bun', '/app')).toContain('bunx hydration-proof test');
  });
});
