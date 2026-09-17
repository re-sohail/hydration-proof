import { existsSync } from 'node:fs';
import { firefox, webkit, type Browser, type BrowserType } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyzePage } from '../../src/analyze/index.ts';
import { parseDocument } from '../../src/engine/parse-stage.ts';
import { capture, harnessUrl } from '../helpers/browser.ts';
import type { BuildMode, ReactVersion } from '../helpers/provided.ts';

// The runtime and analysis in Firefox and WebKit (Chromium is covered by
// runtime.test.ts). Production builds of both React versions.

const engines: [string, BrowserType][] = [
  ['firefox', firefox],
  ['webkit', webkit],
];
const builds: [ReactVersion, BuildMode][] = [
  ['18', 'production'],
  ['19', 'production'],
  ['19', 'development'],
];

describe.each(engines)('%s', (_name, type) => {
  const installed = existsSync(type.executablePath());
  let browser: Browser | undefined;
  beforeAll(async () => {
    if (installed) browser = await type.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  describe.each(builds)('React %s (%s)', (version, mode) => {
    const analyze = async (page: string) => {
      const url = harnessUrl(version, mode, page);
      const result = await capture(browser!, url);
      const parsed = result.document?.body !== undefined ? await parseDocument(browser!, result.document) : undefined;
      return { result, analysis: analyzePage(result, parsed, { route: { url, pattern: `/${page}` }, scenario: 'default' }) };
    };

    it.skipIf(!installed)('hydrates cleanly', async () => {
      const { result, analysis } = await analyze('ok');
      expect(result.outcome).toBe('hydrated');
      expect(result.runtime.renderers[0]?.bundleType).toBe(mode === 'production' ? 0 : 1);
      expect(analysis.issues.filter((issue) => issue.severity !== 'info')).toEqual([]);
    });

    it.skipIf(!installed)('finds a text mismatch', async () => {
      const { analysis } = await analyze('text-mismatch');
      expect(analysis.issues).toContainEqual(expect.objectContaining({ code: 'HP1001', selector: '#env', server: 'server', client: 'client' }));
    });

    it.skipIf(!installed)('finds silent attribute mismatches', async () => {
      const { analysis } = await analyze('attr-mismatch');
      const codes = analysis.issues.map((issue) => `${issue.code}${issue.selector}`);
      expect(codes).toEqual(expect.arrayContaining(['HP1004#themed', 'HP1002#themed', 'HP1003#styled']));
    });

    it.skipIf(!installed)('finds invalid nesting', async () => {
      const { analysis } = await analyze('invalid-nesting');
      expect(analysis.issues.map((issue) => issue.code)).toContain('HP3001');
    });

    it.skipIf(!installed)('tracks Suspense boundaries', async () => {
      const { result, analysis } = await analyze('suspense');
      expect(result.runtime.commits.map((commit) => commit.kind)).toContain('boundary-hydration');
      expect(analysis.issues.filter((issue) => issue.severity !== 'info')).toEqual([]);
    });

    it.skipIf(!installed)('flags script changes before hydration', async () => {
      const { analysis } = await analyze('pre-hydration-mutation');
      expect(analysis.issues.map((issue) => issue.code)).toContain('HP4001');
    });
  });
});
