import type { BrowserContext, Page, Response } from 'playwright-core';
import type {
  CapturedError,
  CommitInfo,
  DrainPayload,
  MutationBatch,
  RendererInfo,
  RootInfo,
  RuntimeStatus,
  Snapshot,
} from '../shared/protocol.ts';
import { drainRuntime, readStatus, requestSnapshot, RuntimeUnavailableError } from './runtime-loader.ts';

export interface ReadyOptions {
  /** Quiet time (no DOM mutation, no React commit) before the stable snapshot. */
  quietMs: number;
  /** Shorter quiet time used for the post-effect snapshot. */
  effectQuietMs: number;
  /** How long to wait for hydration to finish once React is on the page. */
  hydrationTimeout: number;
  /** How long after `load` to wait for React before concluding there is none. */
  noReactGrace: number;
  /** Hard cap for the whole capture. */
  timeout: number;
  /** Polling interval for runtime status. */
  pollMs: number;
  /** Maximum time to wait for the document body after navigation. */
  bodyTimeout: number;
  /** Optional selector that must be present before the stable snapshot. */
  selector?: string;
  /** Optional page function source (returns truthy when ready). */
  readyFunction?: string;
}

/** Quiet time after which boundaries that only wait for React count as stalled. */
const STALL_QUIET_MS = 2_000;

export const DEFAULT_READY: ReadyOptions = {
  quietMs: 400,
  effectQuietMs: 60,
  hydrationTimeout: 15_000,
  noReactGrace: 2_000,
  timeout: 30_000,
  pollMs: 25,
  bodyTimeout: 15_000,
};

export interface HttpExchange {
  url: string;
  status: number;
  headers: Record<string, string>;
}

export interface DocumentResponse extends HttpExchange {
  redirects: HttpExchange[];
  body?: string;
  bodyError?: string;
}

export type CaptureOutcome =
  | 'hydrated'
  /** Hydration finished except for boundaries React left for later (content is there). */
  | 'hydration-stalled'
  | 'client-only'
  | 'no-react'
  | 'no-root'
  | 'hydration-timeout'
  | 'navigation-failed';

export interface RuntimeData {
  navigationId?: string;
  status?: RuntimeStatus;
  renderers: RendererInfo[];
  roots: RootInfo[];
  commits: CommitInfo[];
  errors: CapturedError[];
  batches: MutationBatch[];
  snapshots: Snapshot[];
  dropped: NonNullable<DrainPayload['dropped']>;
  /** The page navigated to a new document while capturing. */
  navigations: number;
}

export interface BrowserMessage {
  type: string;
  text: string;
  url?: string;
  line?: number;
  column?: number;
}

export interface PageCapture {
  /** Epoch milliseconds when loading started. */
  startedAt: number;
  requestedUrl: string;
  finalUrl: string;
  outcome: CaptureOutcome;
  failure?: string;
  document?: DocumentResponse;
  runtime: RuntimeData;
  postEffectSnapshot?: number;
  stableSnapshot?: number;
  /** Uncaught errors reported by the browser (fallback evidence). */
  pageErrors: { message: string; stack?: string }[];
  /** console.error / console.warn seen by the browser (fallback evidence). */
  consoleMessages: BrowserMessage[];
  timings: { navigation: number; hydration?: number; total: number };
  /** Ready conditions that were not met before the timeout. */
  readyTimedOut?: boolean;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function emptyRuntime(): RuntimeData {
  return {
    renderers: [],
    roots: [],
    commits: [],
    errors: [],
    batches: [],
    snapshots: [],
    dropped: {},
    navigations: 0,
  };
}

function merge(into: RuntimeData, payload: DrainPayload): void {
  if (into.navigationId !== undefined && into.navigationId !== payload.navigationId) {
    // A client-side redirect replaced the document; keep only the newest one.
    const navigations = into.navigations + 1;
    Object.assign(into, emptyRuntime(), { navigations });
  }
  into.navigationId = payload.navigationId;
  into.status = payload.status;
  into.renderers = payload.renderers;
  into.roots = payload.roots;
  into.commits.push(...payload.commits);
  into.errors.push(...payload.errors);
  into.batches.push(...payload.batches);
  into.snapshots.push(...payload.snapshots);
  if (payload.dropped) {
    for (const [key, value] of Object.entries(payload.dropped)) {
      const k = key as keyof RuntimeData['dropped'];
      into.dropped[k] = (into.dropped[k] ?? 0) + (value ?? 0);
    }
  }
}

function isTransient(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    error instanceof RuntimeUnavailableError ||
    message.includes('Execution context was destroyed') ||
    message.includes('Cannot find context') ||
    message.includes('navigation')
  );
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function charsetOf(contentType: string | undefined): string {
  const match = contentType?.match(/charset\s*=\s*"?([^";\s]+)/i);
  return match?.[1]?.toLowerCase() ?? 'utf-8';
}

function decode(buffer: Buffer, contentType: string | undefined): string {
  try {
    return new TextDecoder(charsetOf(contentType)).decode(buffer);
  } catch {
    return new TextDecoder('utf-8').decode(buffer);
  }
}

export async function readDocument(response: Response, bodyTimeout: number): Promise<DocumentResponse> {
  const redirects: HttpExchange[] = [];
  for (let request = response.request().redirectedFrom(); request !== null; request = request.redirectedFrom()) {
    const redirect = await request.response();
    redirects.unshift({
      url: request.url(),
      status: redirect?.status() ?? 0,
      headers: redirect ? await redirect.allHeaders() : {},
    });
  }
  const headers = await response.allHeaders();
  const document: DocumentResponse = { url: response.url(), status: response.status(), headers, redirects };
  try {
    const buffer = await withTimeout(response.body(), bodyTimeout, 'Reading the document body');
    document.body = decode(buffer, headers['content-type']);
  } catch (error) {
    document.bodyError = error instanceof Error ? error.message : String(error);
  }
  return document;
}

class Poller {
  private lastActivity = -1;
  private quietSince = Date.now();
  loadedAt: number | undefined;
  status: RuntimeStatus | undefined;

  private readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async poll(): Promise<RuntimeStatus | undefined> {
    try {
      const status = await readStatus(this.page);
      if (this.status !== undefined && status.navigationId !== this.status.navigationId) {
        this.lastActivity = -1;
        this.loadedAt = undefined;
      }
      if (status.activity !== this.lastActivity) {
        this.lastActivity = status.activity;
        this.quietSince = Date.now();
      }
      if (status.readyState === 'complete' && this.loadedAt === undefined) this.loadedAt = Date.now();
      this.status = status;
      return status;
    } catch (error) {
      if (isTransient(error)) return undefined;
      throw error;
    }
  }

  quietFor(): number {
    return Date.now() - this.quietSince;
  }
}

async function waitForHydration(page: Page, options: ReadyOptions, deadline: number): Promise<CaptureOutcome> {
  const poller = new Poller(page);
  let reactSeenAt: number | undefined;
  while (Date.now() < deadline) {
    const status = await poller.poll();
    if (status !== undefined) {
      if (status.hydration === 'done') return 'hydrated';
      if (status.renderers > 0) reactSeenAt ??= Date.now();
      const loadedFor = poller.loadedAt === undefined ? 0 : Date.now() - poller.loadedAt;
      // A client root may mount before the hydrating one; wait a little first.
      if (status.hydration === 'client-only' && status.roots > 0 && loadedFor > options.noReactGrace) return 'client-only';
      if (status.renderers === 0 && loadedFor > options.noReactGrace) return 'no-react';
      if (
        status.hydration === 'hydrating' &&
        status.pendingBoundaries > 0 &&
        status.pendingWithContent === status.pendingBoundaries &&
        loadedFor > 0 &&
        poller.quietFor() > STALL_QUIET_MS
      ) {
        return 'hydration-stalled';
      }
      if (status.renderers > 0 && status.roots === 0 && loadedFor > options.noReactGrace * 2) return 'no-root';
      if (reactSeenAt !== undefined && Date.now() - reactSeenAt > options.hydrationTimeout) return 'hydration-timeout';
    }
    await sleep(options.pollMs);
  }
  return 'hydration-timeout';
}

async function waitForQuiet(page: Page, quietMs: number, pollMs: number, deadline: number): Promise<boolean> {
  const poller = new Poller(page);
  await poller.poll();
  while (Date.now() < deadline) {
    await sleep(pollMs);
    await poller.poll();
    if (poller.quietFor() >= quietMs) return true;
  }
  return false;
}

async function waitForUserReady(page: Page, options: ReadyOptions, deadline: number): Promise<boolean> {
  const remaining = (): number => Math.max(1, deadline - Date.now());
  try {
    if (options.selector !== undefined) {
      await page.waitForSelector(options.selector, { state: 'attached', timeout: remaining() });
    }
    if (options.readyFunction !== undefined) {
      await page.waitForFunction(options.readyFunction, undefined, { timeout: remaining(), polling: options.pollMs });
    }
    return true;
  } catch {
    return false;
  }
}

async function snapshotNow(page: Page, kind: 'post-effect' | 'stable'): Promise<number | undefined> {
  try {
    const seq = await requestSnapshot(page, kind);
    return seq > 0 ? seq : undefined;
  } catch (error) {
    if (isTransient(error)) return undefined;
    throw error;
  }
}

async function drainInto(page: Page, runtime: RuntimeData): Promise<void> {
  try {
    merge(runtime, await drainRuntime(page));
  } catch (error) {
    if (!isTransient(error)) throw error;
  }
}

export interface CaptureHooks {
  /** Runs after the final snapshot, while the page is still open. */
  beforeClose?(page: Page, capture: PageCapture): Promise<void>;
}

/**
 * Load `url` in a fresh page of `context` (which must already carry the
 * runtime init script) and capture every stage the runtime can see.
 */
export async function capturePage(
  context: BrowserContext,
  url: string,
  options: ReadyOptions = DEFAULT_READY,
  hooks: CaptureHooks = {},
): Promise<PageCapture> {
  const started = Date.now();
  const deadline = started + options.timeout;
  const page = await context.newPage();
  const pageErrors: PageCapture['pageErrors'] = [];
  const consoleMessages: BrowserMessage[] = [];
  page.on('pageerror', (error) => {
    const entry: { message: string; stack?: string } = { message: error.message };
    if (error.stack !== undefined) entry.stack = error.stack;
    pageErrors.push(entry);
  });
  page.on('console', (message) => {
    const type = message.type();
    if (type !== 'error' && type !== 'warning') return;
    const location = message.location();
    consoleMessages.push({
      type,
      text: message.text(),
      url: location.url,
      line: location.lineNumber,
      column: location.columnNumber,
    });
  });

  const runtime = emptyRuntime();
  const capture: PageCapture = {
    startedAt: started,
    requestedUrl: url,
    finalUrl: url,
    outcome: 'navigation-failed',
    runtime,
    pageErrors,
    consoleMessages,
    timings: { navigation: 0, total: 0 },
  };

  try {
    let response: Response | null;
    try {
      response = await page.goto(url, { waitUntil: 'commit', timeout: options.timeout });
    } catch (error) {
      capture.failure = error instanceof Error ? error.message : String(error);
      return capture;
    }
    capture.timings.navigation = Date.now() - started;
    const documentPromise = response ? readDocument(response, options.bodyTimeout) : undefined;

    capture.outcome = await waitForHydration(page, options, deadline);
    if (capture.outcome === 'hydrated' || capture.outcome === 'client-only') {
      capture.timings.hydration = Date.now() - started;
    }
    await drainInto(page, runtime);

    if (capture.outcome === 'hydrated' || capture.outcome === 'hydration-stalled') {
      await waitForQuiet(page, options.effectQuietMs, options.pollMs, deadline);
      const seq = await snapshotNow(page, 'post-effect');
      if (seq !== undefined) capture.postEffectSnapshot = seq;
    }

    const userReady = await waitForUserReady(page, options, deadline);
    const quiet = await waitForQuiet(page, options.quietMs, options.pollMs, deadline);
    if (!userReady || !quiet) capture.readyTimedOut = true;
    const stable = await snapshotNow(page, 'stable');
    if (stable !== undefined) capture.stableSnapshot = stable;
    await drainInto(page, runtime);

    capture.finalUrl = page.url();
    if (documentPromise) capture.document = await documentPromise;
    capture.timings.total = Date.now() - started;
    await hooks.beforeClose?.(page, capture);
    return capture;
  } finally {
    capture.timings.total = Date.now() - started;
    await page.close().catch(() => {});
  }
}
