import type { NetworkEntry, RuntimeData } from '../engine/capture.ts';
import type { TimelineEntry } from '../report/model.ts';
import { classifyReactMessage } from '../errors/react.ts';

const MAX_ENTRIES = 150;
const MAX_UPDATES = 10;

function firstLine(text: string, max = 140): string {
  const line = text.split('\n')[0] ?? text;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

const MAX_SCRIPTS = 20;

function shortUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const file = parsed.pathname.split('/').pop() || parsed.pathname;
    return parsed.pathname.length > 60 ? `…/${file}` : parsed.pathname + (parsed.search.length > 40 ? '?…' : parsed.search);
  } catch {
    return url;
  }
}

function networkEntries(network: readonly NetworkEntry[], timeOrigin: number): TimelineEntry[] {
  const out: TimelineEntry[] = [];
  let scripts = 0;
  for (const request of network) {
    const started = request.start - timeOrigin;
    if (request.failure !== undefined) {
      out.push({ time: started, kind: 'network', label: `${request.type === 'rsc' ? 'RSC request' : 'Script'} failed: ${shortUrl(request.url)}`, detail: request.failure });
      continue;
    }
    const time = started + (request.duration ?? 0);
    if (request.type === 'script') {
      if (++scripts > MAX_SCRIPTS) continue;
      out.push({ time, kind: 'network', label: `Script loaded: ${shortUrl(request.url)}`, detail: `${request.duration ?? '?'}ms${request.status !== undefined && request.status >= 400 ? `, HTTP ${request.status}` : ''}` });
    } else {
      out.push({
        time,
        kind: 'network',
        label: `${request.prefetch ? 'RSC prefetch' : 'RSC request'}: ${shortUrl(request.url)}`,
        detail: `${request.status ?? '?'}, ${request.duration ?? '?'}ms`,
      });
    }
  }
  return out;
}

/** What happened on the page, in order, for the report. */
export function buildTimeline(runtime: RuntimeData, network: readonly NetworkEntry[] = [], timeOrigin?: number): TimelineEntry[] {
  const entries: TimelineEntry[] = timeOrigin === undefined ? [] : networkEntries(network, timeOrigin);
  for (const renderer of runtime.renderers) {
    const build = renderer.bundleType === 0 ? 'production' : renderer.bundleType === 1 ? 'development' : 'unknown';
    entries.push({ time: renderer.time, kind: 'renderer', label: `React ${renderer.version} loaded (${build} build)` });
  }
  let updates = 0;
  for (const commit of runtime.commits) {
    if (commit.kind === 'update') {
      if (++updates > MAX_UPDATES) continue;
      entries.push({ time: commit.time, kind: 'commit', label: 'React update' });
      continue;
    }
    const label =
      commit.kind === 'hydration'
        ? `Hydration commit${commit.pendingAfter > 0 ? ` (${commit.pendingAfter} boundar${commit.pendingAfter === 1 ? 'y' : 'ies'} still dehydrated)` : ''}`
        : `Suspense boundary hydrated (${commit.pendingAfter} left)`;
    const entry: TimelineEntry = { time: commit.time, kind: 'commit', label };
    if (commit.readyState === 'loading') entry.detail = 'The HTML was still streaming.';
    if (commit.didError) entry.detail = 'React recovered from an error in this commit.';
    entries.push(entry);
  }
  const seenErrors = new Set<number | string>();
  for (const error of runtime.errors) {
    const key = error.errorId ?? `${error.source}:${error.message}`;
    if (seenErrors.has(key)) continue;
    seenErrors.add(key);
    const react = classifyReactMessage(error.message);
    if (!react && (error.source === 'console-warn' || error.source === 'console-error')) continue;
    entries.push({
      time: error.time,
      kind: 'error',
      label: `${react ? 'React' : 'Error'} (${error.source}): ${firstLine(error.message)}`,
    });
  }
  for (const batch of runtime.batches) {
    if (batch.phase === 'react-stream') {
      entries.push({ time: batch.time, kind: 'stream', label: 'Streamed Suspense content was revealed' });
    } else if (batch.phase === 'effects') {
      entries.push({ time: batch.time, kind: 'effects', label: 'Effects of the hydration commit changed the DOM' });
    } else if ((batch.phase === 'pre-hydration' || batch.phase === 'loading') && batch.summary && batch.summary.attrs + batch.summary.texts > 0) {
      const parts: string[] = [];
      if (batch.summary.attrs) parts.push(`${batch.summary.attrs} attribute${batch.summary.attrs === 1 ? '' : 's'}`);
      if (batch.summary.texts) parts.push(`${batch.summary.texts} text node${batch.summary.texts === 1 ? '' : 's'}`);
      const entry: TimelineEntry = { time: batch.time, kind: 'mutation', label: `A script changed ${parts.join(' and ')} before hydration` };
      if (batch.summary.targets.length > 0) entry.detail = batch.summary.targets.join(', ');
      entries.push(entry);
    }
  }
  for (const snapshot of runtime.snapshots) {
    if (snapshot.kind === 'post-effect') entries.push({ time: snapshot.time, kind: 'snapshot', label: 'Effects settled' });
    if (snapshot.kind === 'stable') entries.push({ time: snapshot.time, kind: 'snapshot', label: 'Page settled' });
  }
  return entries
    .filter((entry) => entry.time >= 0)
    .sort((a, b) => a.time - b.time)
    .slice(0, MAX_ENTRIES)
    .map((entry) => ({ ...entry, time: Math.round(entry.time * 10) / 10 }));
}
