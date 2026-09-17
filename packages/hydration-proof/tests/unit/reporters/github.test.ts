import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { Severity } from '../../../src/issues/registry.ts';
import type { Issue, Report } from '../../../src/report/model.ts';
import {
  ANNOTATIONS_PER_LEVEL,
  STEP_SUMMARY_LIMIT,
  detectGithubActions,
  escapeData,
  escapeProperty,
  githubAnnotations,
  githubReporter,
  mdCode,
  mdCodeBlock,
  mdText,
  renderJobSummary,
  workflowCommand,
} from '../../../src/report/reporters/github.ts';
import { createReporters } from '../../../src/report/reporters/index.ts';
import { anonymize, expectGolden, issue, makeConfig, makeContext, makeReport, makeWorkspace, page } from './fixture.ts';

const workspace = makeWorkspace();
afterAll(() => workspace.cleanup());
const config = makeConfig(workspace);
const env = {
  GITHUB_ACTIONS: 'true',
  GITHUB_WORKSPACE: workspace.repo,
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'acme/shop',
  GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567',
  GITHUB_RUN_ID: '42',
};

interface Parsed {
  command: string;
  properties: Record<string, string>;
  message: string;
}

// The runner's unescaping (the reverse of @actions/core's escaping).
function unescape(value: string, property: boolean): string {
  let out = value.replace(/%0D/g, '\r').replace(/%0A/g, '\n');
  if (property) out = out.replace(/%3A/g, ':').replace(/%2C/g, ',');
  return out.replace(/%25/g, '%');
}

function parse(line: string): Parsed {
  const match = /^::([a-z]+)(?: ([^:]*))?::(.*)$/.exec(line);
  if (!match) throw new Error(`Not a workflow command: ${line}`);
  const properties: Record<string, string> = {};
  for (const pair of (match[2] ?? '').split(',').filter(Boolean)) {
    const [key, ...value] = pair.split('=');
    properties[key!] = unescape(value.join('='), true);
  }
  return { command: match[1]!, properties, message: unescape(match[3]!, false) };
}

describe('workflow commands', () => {
  it('escape data and properties like @actions/core', () => {
    expect(escapeData('100% done\r\nnext: a,b')).toBe('100%25 done%0D%0Anext: a,b');
    expect(escapeProperty('100% done\r\nnext: a,b')).toBe('100%25 done%0D%0Anext%3A a%2Cb');
    expect(escapeData('%0A')).toBe('%250A');
    expect(escapeData(undefined)).toBe('');
    expect(escapeData({ a: 1 })).toBe('{"a"%3A1}'.replace('%3A', ':'));
  });

  it('keep every command on one line', () => {
    const line = workflowCommand('error', { file: 'src/a:b,c.tsx', line: 3, col: 2, title: 'HP1001 x, y: z' }, 'first\nsecond\r\n::warning::fake');
    expect(line).toBe('::error file=src/a%3Ab%2Cc.tsx,line=3,col=2,title=HP1001 x%2C y%3A z::first%0Asecond%0D%0A::warning::fake');
    expect(line).not.toMatch(/[\r\n]/);
    expect(parse(line)).toEqual({
      command: 'error',
      properties: { file: 'src/a:b,c.tsx', line: '3', col: '2', title: 'HP1001 x, y: z' },
      message: 'first\nsecond\r\n::warning::fake',
    });
    expect(workflowCommand('notice', { file: undefined, title: '' }, 'm')).toBe('::notice::m');
  });

  it('detect GitHub Actions', () => {
    expect(detectGithubActions({ GITHUB_ACTIONS: 'true' })).toBe(true);
    expect(detectGithubActions({ GITHUB_ACTIONS: 'false' })).toBe(false);
    expect(detectGithubActions({ CI: 'true' })).toBe(false);
    expect(detectGithubActions({})).toBe(false);
  });
});

describe('GitHub annotations', () => {
  it('match the golden file', () => {
    expectGolden('github-annotations.txt', anonymize(`${githubAnnotations(makeReport(), config, env).join('\n')}\n`, workspace));
  });

  it('group the same problem across scenarios and modes, most important first', () => {
    const annotations = githubAnnotations(makeReport(), config, env).map(parse);
    expect(annotations.map((entry) => `${entry.command} ${entry.properties['title']!.slice(0, 6)}`)).toEqual([
      'error HP9004',
      'error HP1001',
      'error HP1013',
      'error HP1004',
      'warning HP9010',
      'warning HP1005',
      'notice HP3003',
    ]);
    const text = annotations[1]!;
    expect(text.properties).toEqual({
      file: 'apps/web/src/app/products/[id]/page.tsx',
      line: '12',
      col: '7',
      title: 'HP1001 Text differs between server and client',
    });
    expect(text.message).toBe(
      [
        'Page: /products/1?ref=a,b (scenarios guest, admin; production and development builds)',
        'Element: #price',
        'Server: "Price: 10%\\nnow"',
        'Client: "Price: 12%\\r\\nlater"',
        'Likely cause: Time-dependent value (97% confidence)',
        'Fix: Move time-dependent values into useEffect.',
        'Docs: https://hydration.jscrate.dev/docs/issues/hp1001',
      ].join('\n'),
    );
  });

  it('use workspace-relative files and leave the file out without a usable source', () => {
    const annotations = githubAnnotations(makeReport(), config, env).map(parse);
    const byCode = (code: string) => annotations.find((entry) => entry.properties['title']!.startsWith(code))!;
    expect(byCode('HP1004').properties).toMatchObject({ file: 'packages/ui/src/Button.tsx', line: '3' });
    expect(byCode('HP1004').properties['col']).toBeUndefined();
    expect(byCode('HP1005').properties).toEqual({ title: 'HP1005 Attribute only present in the server HTML' });
    expect(byCode('HP1005').message).toContain('No source location: The scripts have no source maps.');

    // Without GITHUB_WORKSPACE: relative to the app; sources outside it go into the message.
    const local = githubAnnotations(makeReport(), config, {}).map(parse);
    const text = local.find((entry) => entry.properties['title']!.startsWith('HP1001'))!;
    expect(text.properties['file']).toBe('src/app/products/[id]/page.tsx');
    const outside = local.find((entry) => entry.properties['title']!.startsWith('HP1004'))!;
    expect(outside.properties['file']).toBeUndefined();
    expect(outside.properties['line']).toBeUndefined();
    expect(outside.message).toContain('Source: ../../packages/ui/src/Button.tsx:3');
  });

  it('skip ignored issues and escape hostile values', () => {
    const lines = githubAnnotations(makeReport(), config, env);
    expect(lines.join('\n')).not.toContain('HP1002');
    for (const line of lines) expect(line).not.toMatch(/[\r\n]/);
    const nasty = lines.map(parse).find((entry) => entry.properties['title']!.startsWith('HP1013'))!;
    const server = nasty.message.split('\n').find((line) => line.startsWith('Server: '))!;
    expect(server).toMatch(/^Server: "100% \]\]><\/failure><x a=\\"1\\" b='2'>&amp; \| `tick` ``` a:b,c \\u0000\\u0007\\b/);
    const client = nasty.message.split('\n').find((line) => line.startsWith('Client: '))!;
    expect(client.length).toBeLessThan(220);
    expect(client.endsWith('…"')).toBe(true);
    expect(nasty.properties['file']).toBe('apps/web/src/app/nasty/page.tsx');
  });

  it(`show at most ${ANNOTATIONS_PER_LEVEL} per level, then say how many more there are`, () => {
    const make = (severity: Severity, count: number): Issue[] =>
      Array.from({ length: count }, (_, index) =>
        issue(severity === 'error' ? 'HP1001' : severity === 'warning' ? 'HP1005' : 'HP3003', {
          url: `/${severity}/${index}`,
          scenario: 'default',
          severity,
          confidence: index / 100,
        }),
      );
    const issues = [...make('error', 15), ...make('warning', 12), ...make('info', 11)];
    const report: Report = { ...makeReport(), pages: [page('/', 'default', issues)], issues };
    const annotations = githubAnnotations(report, config, env).map(parse);
    const count = (command: string) => annotations.filter((entry) => entry.command === command).length;
    expect(count('error')).toBe(10);
    expect(count('warning')).toBe(10);
    expect(count('notice')).toBe(10);
    // The most confident errors come first.
    expect(annotations[0]!.message).toContain('Page: /error/14 ');
    expect(annotations[9]!.message).toContain('Page: /error/5 ');
    expect(annotations.at(-1)).toEqual({
      command: 'notice',
      properties: { title: 'hydration-proof: more issues' },
      message:
        '9 more issues (5 errors, 2 warnings, 2 notices) than GitHub shows as annotations. See the job summary and the report in apps/web/.hydration-proof/report.',
    });

    // Exactly ten notices and nothing else: no overflow note.
    const notices = make('info', 10);
    const quiet = githubAnnotations({ ...report, issues: notices }, config, env).map(parse);
    expect(quiet).toHaveLength(10);
    expect(quiet.every((entry) => entry.properties['title']!.startsWith('HP3003'))).toBe(true);
  });

  it('survive incomplete data', () => {
    const odd = { issues: [null, {}, { code: 'HP1001', severity: 'error', source: { file: 'x.ts', line: -1 } }] } as unknown as Report;
    const lines = githubAnnotations(odd, undefined, {});
    expect(lines).toHaveLength(2);
    expect(parse(lines[0]!).properties).toEqual({ file: 'x.ts', title: 'HP1001' });
    expect(() => githubAnnotations({} as Report, config, env)).not.toThrow();
  });
});

describe('GitHub job summary', () => {
  it('matches the golden file', () => {
    const markdown = renderJobSummary(makeReport(), makeContext(config), { env });
    expectGolden('github-summary.md', anonymize(markdown, workspace));
  });

  it('has a headline, totals, failing pages, issue details and a report pointer', () => {
    const markdown = renderJobSummary(makeReport(), makeContext(config), { env });
    expect(markdown.startsWith('## ❌ Hydration Proof: 5 pages failed\n')).toBe(true);
    expect(markdown).toContain('- 6 issues at or above "error" severity.');
    expect(markdown).toContain('| Pages tested | 7 |');
    expect(markdown).toContain('| Failed | `/products/1?ref=a,b` | `admin` | production | 1 | 0 |');
    expect(markdown).toContain('| Warnings | `/docs` | `guest` | production | 0 | 1 |');
    expect(markdown).toContain('<summary><strong>HP1001</strong> Text differs between server and client · <code>/products/1?ref=a,b</code> · guest, admin · production, development</summary>');
    expect(markdown).toContain(
      '- **Source:** [`apps/web/src/app/products/[id]/page.tsx:12:7`](https://github.com/acme/shop/blob/0123456789abcdef0123456789abcdef01234567/apps/web/src/app/products/%5Bid%5D/page.tsx#L12)',
    );
    expect(markdown).toContain('**Server:**\n\n```text\nPrice: 10%\nnow\n```');
    expect(markdown).toContain('[run artifacts](https://github.com/acme/shop/actions/runs/42#artifacts)');
    expect(markdown).toContain('Full report: `apps/web/.hydration-proof/report/report.html`');
    expect(markdown).not.toContain('HP1002');
    // Pages that passed are not listed.
    expect(markdown).not.toContain('| `/` |');
  });

  it('reports success', () => {
    const report: Report = {
      ...makeReport(),
      pages: [page('/', 'default', [])],
      issues: [],
      summary: { pages: 1, routes: 1, passed: 1, warnings: 0, failed: 0, errored: 0, issues: { error: 0, warning: 0, info: 0 }, ignored: 0 },
    };
    const markdown = renderJobSummary(report, makeContext(config, 0, []), { env });
    expect(markdown.startsWith('## ✅ Hydration Proof: no hydration problems\n')).toBe(true);
    expect(markdown).not.toContain('### Pages with problems');
    expect(markdown).not.toContain('### Issues');
  });

  it('escapes Markdown and HTML in page data', () => {
    const hostile = 'a|b <img src=x onerror=alert(1)> `c` **d** [e](f) \\';
    const bad = issue('HP1001', {
      url: '/x|y',
      scenario: hostile,
      title: hostile as never,
      selector: hostile,
      server: 'before\n````\n</details><script>x</script>\n```',
      client: null,
      suggestions: [hostile],
      cause: { id: 'x', title: hostile, confidence: 0.5, docsUrl: 'javascript:alert(1)' },
    });
    const report: Report = { ...makeReport(), pages: [page('/x|y', hostile, [bad])], issues: [bad] };
    const markdown = renderJobSummary(report, makeContext(config), { env });
    const row = markdown.split('\n').find((line) => line.startsWith('| Failed | `'))!;
    // Five columns: six unescaped pipes.
    expect(row.replace(/\\\|/g, '').split('|')).toHaveLength(7);
    // Outside code spans and fenced blocks (which render literally) there is no raw HTML.
    const outsideCode = markdown.replace(/^(`{3,})text\n[\s\S]*?\n\1$/gm, '').replace(/(`+)(?!`)[\s\S]*?(?<!`)\1(?!`)/g, '');
    expect(outsideCode).not.toContain('<img');
    expect(outsideCode).not.toContain('<script');
    expect(outsideCode).not.toContain('</details><');
    // Only the tags the summary itself uses.
    expect(new Set(outsideCode.match(/<[a-z/]+/g))).toEqual(
      new Set(['<details', '</details', '<summary', '</summary', '<strong', '</strong', '<code', '</code']),
    );
    expect(row).toContain('| ``a\\|b <img src=x onerror=alert(1)> `c` **d** [e](f) \\`` |');
    expect(markdown).not.toContain('javascript:');
    expect(markdown).toContain('**Server:**\n\n`````text\nbefore\n````\n</details><script>x</script>\n```\n`````');
    expect(markdown).toContain('**Client:** (absent)');
    expect(markdown).toContain('- **Fix:** a\\|b &lt;img src=x onerror=alert\\(1\\)&gt; \\`c\\` \\*\\*d\\*\\* \\[e\\]\\(f\\) \\\\');
    // Every <details> is closed.
    expect(outsideCode.split('<details>')).toHaveLength(2);
    expect(outsideCode.split('\n</details>')).toHaveLength(2);
  });

  it('formats inline code and code blocks safely', () => {
    expect(mdCode('a`b')).toBe('``a`b``');
    expect(mdCode('`a`')).toBe('`` `a` ``');
    expect(mdCode('a|b\nc')).toBe('`a\\|b c`');
    expect(mdCode('')).toBe('');
    expect(mdText('# *x* <b> & | _y_')).toBe('\\# \\*x\\* &lt;b&gt; &amp; \\| \\_y\\_');
    expect(mdCodeBlock('x ``````` y')).toBe('````````text\nx ``````` y\n````````');
    expect(mdCodeBlock(`a${String.fromCharCode(0, 27)}b`)).toBe('```text\na\\u0000\\u001bb\n```');
  });

  it('stays within the size limit', () => {
    const issues = Array.from({ length: 400 }, (_, index) =>
      issue('HP1001', { url: `/p/${index}`, scenario: 'default', server: 'x'.repeat(5000), client: 'y'.repeat(5000) }),
    );
    const report: Report = { ...makeReport(), pages: issues.map((entry, index) => page(`/p/${index}`, 'default', [entry])), issues };
    const full = renderJobSummary(report, makeContext(config), { env });
    expect(Buffer.byteLength(full)).toBeLessThanOrEqual(STEP_SUMMARY_LIMIT);
    expect(full).toMatch(/_\d+ more issues left out to stay within GitHub's summary size limit; see the full report._/);
    expect(full).toContain('…and 300 more pages.');
    expect(full.trimEnd().endsWith('.')).toBe(true);

    for (const limit of [20_000, 3000]) {
      const small = renderJobSummary(report, makeContext(config), { env, limit });
      expect(Buffer.byteLength(small)).toBeLessThanOrEqual(limit);
      expect(small).toContain('Full report:');
    }
    const tiny = renderJobSummary(report, makeContext(config), { env, limit: 200 });
    expect(tiny).toBe('## ❌ Hydration Proof: 5 pages failed\n\n_The summary was too large; see the full report._\n');
    expect(renderJobSummary(report, makeContext(config), { env, limit: 10 })).toBe('');
  });

  it('is appended to GITHUB_STEP_SUMMARY', async () => {
    const file = join(workspace.tmp, 'step-summary.md');
    writeFileSync(file, '# Earlier step');
    const context = makeContext(config);
    const result = await githubReporter({ ...env, GITHUB_STEP_SUMMARY: file }).onEnd!(makeReport(), context);
    expect(result).toBeUndefined();
    const content = readFileSync(file, 'utf8');
    expect(content).toBe(`# Earlier step\n${renderJobSummary(makeReport(), context, { env })}`);
    expect(context.output.join('')).toBe(`${githubAnnotations(makeReport(), config, env).join('\n')}\n`);
  });

  it('keeps the whole summary file under the limit', async () => {
    const file = join(workspace.tmp, 'full-summary.md');
    writeFileSync(file, 'x'.repeat(STEP_SUMMARY_LIMIT - 6000));
    await githubReporter({ ...env, GITHUB_STEP_SUMMARY: file }).onEnd!(makeReport(), makeContext(config));
    const size = statSync(file).size;
    expect(size).toBeGreaterThan(STEP_SUMMARY_LIMIT - 6000);
    expect(size).toBeLessThanOrEqual(STEP_SUMMARY_LIMIT);
    expect(readFileSync(file, 'utf8')).toContain('left out to stay within');
  });

  it('only prints annotations without GITHUB_STEP_SUMMARY, and never throws on write errors', async () => {
    const context = makeContext(config);
    await githubReporter({}).onEnd!(makeReport(), context);
    expect(context.output).toHaveLength(1);

    const directory = join(workspace.tmp, 'a-directory');
    mkdirSync(directory, { recursive: true });
    const failing = makeContext(config);
    expect(await githubReporter({ GITHUB_STEP_SUMMARY: directory }).onEnd!(makeReport(), failing)).toBeUndefined();
    expect(failing.output.at(-1)).toMatch(/^ {2}Could not write the GitHub job summary: /);

    const empty = makeContext(config, 0, []);
    await githubReporter({}).onEnd!({ ...makeReport(), pages: [], issues: [] }, empty);
    expect(empty.output).toEqual([]);
  });

  it('survives incomplete data', () => {
    expect(() => renderJobSummary({} as Report, { config: undefined, exitCode: 1 }, { env: {} })).not.toThrow();
    const odd = { pages: [null, { status: 'failed' }], issues: [{}], summary: {} } as unknown as Report;
    expect(renderJobSummary(odd, { config: undefined, exitCode: 1 }, { env: {} })).toContain('### Pages with problems');
  });
});

describe('createReporters', () => {
  it('supports every CI format', () => {
    const { reporters, unsupported } = createReporters(['list', 'json', 'html', 'junit', 'sarif', 'github', 'gitlab', 'junit'], {});
    expect(unsupported).toEqual([]);
    expect(reporters.map((reporter) => reporter.name)).toEqual(['list', 'json', 'html', 'junit', 'sarif', 'github', 'gitlab']);
  });
});
