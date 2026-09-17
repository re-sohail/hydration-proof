import type { PageCapture } from '../engine/capture.ts';
import type { Draft } from './draft.ts';

// Findings about the test run itself (HP9xxx).

export function analyzeOutcome(capture: PageCapture, expectedStatuses: readonly number[]): Draft[] {
  const drafts: Draft[] = [];
  const base = { stage: 'runtime' as const, evidence: [] };
  switch (capture.outcome) {
    case 'navigation-failed':
      drafts.push({ ...base, code: 'HP9004', confidence: 1, message: capture.failure ?? 'Navigation failed.', key: 'navigation' });
      return drafts;
    case 'no-react':
      drafts.push({ ...base, code: 'HP9002', confidence: 0.9, message: 'No React renderer was found on the page.', key: 'no-react' });
      break;
    case 'no-root':
      drafts.push({ ...base, code: 'HP9008', confidence: 0.8, message: 'React loaded but never mounted a root.', key: 'no-root' });
      break;
    case 'client-only':
      drafts.push({ ...base, code: 'HP9003', confidence: 0.9, message: 'React mounted with createRoot; there is no server HTML to hydrate.', key: 'client-only' });
      break;
    case 'hydration-timeout': {
      const pending = capture.runtime.status?.pendingBoundaries ?? 0;
      drafts.push({
        ...base,
        code: 'HP9001',
        confidence: 0.8,
        message:
          pending > 0
            ? `Hydration did not finish: ${pending} Suspense or Activity boundar${pending === 1 ? 'y is' : 'ies are'} still dehydrated.`
            : 'Hydration did not finish before the timeout.',
        key: 'hydration-timeout',
      });
      break;
    }
    default:
      break;
  }

  const document = capture.document;
  if (document) {
    if (document.status >= 400 && !expectedStatuses.includes(document.status)) {
      drafts.push({
        ...base,
        code: 'HP9005',
        confidence: 1,
        message: `The server answered ${document.status} for ${document.url}.`,
        evidence: [{ kind: 'http', message: `HTTP ${document.status}` }],
        key: 'http-status',
      });
    }
    if (document.body === undefined) {
      drafts.push({
        ...base,
        code: 'HP9006',
        confidence: 0.9,
        message: `The document body could not be read${document.bodyError ? `: ${document.bodyError}` : '.'}`,
        key: 'body',
      });
    }
  }

  const dropped = capture.runtime.dropped;
  if ((dropped.entries ?? 0) > 0 || (dropped.errors ?? 0) > 0 || (dropped.batches ?? 0) > 0) {
    drafts.push({
      ...base,
      code: 'HP9007',
      confidence: 1,
      message: `Capture buffers overflowed (${JSON.stringify(dropped)}); results may be incomplete.`,
      key: 'dropped',
    });
  }
  if (capture.readyTimedOut && capture.outcome === 'hydrated') {
    drafts.push({ ...base, code: 'HP9009', confidence: 0.6, message: 'The page kept changing until the timeout; the stable snapshot may be early.', key: 'ready' });
  }
  return drafts;
}
