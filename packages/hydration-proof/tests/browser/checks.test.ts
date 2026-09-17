import { describe, expect, it } from 'vitest';
import { analyzePage } from '../../src/analyze/index.ts';
import { checkEarlyClick, checkEarlyInput } from '../../src/engine/interactions.ts';
import { capture, FAST_READY, harnessUrl, useBrowser } from '../helpers/browser.ts';
import type { BuildMode, ReactVersion } from '../helpers/provided.ts';

// 0.6 checks against the SSR harness: useId collisions between roots, events
// handled twice, and interactions made before hydration.

const builds: [ReactVersion, BuildMode][] = [
  ['18', 'production'],
  ['19', 'production'],
  ['19', 'development'],
];

describe.each(builds)('React %s (%s)', (version, mode) => {
  const browser = useBrowser();
  const analyze = async (page: string) => {
    const url = harnessUrl(version, mode, page);
    const result = await capture(browser(), url);
    return analyzePage(result, undefined, { route: { url, pattern: `/${page}` }, scenario: 'default' });
  };
  const options = { ready: FAST_READY, scenario: { name: 'default', context: {}, clock: Date.UTC(2026, 0, 1), randomSeed: 1 } };

  it('reports useId collisions between roots without identifierPrefix', async () => {
    const analysis = await analyze('two-roots');
    const collisions = analysis.issues.filter((issue) => issue.code === 'HP3004');
    expect(collisions.length).toBeGreaterThan(0);
    expect(collisions[0]!.message).toMatch(/2 React roots/);
    expect(analysis.issues.filter((issue) => issue.code === 'HP3003')).toEqual([]);
    const prefixed = await analyze('two-roots-prefixed');
    expect(prefixed.issues.filter((issue) => issue.code === 'HP3004' || issue.code === 'HP3003')).toEqual([]);
    expect(prefixed.issues.filter((issue) => issue.severity !== 'info')).toEqual([]);
  });

  it('reports events handled by a script and by React', async () => {
    const analysis = await analyze('double-handler');
    expect(analysis.issues).toContainEqual(expect.objectContaining({ code: 'HP5006', selector: '#twice' }));
    const clean = await analyze('interactions');
    expect(clean.issues.filter((issue) => issue.code === 'HP5006')).toEqual([]);
  });

  it('keeps input in controlled fields, and finds input lost when hydration re-creates the field', async () => {
    const kept = await checkEarlyInput(browser(), harnessUrl(version, mode, 'interactions'), options);
    expect(kept.skipped).toBeUndefined();
    expect(kept.drafts).toEqual([]);
    const lost = await checkEarlyInput(browser(), harnessUrl(version, mode, 'input-remount'), options);
    expect(lost.skipped).toBeUndefined();
    const found = lost.drafts.map((draft) => `${draft.code}${draft.attribute ? `:${draft.attribute}` : ''}@${draft.selector ?? draft.key}`);
    expect(found).toEqual(expect.arrayContaining(['HP5002:value@#remount', 'HP5003@#remount']));
    expect(lost.drafts[0]!.evidence.map((entry) => entry.message)).toContain('React replaced the field during hydration, so the new field lost what was typed.');
  });

  it('finds a scroll reset and keeps uncontrolled input', async () => {
    const reset = await checkEarlyInput(browser(), harnessUrl(version, mode, 'scroll-reset'), options);
    expect(reset.drafts.map((draft) => draft.code)).toContain('HP5007');
    const ok = await checkEarlyInput(browser(), harnessUrl(version, mode, 'interactions-ok'), options);
    expect(ok.skipped).toBeUndefined();
    expect(ok.drafts).toEqual([]);
  });

  it('finds a click lost while the page loads', async () => {
    const result = await checkEarlyClick(browser(), harnessUrl(version, mode, 'interactions'), options);
    expect(result.drafts).toContainEqual(expect.objectContaining({ code: 'HP5001', selector: '#counter' }));
    const none = await checkEarlyClick(browser(), harnessUrl(version, mode, 'interactions-ok'), options);
    expect(none.drafts).toEqual([]);
    expect(none.idle).toBe(true);
  });
});
