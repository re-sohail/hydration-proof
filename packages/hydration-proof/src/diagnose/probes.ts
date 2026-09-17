import type { ProbeFactor } from '../config/types.ts';
import type { Issue, ProbeResult } from '../report/model.ts';
import { CAUSES, causeDocsUrl, type CauseId } from './index.ts';

// Differential probes: the page is loaded again with the browser clock and
// random values fixed, then with exactly one thing changed. A finding that
// changes with that one thing is proven to depend on it.

/** What a probe run saw of one finding; `undefined` when the run did not complete. */
export interface ProbeObservation {
  present: boolean;
  client?: string | null;
}

export type ProbeRun = 'base' | 'control' | ProbeFactor;

/** Factors that are proven by the finding appearing or disappearing. */
const ENVIRONMENT_FACTORS: ReadonlySet<ProbeFactor> = new Set(['locale', 'timezone', 'theme', 'viewport', 'storage']);

export const FACTOR_CAUSE: Record<ProbeFactor, CauseId> = {
  time: 'time',
  random: 'random',
  locale: 'locale',
  timezone: 'timezone',
  theme: 'theme',
  viewport: 'media-query',
  storage: 'storage',
};

const FACTOR_TEXT: Record<ProbeFactor, string> = {
  time: 'the browser clock',
  random: 'the random seed',
  locale: 'the browser locale',
  timezone: 'the browser timezone',
  theme: 'the color scheme',
  viewport: 'the viewport',
  storage: 'browser storage',
};

/** When several factors change the finding, the most specific one names the cause. */
const PRIORITY: readonly ProbeFactor[] = ['random', 'time', 'timezone', 'locale', 'storage', 'theme', 'viewport'];

function show(value: string | null | undefined): string {
  if (value === undefined) return '(absent)';
  if (value === null) return '(no value)';
  const text = value.length > 60 ? `${value.slice(0, 57)}...` : value;
  return JSON.stringify(text);
}

export function evaluateProbes(
  observations: ReadonlyMap<ProbeRun, ProbeObservation | undefined>,
  factors: readonly ProbeFactor[],
): ProbeResult[] {
  const base = observations.get('base');
  const control = observations.get('control');
  if (!base?.present) {
    return factors.map((factor) => ({ factor, result: 'inconclusive', detail: 'The finding did not appear with the clock and random values fixed.' }));
  }
  const results: ProbeResult[] = [];
  const controlPresence = control !== undefined && control.present !== base.present;
  const controlValue = control !== undefined && control.present && control.client !== base.client;
  if (control === undefined) {
    results.push({ factor: 'repeat', result: 'inconclusive', detail: 'The identical reload did not complete.' });
  } else if (controlPresence || controlValue) {
    results.push({
      factor: 'repeat',
      result: 'changes',
      detail: controlValue ? `An identical reload rendered ${show(control.client)} instead of ${show(base.client)}.` : 'The finding disappeared in an identical reload.',
    });
  } else {
    results.push({ factor: 'repeat', result: 'stable' });
  }

  for (const factor of factors) {
    const variant = observations.get(factor);
    if (variant === undefined) {
      results.push({ factor, result: 'inconclusive', detail: 'The probe page did not load.' });
      continue;
    }
    const presenceChanged = variant.present !== base.present;
    const valueChanged = variant.present && variant.client !== base.client;
    if (ENVIRONMENT_FACTORS.has(factor) && presenceChanged && !controlPresence) {
      results.push({ factor, result: 'changes', detail: `The finding disappears when only ${FACTOR_TEXT[factor]} changes.` });
    } else if (controlPresence || controlValue || control === undefined) {
      results.push({ factor, result: 'inconclusive', detail: 'The page renders differently on identical reloads.' });
    } else if (presenceChanged || valueChanged) {
      results.push({
        factor,
        result: 'changes',
        detail: presenceChanged
          ? `The finding disappears when only ${FACTOR_TEXT[factor]} changes.`
          : `The client rendered ${show(variant.client)} instead of ${show(base.client)} when only ${FACTOR_TEXT[factor]} changed.`,
      });
    } else {
      results.push({ factor, result: 'stable' });
    }
  }
  return results;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/** Record probe results on a finding and, when they prove a cause, set it. */
export function applyProbeResults(issue: Issue, results: ProbeResult[]): void {
  issue.probes = results;
  const changed = results.filter((result) => result.result === 'changes' && result.factor !== 'repeat').map((result) => result.factor as ProbeFactor);
  const repeat = results.find((result) => result.factor === 'repeat');

  if (changed.length > 0) {
    const current = issue.cause?.id;
    const proven = changed.find((factor) => FACTOR_CAUSE[factor] === current) ?? PRIORITY.find((factor) => changed.includes(factor))!;
    const id = FACTOR_CAUSE[proven];
    const others = changed.filter((factor) => factor !== proven);
    issue.cause = { id, title: CAUSES[id].title, confidence: 0.99, docsUrl: causeDocsUrl(id), proven: true };
    const detail = results.find((result) => result.factor === proven)?.detail ?? '';
    issue.evidence.unshift({
      kind: 'note',
      message: `Proven by a probe: ${detail}${others.length > 0 ? ` It also changes with ${others.map((factor) => FACTOR_TEXT[factor]).join(' and ')}.` : ''}`,
    });
    issue.suggestions = dedupe([...CAUSES[id].fixes, ...issue.suggestions]);
    issue.confidence = Math.max(issue.confidence, 0.95);
    return;
  }

  if (repeat?.result === 'changes') {
    issue.evidence.unshift({
      kind: 'note',
      message: `${repeat.detail ?? ''} The browser clock and random values were fixed, so the value comes from the server or an API that answers differently each time.`,
    });
    if (!issue.cause || issue.cause.confidence < 0.6 || issue.cause.id === 'time' || issue.cause.id === 'random') {
      issue.cause = { id: 'data', title: CAUSES.data.title, confidence: 0.85, docsUrl: causeDocsUrl('data') };
      issue.suggestions = dedupe([...CAUSES.data.fixes, ...issue.suggestions]);
    }
    return;
  }

  const stable = results.filter((result) => result.result === 'stable' && result.factor !== 'repeat').map((result) => result.factor as ProbeFactor);
  if (stable.length === 0) return;
  const ruledOut = stable.filter((factor) => FACTOR_CAUSE[factor] === issue.cause?.id);
  issue.evidence.push({
    kind: 'note',
    message: `Probes changed ${stable.map((factor) => FACTOR_TEXT[factor]).join(', ')} without changing this finding.`,
  });
  if (issue.cause && ruledOut.length > 0 && !issue.suppressed) {
    issue.cause = { ...issue.cause, confidence: Math.min(issue.cause.confidence, 0.4) };
  }
}
