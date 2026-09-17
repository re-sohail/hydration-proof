import type { Browser, Page } from 'playwright-core';
import type { AdapterNavigation } from '../adapters/types.ts';
import type { Draft } from '../analyze/draft.ts';
import { classifyReactMessage } from '../errors/react.ts';
import { myers } from '../dom/myers.ts';
import { normalizeTree, type NormalizeOptions } from '../dom/normalize.ts';
import { findElement, getAttr, isElement, isText } from '../dom/tree.ts';
import type { TimelineEntry } from '../report/model.ts';
import type { SFragment, SNode } from '../shared/protocol.ts';
import { capturePage, isAborted, waitForQuiet, type PageCapture, type ReadyOptions } from './capture.ts';
import { createScenarioContext, type ScenarioSpec } from './context.ts';
import type { InteractionOutcome } from './interactions.ts';
import { drainRuntime, readStatus, requestSnapshot } from './runtime-loader.ts';

// Client-side navigation (Next.js router.push, optionally after prefetch)
// compared with loading the same URL directly. Both runs use the same fixed
// browser clock and random seed, so client-generated values match.

export interface NavigationCheckOptions {
  ready: ReadyOptions;
  scenario: ScenarioSpec;
  navigation: AdapterNavigation;
  normalize: NormalizeOptions;
  prefetch: boolean;
  /** The route renders parallel routes or can be intercepted: differences are expected. */
  expectDifferences?: 'parallel' | 'intercepted';
}

export interface NavigationOutcome extends InteractionOutcome {
  timeline: TimelineEntry[];
}

const SKIPPED_TAGS = new Set(['script', 'style', 'link', 'noscript', 'template', 'meta', 'next-route-announcer']);
const MAX_DIFFERENCES = 5;

function pathOf(url: string): string {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

/** The visible structure of <body> as comparable tokens (digits masked). */
export function bodyTokens(tree: SFragment, normalize: NormalizeOptions): string[] {
  const normalized = normalizeTree(tree, normalize).tree;
  const body = findElement(normalized, (el) => el.tag === 'body');
  const tokens: string[] = [];
  const visit = (nodes: readonly SNode[]): void => {
    for (const node of nodes) {
      if (isText(node)) {
        const text = node.text.replace(/\s+/g, ' ').trim().replace(/\d+/g, '#');
        if (text) tokens.push(text);
        continue;
      }
      if (!isElement(node) || SKIPPED_TAGS.has(node.tag) || getAttr(node, 'hidden') !== null) continue;
      const id = getAttr(node, 'id');
      const classes = (getAttr(node, 'class') ?? '').split(/\s+/).filter(Boolean).sort().join('.');
      tokens.push(`<${node.tag}${id ? `#${id}` : ''}${classes ? `.${classes}` : ''}>`);
      visit(node.children);
      tokens.push(`</${node.tag}>`);
    }
  };
  if (body) visit(body.children);
  return tokens;
}

export function describeDifferences(direct: readonly string[], client: readonly string[]): string[] {
  const out: string[] = [];
  let removed: string[] = [];
  let added: string[] = [];
  const flush = (): void => {
    if (removed.length === 0 && added.length === 0) return;
    const show = (tokens: string[]): string => {
      const text = tokens.join(' ');
      return text.length > 120 ? `${text.slice(0, 117)}...` : text;
    };
    if (removed.length > 0 && added.length > 0) out.push(`Direct load: ${show(removed)} / after navigation: ${show(added)}`);
    else if (removed.length > 0) out.push(`Only on direct load: ${show(removed)}`);
    else out.push(`Only after navigation: ${show(added)}`);
    removed = [];
    added = [];
  };
  for (const edit of myers(direct, client)) {
    if (edit.op === 'equal') flush();
    else if (edit.op === 'delete') removed.push(direct[edit.a]!);
    else added.push(client[edit.b]!);
  }
  flush();
  return out;
}

const hydrated = (capture: PageCapture): boolean => capture.outcome === 'hydrated' || capture.outcome === 'hydration-stalled';

async function directLoad(browser: Browser, url: string, options: NavigationCheckOptions): Promise<{ tokens: string[]; finalPath: string } | undefined> {
  const context = await createScenarioContext(browser, options.scenario);
  try {
    const capture = await capturePage(context, url, options.ready);
    if (!hydrated(capture)) return undefined;
    const snapshot = capture.runtime.snapshots.find((entry) => entry.seq === capture.stableSnapshot);
    if (!snapshot) return undefined;
    return { tokens: bodyTokens(snapshot.tree, options.normalize), finalPath: pathOf(capture.finalUrl) };
  } finally {
    await context.close();
  }
}

interface ClientNavigation {
  skipped?: string;
  tokens?: string[];
  finalPath?: string;
  fullReload: boolean;
  problems: string[];
  timeline: TimelineEntry[];
}

async function evaluateSource(page: Page, source: string, url: string): Promise<boolean> {
  return (await page.evaluate(`(${source})(${JSON.stringify(url)})`)) === true;
}

async function clientNavigation(browser: Browser, fromUrl: string, targetUrl: string, prefetched: boolean, options: NavigationCheckOptions): Promise<ClientNavigation> {
  const context = await createScenarioContext(browser, options.scenario);
  const result: ClientNavigation = { fullReload: false, problems: [], timeline: [] };
  const label = prefetched ? 'after prefetch' : 'without prefetch';
  try {
    await capturePage(context, fromUrl, options.ready, {
      beforeClose: async (page, capture) => {
        if (!hydrated(capture)) {
          result.skipped = `the page to navigate from (${pathOf(fromUrl)}) did not hydrate`;
          return;
        }
        const fromPath = pathOf(page.url());
        const targetPath = pathOf(targetUrl);
        const before = await readStatus(page);
        const started = Date.now();
        // Timeline times of this check count from its own page load.
        const timeOrigin = capture.startedAt;
        const at = (): number => Date.now() - timeOrigin;
        const targetPathname = new URL(targetUrl).pathname;
        if (prefetched && options.navigation.prefetch) {
          if (await evaluateSource(page, options.navigation.prefetch, targetPath)) {
            const deadline = Date.now() + 5_000;
            while (Date.now() < deadline && !capture.network.some((entry) => entry.type === 'rsc' && entry.start >= started - 50 && entry.failure === undefined)) {
              await new Promise((resolve) => setTimeout(resolve, 50));
            }
            await waitForQuiet(page, 100, options.ready.pollMs, Date.now() + 2_000);
          }
        }
        result.timeline.push({ time: at(), kind: 'navigation', label: `Client navigation ${label} from ${fromPath} to ${targetPath}` });
        const navigated = Date.now();
        if (!(await evaluateSource(page, options.navigation.navigate, targetPath))) {
          result.skipped = 'the app router is not available on the page';
          return;
        }
        try {
          await page.waitForURL((url) => pathOf(url.href) !== fromPath, { timeout: options.ready.timeout, waitUntil: 'commit' });
        } catch {
          result.problems.push(`The URL did not change within ${options.ready.timeout}ms after navigating to ${targetPath}.`);
        }
        await page.waitForLoadState('domcontentloaded').catch(() => undefined);
        await waitForQuiet(page, options.ready.quietMs, options.ready.pollMs, Date.now() + options.ready.timeout);
        let after;
        try {
          after = await readStatus(page);
        } catch {
          // The runtime of a new document may not be ready yet.
          await page.waitForLoadState('load').catch(() => undefined);
          after = await readStatus(page).catch(() => undefined);
        }
        result.fullReload = after !== undefined && after.navigationId !== before.navigationId;
        result.finalPath = pathOf(page.url());
        const seq = await requestSnapshot(page, 'stable');
        const payload = await drainRuntime(page);
        const snapshot = payload.snapshots.find((entry) => entry.seq === seq);
        if (snapshot) result.tokens = bodyTokens(snapshot.tree, options.normalize);
        const pageOrigin = capture.timeOrigin ?? capture.startedAt;
        for (const error of payload.errors) {
          if (error.time < navigated - pageOrigin && !result.fullReload) continue;
          if (error.source === 'console-warn') continue;
          if (error.source === 'console-error' && !classifyReactMessage(error.message)) continue;
          result.problems.push(`${error.source === 'console-error' ? 'Console error' : 'Error'}: ${error.message.split('\n')[0]}`);
        }
        for (const error of capture.pageErrors) {
          if (error.at >= navigated) result.problems.push(`Uncaught error: ${error.message.split('\n')[0]}`);
        }
        for (const request of capture.network) {
          if (request.type !== 'rsc' || request.start < started - 50) continue;
          const forTarget = new URL(request.url).pathname === targetPathname;
          if (forTarget && request.failure !== undefined && !isAborted(request.failure)) {
            result.problems.push(`The RSC request ${pathOf(request.url)} failed: ${request.failure}`);
          } else if (forTarget && request.status !== undefined && request.status >= 400) {
            result.problems.push(`The RSC request ${pathOf(request.url)} answered ${request.status}.`);
          }
          result.timeline.push({
            time: request.start - timeOrigin + (request.duration ?? 0),
            kind: 'network',
            label: `${request.prefetch ? 'RSC prefetch' : 'RSC request'}: ${pathOf(request.url)}`,
            detail: `${request.status ?? request.failure ?? '?'}${request.duration !== undefined ? `, ${request.duration}ms` : ''}`,
          });
        }
        result.timeline.push({
          time: at(),
          kind: 'navigation',
          label: result.fullReload ? `The app loaded ${result.finalPath} as a new document (full page load)` : `Client navigation ${label} settled on ${result.finalPath}`,
        });
      },
    });
  } finally {
    await context.close();
  }
  return result;
}

/** Navigate to `targetUrl` from `fromUrl` inside the app and compare with loading it directly. */
export async function checkNavigation(browser: Browser, fromUrl: string, targetUrl: string, options: NavigationCheckOptions): Promise<NavigationOutcome> {
  const direct = await directLoad(browser, targetUrl, options);
  if (!direct) return { drafts: [], skipped: 'the page did not hydrate when loaded directly', timeline: [] };
  const variants = options.prefetch && options.navigation.prefetch ? [false, true] : [false];
  const drafts: Draft[] = [];
  const timeline: TimelineEntry[] = [];
  let skipped: string | undefined;
  for (const prefetched of variants) {
    const run = await clientNavigation(browser, fromUrl, targetUrl, prefetched, options);
    timeline.push(...run.timeline);
    if (run.skipped !== undefined) {
      skipped = run.skipped;
      break;
    }
    const how = prefetched ? 'after the router prefetched it' : 'from another page';
    const key = prefetched ? 'navigation:prefetch' : 'navigation';
    if (run.problems.length > 0) {
      drafts.push({
        code: 'HP5005',
        stage: 'runtime',
        confidence: 0.9,
        key,
        message: `Navigating to this route ${how} failed: ${run.problems[0]}`,
        evidence: run.problems.map((message) => ({ kind: 'note' as const, message })),
      });
      continue;
    }
    if (run.fullReload) continue; // The framework chose a full page load (for example another root layout).
    const differences: string[] = [];
    if (run.finalPath !== undefined && run.finalPath !== direct.finalPath) {
      differences.push(`Navigating ends on ${run.finalPath}; loading the URL directly ends on ${direct.finalPath}.`);
    }
    if (run.tokens) differences.push(...describeDifferences(direct.tokens, run.tokens));
    if (differences.length === 0) continue;
    const expected = options.expectDifferences;
    const draft: Draft = {
      code: 'HP5004',
      stage: 'stable',
      confidence: expected ? 0.5 : 0.8,
      key,
      message: `Navigating to this route ${how} renders different content than loading ${pathOf(targetUrl)} directly (${differences.length} difference${differences.length === 1 ? '' : 's'}).`,
      evidence: differences.slice(0, MAX_DIFFERENCES).map((message) => ({ kind: 'dom-change' as const, message })),
    };
    if (expected) {
      draft.severity = 'info';
      draft.evidence.unshift({
        kind: 'note',
        message:
          expected === 'parallel'
            ? 'The route renders parallel routes: client navigation keeps the active state of other slots, while a direct load renders their default.js. This can be intended.'
            : 'An intercepting route can show this route in place of the full page during client navigation. This is usually intended.',
      });
    }
    drafts.push(draft);
  }
  return skipped !== undefined && drafts.length === 0 ? { drafts, skipped, timeline } : { drafts, timeline };
}
