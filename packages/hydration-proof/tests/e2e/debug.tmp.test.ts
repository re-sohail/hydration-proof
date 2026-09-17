import { chromium } from 'playwright-core';
import { it } from 'vitest';
import { DEFAULT_ENGINE, runJobs } from '../../src/engine/run.ts';
import { startFixture } from '../../../../scripts/lib/fixtures.ts';
import { CASES, jobFor } from '../helpers/cases.ts';
import { rewind } from '../../src/dom/rewind.ts';
import { normalizeTree } from '../../src/dom/normalize.ts';
import { outline, childrenOf } from '../../src/dom/tree.ts';

import { appendFileSync, writeFileSync } from 'node:fs';
const OUT = '/private/tmp/claude-501/-Users-mrmacbook-Documents-personal-project-Libraries-hydration-proof-hydration-proof/d4079bb3-3d88-4fb2-abce-cc7bb026ace2/scratchpad/debug.txt';
const log = (...a: unknown[]) => appendFileSync(OUT, a.join(' ') + '\n');
it('debug', async () => {
  writeFileSync(OUT, '');
  const route = process.env.ROUTE ?? '/date-now';
  const app = (process.env.APP ?? 'next-app') as 'next-app';
  const browser = await chromium.launch();
  const fixture = await startFixture(app, 'prod');
  try {
    const entry = CASES.find((c) => c.app === app && c.route === route && (process.env.VIA ? c.via === 'cdn-proxy' : c.via === undefined))!;
    const [run] = await runJobs(browser, [jobFor(entry, fixture)], DEFAULT_ENGINE);
    const rt = run!.capture.runtime;
    log('commits', JSON.stringify(rt.commits));
    log('batches', rt.batches.map((b) => `${b.seq}:${b.phase}@${b.commit ?? ''} t=${b.time} ${b.entries ? b.entries.length + 'e' : JSON.stringify(b.summary)}`).join('\n'));
    const commit = rt.commits.find((c) => c.kind !== 'update')!;
    const snap = rt.snapshots.find((s) => s.seq === commit.snapshot)!;
    const batch = rt.batches.filter((b) => b.phase === 'hydration-commit' && b.commit === commit.seq);
    for (const b of batch) for (const e of b.entries ?? []) console.log('ENTRY', JSON.stringify(e).slice(0, 300));
    const pre = normalizeTree(rewind(snap.tree, batch).tree).tree;
    const post = normalizeTree(snap.tree).tree;
    const body = (t: typeof pre) => {
      const html = t.children.find((n) => n.k === 1 && n.tag === 'html')!;
      const b = childrenOf(html)!.find((n) => n.k === 1 && n.tag === 'body')!;
      return childrenOf(b)!.map((n) => `${n.id}:${outline(n, 70)}`).join('\n   ');
    };
    log('PRE body:\n   ' + body(pre));
    log('POST body:\n   ' + body(post));
    log(JSON.stringify(run!.analysis.issues.map((i) => [i.code, i.selector, i.message, i.evidence.map((e) => e.message)]), null, 1));
  } finally {
    await fixture.stop();
    await browser.close();
  }
}, 120_000);
