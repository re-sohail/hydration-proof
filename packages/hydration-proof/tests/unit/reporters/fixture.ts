// A realistic report for the CI reporter tests: several scenarios, both build
// modes, issues with and without source locations, an ignored issue, every
// severity and values full of characters that need escaping.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect } from 'vitest';
import type { ResolvedConfig } from '../../../src/config/resolve.ts';
import type { ReporterName } from '../../../src/config/types.ts';
import { docsUrl, issueDefinition, type IssueCode } from '../../../src/issues/registry.ts';
import type { Issue, PageResult, Report } from '../../../src/report/model.ts';
import type { ReporterContext } from '../../../src/report/reporters/types.ts';

const BASE = 'http://127.0.0.1:4173';

/** Control characters, a lone surrogate and friends, built without typing them. */
export const CONTROL = String.fromCharCode(0, 7, 8, 11, 12, 27, 127, 0x85, 0x9f);
export const LONE_SURROGATE = String.fromCharCode(0xd800);
export const NASTY = `100% ]]></failure><x a="1" b='2'>&amp; | \`tick\` \`\`\` a:b,c ${CONTROL} 🎉 ${LONE_SURROGATE} end\r\nnext`;

export function issue(code: IssueCode, overrides: Partial<Issue> & { url: string; scenario: string }): Issue {
  const definition = issueDefinition(code);
  const { url, ...rest } = overrides;
  const pathname = new URL(url, BASE).pathname;
  return {
    fingerprint: `${code.toLowerCase()}-${pathname}`,
    code,
    title: definition.title,
    severity: definition.severity,
    confidence: 0.8,
    message: `${definition.title}.`,
    route: { url: new URL(url, BASE).href, pattern: pathname },
    stage: 'hydration',
    evidence: [],
    suggestions: [],
    docsUrl: docsUrl(code),
    ...rest,
  };
}

export function page(url: string, scenario: string, issues: Issue[], overrides: Partial<PageResult> = {}): PageResult {
  const href = new URL(url, BASE).href;
  const counts = { error: 0, warning: 0, info: 0 };
  for (const entry of issues) if (!entry.ignored) counts[entry.severity]++;
  return {
    id: `${url} [${scenario}]`,
    route: { url: href, pattern: new URL(href).pathname },
    scenario,
    url: href,
    finalUrl: href,
    status: counts.error > 0 ? 'failed' : counts.warning > 0 ? 'warning' : 'passed',
    outcome: 'hydrated',
    http: { status: 200, redirects: [] },
    timings: { navigation: 120, hydration: 80, total: 1234 },
    issues: issues.map((entry) => entry.fingerprint),
    counts,
    ...overrides,
  };
}

export function makeReport(): Report {
  const productUrl = '/products/1?ref=a,b';
  const productPattern = '/products/[id]';
  const textMismatch = (scenario: string, mode: 'production' | 'development'): Issue =>
    issue('HP1001', {
      url: productUrl,
      scenario,
      mode,
      fingerprint: 'a1a1a1a1a1a1a1a1',
      route: { url: `${BASE}${productUrl}`, pattern: productPattern },
      confidence: 0.95,
      message: 'Server rendered "Price: 10%", the client rendered "Price: 12%".',
      selector: '#price',
      server: 'Price: 10%\nnow',
      client: 'Price: 12%\r\nlater',
      component: 'Price',
      source: { file: 'src/app/products/[id]/page.tsx', line: 12, column: 7, frame: '  11 | return (\n> 12 |   <p id="price">{price}</p>\n     |       ^' },
      cause: { id: 'time', title: 'Time-dependent value', confidence: 0.97, docsUrl: 'https://hydration.jscrate.dev/docs/causes/time' },
      suggestions: ['Move time-dependent values into useEffect.', 'Pass the time from the server.'],
    });
  const classMismatch = issue('HP1004', {
    url: productUrl,
    scenario: 'guest',
    mode: 'production',
    fingerprint: 'b2b2b2b2b2b2b2b2',
    route: { url: `${BASE}${productUrl}`, pattern: productPattern },
    confidence: 0.7,
    selector: 'main > button.btn',
    attribute: 'class',
    server: 'btn a:b,c',
    client: 'btn <x>',
    source: { file: '../../packages/ui/src/Button.tsx', line: 3 },
    cause: { id: 'css-in-js', title: 'CSS-in-JS class names differ', confidence: 0.6 },
  });
  const extraAttribute = issue('HP1005', {
    url: productUrl,
    scenario: 'guest',
    mode: 'production',
    fingerprint: 'c3c3c3c3c3c3c3c3',
    route: { url: `${BASE}${productUrl}`, pattern: productPattern },
    confidence: 0.6,
    selector: 'input[name="q"]',
    attribute: 'data-lastpass',
    server: 'on',
    client: null,
    sourceUnavailableReason: 'The scripts have no source maps.',
  });
  const redirect = issue('HP9010', {
    url: '/docs',
    scenario: 'guest',
    mode: 'production',
    fingerprint: 'd4d4d4d4d4d4d4d4',
    stage: 'runtime',
    confidence: 0.9,
    message: 'The route /docs ended on /login.',
  });
  const innerHtml = issue('HP1013', {
    url: '/nasty',
    scenario: 'guest',
    mode: 'production',
    fingerprint: 'e5e5e5e5e5e5e5e5',
    confidence: 0.85,
    selector: 'div[data-x="a|b"] > p:nth-child(2)',
    server: NASTY,
    client: `${'x'.repeat(300)}\`\`\`\`${'y'.repeat(10)}`,
    source: { file: 'src/app/nasty/page.tsx', line: 40 },
    suggestions: ['Sanitize <html> & use `useEffect` | done.'],
  });
  const duplicateId = issue('HP3003', {
    url: '/nasty',
    scenario: 'guest',
    mode: 'production',
    fingerprint: 'f6f6f6f6f6f6f6f6',
    stage: 'parsed',
    confidence: 0.5,
    message: 'Two elements use id="main" 🎉.',
    selector: '#main',
  });
  const ignored = issue('HP1002', {
    url: '/nasty',
    scenario: 'guest',
    mode: 'production',
    fingerprint: 'a7a7a7a7a7a7a7a7',
    selector: 'body',
    attribute: 'data-analytics',
    server: '1',
    client: '2',
    ignored: { reason: 'Known analytics attribute', rule: 'code HP1002 on /nasty' },
  });
  const navigation = issue('HP9004', {
    url: '/broken',
    scenario: 'guest',
    mode: 'production',
    fingerprint: 'b8b8b8b8b8b8b8b8',
    stage: 'runtime',
    confidence: 1,
    message: 'net::ERR_CONNECTION_REFUSED at http://127.0.0.1:4173/broken',
  });

  const guestProduct = [textMismatch('guest', 'production'), classMismatch, extraAttribute];
  const adminProduct = [textMismatch('admin', 'production')];
  const devProduct = [textMismatch('guest', 'development')];
  const nasty = [innerHtml, duplicateId, ignored];
  const pages: PageResult[] = [
    page('/', 'guest', [], { mode: 'production', timings: { navigation: 90, hydration: 60, total: 812 } }),
    page(productUrl, 'guest', guestProduct, { mode: 'production', route: { url: `${BASE}${productUrl}`, pattern: productPattern } }),
    page('/docs', 'guest', [redirect], { mode: 'production', finalUrl: `${BASE}/login` }),
    page('/nasty', 'guest', nasty, { mode: 'production', serverLogs: ['Error: <boom> & failed', `bad ${CONTROL} bytes`] }),
    page('/broken', 'guest', [navigation], {
      mode: 'production',
      status: 'error',
      outcome: 'navigation-failed',
      timings: { navigation: 0, total: 5000 },
    }),
    page(productUrl, 'admin', adminProduct, { mode: 'production', route: { url: `${BASE}${productUrl}`, pattern: productPattern } }),
    page(productUrl, 'guest', devProduct, { mode: 'development', route: { url: `${BASE}${productUrl}`, pattern: productPattern } }),
  ];
  delete pages[4]!.http;
  const issues = [...guestProduct, redirect, ...nasty, navigation, ...adminProduct, ...devProduct];
  return {
    schemaVersion: 1,
    tool: { name: 'hydration-proof', version: '1.2.3' },
    run: {
      startedAt: '2026-09-17T10:00:00.000Z',
      finishedAt: '2026-09-17T10:00:12.345Z',
      durationMs: 12_345,
      cwd: '/somewhere',
      node: 'v24.0.0',
      platform: 'linux-x64',
      playwright: '1.63.0',
      browsers: ['chromium 153.0'],
      mode: 'both',
      baseUrl: BASE,
    },
    summary: {
      pages: pages.length,
      routes: 5,
      passed: 1,
      warnings: 1,
      failed: 4,
      errored: 1,
      issues: { error: 6, warning: 2, info: 1 },
      ignored: 1,
    },
    pages,
    issues,
  };
}

export interface Workspace {
  /** Temporary directory holding everything. */
  tmp: string;
  /** Repository root (has a .git directory). */
  repo: string;
  /** The app (config.rootDir), a subdirectory of the repository. */
  app: string;
  configFile: string;
  outputDir: string;
  cleanup(): void;
}

export function makeWorkspace(options: { git?: boolean } = {}): Workspace {
  const tmp = mkdtempSync(join(tmpdir(), 'hp-reporters-'));
  const repo = join(tmp, 'repo');
  const app = join(repo, 'apps', 'web');
  mkdirSync(app, { recursive: true });
  if (options.git !== false) mkdirSync(join(repo, '.git'));
  const configFile = join(app, 'hydration-proof.config.ts');
  writeFileSync(configFile, 'export default {};\n');
  return {
    tmp,
    repo,
    app,
    configFile,
    outputDir: join(app, '.hydration-proof', 'report'),
    cleanup: () => rmSync(tmp, { recursive: true, force: true }),
  };
}

export function makeConfig(
  workspace: Pick<Workspace, 'app' | 'outputDir'> & { configFile?: string | undefined },
  reporters: ReporterName[] = ['list', 'html', 'json', 'github', 'sarif', 'junit', 'gitlab'],
): ResolvedConfig {
  return {
    rootDir: workspace.app,
    configFile: workspace.configFile,
    outputDir: workspace.outputDir,
    reporters,
  } as unknown as ResolvedConfig;
}

export function makeContext(
  config: ResolvedConfig,
  exitCode = 1,
  failures: string[] = ['6 issues at or above "error" severity.'],
): ReporterContext & { exitCode: number; failures: string[]; output: string[] } {
  const output: string[] = [];
  return {
    config,
    baseUrl: BASE,
    totalPages: 7,
    write: (text: string) => void output.push(text),
    exitCode,
    failures,
    output,
  };
}

/** Replaces the temporary directory in `text` so golden files are stable. */
export function anonymize(text: string, workspace: Workspace): string {
  const url = pathToFileURL(workspace.tmp).href;
  return text.split(url).join('file:///TMP').split(workspace.tmp).join('/TMP');
}

export function expectGolden(name: string, actual: string): void {
  const file = new URL(`./__golden__/${name}`, import.meta.url);
  if (process.env['UPDATE_GOLDEN'] === '1') {
    writeFileSync(file, actual);
    return;
  }
  if (!existsSync(file)) throw new Error(`Golden file __golden__/${name} is missing. Run the tests with UPDATE_GOLDEN=1 to create it.`);
  expect(actual, `__golden__/${name} differs. If the change is intended, run the tests with UPDATE_GOLDEN=1.`).toBe(
    readFileSync(file, 'utf8'),
  );
}
