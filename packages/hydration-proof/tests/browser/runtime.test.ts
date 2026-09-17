import { describe, expect, it } from 'vitest';
import type { SElement, SFragment, SNode } from '../../src/shared/protocol.ts';
import { capture, harnessUrl, MATRIX, useBrowser } from '../helpers/browser.ts';

function findById(nodes: SNode[] | undefined, id: string): SElement | undefined {
  for (const node of nodes ?? []) {
    if (node.k !== 1) continue;
    if (node.attrs.some(([name, value]) => name === 'id' && value === id)) return node;
    const found = findById(node.children, id) ?? findById(node.content, id);
    if (found) return found;
  }
  return undefined;
}

function find(tree: SFragment | undefined, id: string): SElement | undefined {
  return findById(tree?.children, id);
}

const browser = useBrowser();

describe.each(MATRIX)('React %s (%s)', (version, mode) => {
  const url = (page: string): string => harnessUrl(version, mode, page);
  const bundleType = mode === 'production' ? 0 : 1;

  it('connects through the DevTools hook and sees a clean hydration', async () => {
    const result = await capture(browser(), url('ok'));
    expect(result.outcome).toBe('hydrated');
    expect(result.runtime.renderers).toHaveLength(1);
    expect(result.runtime.renderers[0]?.version.startsWith(version === '18' ? '18.3.1' : '19.3.0')).toBe(true);
    expect(result.runtime.renderers[0]?.bundleType).toBe(bundleType);
    expect(result.runtime.roots).toEqual([
      expect.objectContaining({ mode: 'hydrate', containerSelector: '#root', pendingBoundaries: 0 }),
    ]);
    const hydration = result.runtime.commits.filter((commit) => commit.kind === 'hydration');
    expect(hydration).toHaveLength(1);
    expect(result.runtime.errors.filter((error) => error.source !== 'console-warn')).toEqual([]);
    // A clean hydration changes nothing in the DOM. React may re-set an
    // attribute to the value it already has (input `value`), which still
    // produces a mutation record; only structural changes would be real.
    const entries = result.runtime.batches
      .filter((batch) => batch.phase === 'hydration-commit')
      .flatMap((batch) => batch.entries ?? []);
    expect(entries.filter((entry) => entry.t !== 'attr')).toEqual([]);
    const input = find(result.runtime.snapshots[0]?.tree, 'root');
    const inputValue = JSON.stringify(input).match(/\["value","([^"]*)"\]/)?.[1];
    for (const entry of entries) if (entry.t === 'attr' && entry.name === 'value') expect(entry.old).toBe(inputValue);
    expect(result.stableSnapshot).toBeGreaterThan(0);
    expect(result.document?.status).toBe(200);
    expect(result.document?.body).toContain('<div id="root">');
  });

  it('captures the recoverable error and the replaced tree on a text mismatch', async () => {
    const result = await capture(browser(), url('text-mismatch'));
    expect(result.outcome).toBe('hydrated');
    const recoverable = result.runtime.errors.filter((error) => error.source === 'recoverable');
    expect(recoverable.length).toBeGreaterThan(0);
    expect(recoverable[0]?.componentStack).toMatch(/at p/);
    // Every report of the same error object carries the same id.
    const firstId = recoverable[0]?.errorId;
    const sameObject = result.runtime.errors.filter((error) => error.errorId === firstId);
    expect(sameObject.map((error) => error.source)).toEqual(
      expect.arrayContaining(['recoverable', 'report-error', 'window-error']),
    );

    const commit = result.runtime.commits.find((entry) => entry.kind === 'hydration');
    const batch = result.runtime.batches.find((entry) => entry.phase === 'hydration-commit' && entry.commit === commit?.seq);
    const childEntries = batch?.entries?.filter((entry) => entry.t === 'child') ?? [];
    expect(childEntries.some((entry) => entry.t === 'child' && entry.removed.length > 0)).toBe(true);

    const snapshot = result.runtime.snapshots.find((entry) => entry.seq === commit?.snapshot);
    expect(find(snapshot?.tree, 'env')?.children[0]).toMatchObject({ k: 3, text: 'client' });
  });

  it('records React client expectations that differ from the DOM on an attribute mismatch', async () => {
    const result = await capture(browser(), url('attr-mismatch'));
    expect(result.outcome).toBe('hydrated');
    const snapshot = result.runtime.snapshots.find((entry) => entry.kind === 'hydration');
    const themed = find(snapshot?.tree, 'themed');
    expect(themed?.attrs).toContainEqual(['class', 'light']);
    expect(themed?.client?.attrs).toMatchObject({ class: 'dark', 'data-side': 'client' });
    const styled = find(snapshot?.tree, 'styled');
    expect(styled?.client?.style).toContain('width: 20px');
    expect(styled?.client?.domStyle).toContain('width: 10px');
    if (mode === 'production' && version === '19') {
      // React 19 production reports nothing at all for this page.
      expect(result.runtime.errors.filter((error) => error.source !== 'console-warn')).toEqual([]);
    }
  });

  it('marks suppressHydrationWarning and keeps the expected client text', async () => {
    const result = await capture(browser(), url('suppress'));
    const snapshot = result.runtime.snapshots.find((entry) => entry.kind === 'hydration');
    const time = find(snapshot?.tree, 'now');
    expect(time?.client?.suppress).toBe(true);
    expect(time?.client?.text).toBe('client-time');
  });

  it('tracks Suspense boundaries that hydrate in a later commit', async () => {
    const result = await capture(browser(), url('suspense'));
    expect(result.outcome).toBe('hydrated');
    const kinds = result.runtime.commits.map((commit) => commit.kind);
    expect(kinds[0]).toBe('hydration');
    expect(kinds).toContain('boundary-hydration');
    expect(result.runtime.commits[0]?.pendingAfter).toBeGreaterThan(0);
    expect(result.runtime.batches.some((batch) => batch.phase === 'react-stream')).toBe(true);
    const stable = result.runtime.snapshots.find((entry) => entry.kind === 'stable');
    expect(JSON.stringify(stable?.tree)).toContain('Data: loaded');
  });

  it('reports client-only roots', async () => {
    const result = await capture(browser(), url('client-only'));
    expect(result.outcome).toBe('client-only');
    expect(result.runtime.roots[0]?.mode).toBe('client');
  });

  it('logs DOM changes made by page scripts before hydration', async () => {
    const result = await capture(browser(), url('pre-hydration-mutation'));
    const external = result.runtime.batches.filter(
      (batch) => (batch.phase === 'loading' || batch.phase === 'pre-hydration') && (batch.summary?.attrs ?? 0) > 0,
    );
    expect(external.length).toBeGreaterThan(0);
    expect(external[0]?.summary?.targets).toContain('p#target');
  });

  it('separates the post-effect snapshot from the hydration snapshot', async () => {
    const result = await capture(browser(), url('effect'));
    const hydration = result.runtime.snapshots.find((entry) => entry.kind === 'hydration');
    const postEffect = result.runtime.snapshots.find((entry) => entry.seq === result.postEffectSnapshot);
    expect(find(hydration?.tree, 'mounted')?.children[0]).toMatchObject({ text: 'server' });
    expect(find(postEffect?.tree, 'mounted')?.children[0]).toMatchObject({ text: 'client' });
  });
});

describe('without React', () => {
  it('concludes there is no React on a static page', async () => {
    const result = await capture(browser(), 'data:text/html,<!doctype html><title>x</title><p>static</p>');
    expect(result.outcome).toBe('no-react');
    expect(result.runtime.renderers).toEqual([]);
  });
});
