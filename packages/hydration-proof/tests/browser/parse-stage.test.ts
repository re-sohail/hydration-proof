import { existsSync } from 'node:fs';
import { chromium, firefox, webkit, type Browser, type BrowserType } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DocumentResponse } from '../../src/engine/capture.ts';
import { parseDocument } from '../../src/engine/parse-stage.ts';
import type { SElement, SNode } from '../../src/shared/protocol.ts';
import { capture, harnessUrl, useBrowser } from '../helpers/browser.ts';

const chromiumBrowser = useBrowser();

function elements(nodes: SNode[] | undefined, out: SElement[] = []): SElement[] {
  for (const node of nodes ?? []) {
    if (node.k !== 1) continue;
    out.push(node);
    elements(node.children, out);
  }
  return out;
}

function child(nodes: SNode[], tag: string): SElement | undefined {
  return nodes.find((node): node is SElement => node.k === 1 && node.tag === tag);
}

const documents = new Map<string, DocumentResponse>();

async function documentFor(page: string): Promise<DocumentResponse> {
  const cached = documents.get(page);
  if (cached) return cached;
  const result = await capture(chromiumBrowser(), harnessUrl('19', 'production', page));
  if (!result.document?.body) throw new Error(`No body captured for ${page}`);
  documents.set(page, result.document);
  return result.document;
}

const engines: [string, BrowserType][] = [
  ['chromium', chromium],
  ['firefox', firefox],
  ['webkit', webkit],
];

describe.each(engines)('parse stage in %s', (name, type) => {
  const installed = existsSync(type.executablePath());
  let browser: Browser | undefined;

  beforeAll(async () => {
    if (installed) browser = await type.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  it.skipIf(!installed)('keeps <noscript> in <head> as raw text, like the live page', async () => {
    const parsed = await parseDocument(browser!, await documentFor('noscript-head'));
    expect(parsed.method).toBe('csp');
    const html = child(parsed.tree.children, 'html')!;
    const head = child(html.children, 'head')!;
    const meta = elements(head.children).find((el) => el.attrs.some(([key, value]) => key === 'name' && value === 'after-noscript'));
    expect(meta, 'meta after <noscript> must stay in <head>').toBeDefined();
    const noscript = child(head.children, 'noscript')!;
    expect(noscript.children.every((node) => node.k === 3)).toBe(true);
  });

  it.skipIf(!installed)('shows why the scripts-off fallback is only a fallback', async () => {
    const parsed = await parseDocument(browser!, await documentFor('noscript-head'), {}, 'no-javascript');
    const html = child(parsed.tree.children, 'html')!;
    const head = child(html.children, 'head')!;
    const inHead = elements(head.children).some((el) => el.attrs.some(([, value]) => value === 'after-noscript'));
    // With scripting disabled, <img> inside <noscript> closes <head>.
    expect(inHead).toBe(false);
  });

  it.skipIf(!installed)('reproduces browser repair of invalid nesting', async () => {
    const parsed = await parseDocument(browser!, await documentFor('invalid-nesting'));
    const all = elements(parsed.tree.children);
    const outer = all.find((el) => el.attrs.some(([k, v]) => k === 'id' && v === 'outer'))!;
    const inner = all.find((el) => el.attrs.some(([k, v]) => k === 'id' && v === 'inner'))!;
    expect(outer.children).toEqual([]);
    expect(inner).toBeDefined();
    expect(elements(outer.children)).not.toContain(inner);
  });

  it.skipIf(!installed)('never runs page scripts', async () => {
    const parsed = await parseDocument(browser!, await documentFor('pre-hydration-mutation'));
    const target = elements(parsed.tree.children).find((el) => el.attrs.some(([k, v]) => k === 'id' && v === 'target'))!;
    expect(target.attrs).not.toContainEqual(['data-extension', '1']);
    expect(target.children[0]).toMatchObject({ k: 3, text: 'original' });
  });
});
