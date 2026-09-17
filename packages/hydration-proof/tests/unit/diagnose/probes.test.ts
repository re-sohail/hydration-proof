import { describe, expect, it } from 'vitest';
import { applyProbeResults, evaluateProbes, type ProbeObservation, type ProbeRun } from '../../../src/diagnose/probes.ts';
import type { PageJob } from '../../../src/engine/run.ts';
import type { Issue } from '../../../src/report/model.ts';
import { probeFactors, probeVariants } from '../../../src/run/probes.ts';
import { aggregateRuns } from '../../../src/run/repeat.ts';

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    fingerprint: 'f1',
    code: 'HP1001',
    title: 't',
    severity: 'error',
    confidence: 0.8,
    message: 'm',
    route: { url: 'http://x.test/', pattern: '/' },
    scenario: 'default',
    stage: 'hydration',
    evidence: [],
    suggestions: ['old suggestion'],
    docsUrl: '',
    server: 'a',
    client: 'b',
    ...overrides,
  };
}

function observations(entries: [ProbeRun, ProbeObservation | undefined][]): Map<ProbeRun, ProbeObservation | undefined> {
  return new Map(entries);
}

describe('evaluateProbes', () => {
  it('proves a time dependency when only the clock changes the value', () => {
    const results = evaluateProbes(
      observations([
        ['base', { present: true, client: 'Rendered at 100' }],
        ['control', { present: true, client: 'Rendered at 100' }],
        ['time', { present: true, client: 'Rendered at 999' }],
        ['random', { present: true, client: 'Rendered at 100' }],
      ]),
      ['time', 'random'],
    );
    expect(results).toEqual([
      { factor: 'repeat', result: 'stable' },
      { factor: 'time', result: 'changes', detail: 'The client rendered "Rendered at 999" instead of "Rendered at 100" when only the browser clock changed.' },
      { factor: 'random', result: 'stable' },
    ]);
    const target = issue({ cause: { id: 'data', title: 'x', confidence: 0.5 } });
    applyProbeResults(target, results);
    expect(target.cause).toMatchObject({ id: 'time', proven: true, confidence: 0.99 });
    expect(target.evidence[0]!.message).toMatch(/^Proven by a probe: /);
    expect(target.suggestions[0]).toMatch(/different moments/);
    expect(target.suggestions).toContain('old suggestion');
  });

  it('proves environment dependencies by the finding disappearing, even when values vary between reloads', () => {
    const results = evaluateProbes(
      observations([
        ['base', { present: true, client: 'Opens 10:00 (request 1)' }],
        ['control', { present: true, client: 'Opens 10:00 (request 2)' }],
        ['timezone', { present: false }],
        ['locale', { present: true, client: 'Öffnet 10:00' }],
      ]),
      ['timezone', 'locale'],
    );
    expect(results.find((result) => result.factor === 'timezone')).toMatchObject({ result: 'changes' });
    expect(results.find((result) => result.factor === 'locale')).toMatchObject({ result: 'inconclusive' });
    expect(results.find((result) => result.factor === 'repeat')).toMatchObject({ result: 'changes' });
    const target = issue();
    applyProbeResults(target, results);
    expect(target.cause).toMatchObject({ id: 'timezone', proven: true });
  });

  it('keeps the diagnosed cause when several factors change the finding', () => {
    const results = evaluateProbes(
      observations([
        ['base', { present: true, client: '5:00 AM' }],
        ['control', { present: true, client: '5:00 AM' }],
        ['timezone', { present: false }],
        ['locale', { present: true, client: '05:00' }],
      ]),
      ['timezone', 'locale'],
    );
    const target = issue({ cause: { id: 'locale', title: 'Locale', confidence: 0.7 } });
    applyProbeResults(target, results);
    expect(target.cause).toMatchObject({ id: 'locale', proven: true });
    expect(target.evidence[0]!.message).toMatch(/also changes with the browser timezone/);
  });

  it('points at server data when identical reloads differ', () => {
    const results = evaluateProbes(
      observations([
        ['base', { present: true, client: 'Visits: 3' }],
        ['control', { present: true, client: 'Visits: 5' }],
        ['time', { present: true, client: 'Visits: 7' }],
      ]),
      ['time'],
    );
    expect(results).toEqual([
      { factor: 'repeat', result: 'changes', detail: 'An identical reload rendered "Visits: 5" instead of "Visits: 3".' },
      { factor: 'time', result: 'inconclusive', detail: 'The page renders differently on identical reloads.' },
    ]);
    const target = issue({ cause: { id: 'random', title: 'Random', confidence: 0.6 } });
    applyProbeResults(target, results);
    expect(target.cause).toMatchObject({ id: 'data', confidence: 0.85 });
    expect(target.cause?.proven).toBeUndefined();
  });

  it('lowers a guessed cause that the probes rule out, and handles pages that did not load', () => {
    const results = evaluateProbes(
      observations([
        ['base', { present: true, client: 'x' }],
        ['control', { present: true, client: 'x' }],
        ['random', { present: true, client: 'x' }],
        ['theme', undefined],
      ]),
      ['random', 'theme'],
    );
    expect(results[2]).toMatchObject({ factor: 'theme', result: 'inconclusive' });
    const target = issue({ cause: { id: 'random', title: 'Random', confidence: 0.9 } });
    applyProbeResults(target, results);
    expect(target.cause).toMatchObject({ id: 'random', confidence: 0.4 });
    expect(target.evidence.at(-1)!.message).toBe('Probes changed the random seed without changing this finding.');
  });

  it('is inconclusive when the finding does not reproduce', () => {
    const results = evaluateProbes(observations([['base', { present: false }], ['control', { present: false }]]), ['time']);
    expect(results).toEqual([{ factor: 'time', result: 'inconclusive', detail: 'The finding did not appear with the clock and random values fixed.' }]);
  });
});

describe('probeVariants', () => {
  const job: PageJob = {
    id: '/ [default]',
    url: 'http://x.test/',
    route: { url: 'http://x.test/', pattern: '/' },
    scenario: { name: 'default', context: { locale: 'de-DE', timezoneId: 'Asia/Karachi', colorScheme: 'light' }, localStorage: { a: '1' } },
  };

  it('fixes the clock and seed and changes exactly one thing per factor', () => {
    const factors = probeFactors(job.scenario, undefined);
    expect(factors).toEqual(['time', 'random', 'locale', 'timezone', 'theme', 'viewport', 'storage']);
    expect(probeFactors({ ...job.scenario, localStorage: undefined } as never, undefined)).not.toContain('storage');
    const now = Date.UTC(2026, 8, 17, 10, 30, 45);
    const variants = probeVariants(job, factors, { locale: 'en-US', timezoneId: 'UTC' }, now);
    const by = Object.fromEntries(variants.map((variant) => [variant.run, variant.job]));
    const clock = Date.UTC(2026, 8, 17, 10, 30);
    expect(by['base']!.scenario).toMatchObject({ clock, randomSeed: 1, cache: 'cold' });
    expect(by['control']!.scenario).toEqual(by['base']!.scenario);
    expect(by['control']!.id).toBe('/ [default] probe:control');
    expect(by['time']!.scenario.clock).toBeGreaterThan(clock + 3 * 86_400_000);
    expect(by['random']!.scenario.randomSeed).toBe(2);
    // Environment factors switch to what the server uses.
    expect(by['locale']!.scenario.context.locale).toBe('en-US');
    expect(by['timezone']!.scenario.context.timezoneId).toBe('UTC');
    expect(by['theme']!.scenario.context.colorScheme).toBe('dark');
    expect(by['viewport']!.scenario.context).toMatchObject({ isMobile: true, viewport: { width: 390, height: 844 } });
    expect(by['storage']!.scenario.localStorage).toBeUndefined();
    expect(by['base']!.scenario.localStorage).toEqual({ a: '1' });
  });
});

describe('aggregateRuns', () => {
  const pageOf = (fingerprints: string[], status: 'passed' | 'failed' | 'error' = fingerprints.length ? 'failed' : 'passed') => ({
    id: '/ [default]',
    route: { url: 'http://x.test/', pattern: '/' },
    scenario: 'default',
    url: 'http://x.test/',
    finalUrl: 'http://x.test/',
    status,
    outcome: status === 'error' ? 'navigation-failed' : 'hydrated',
    timings: { navigation: 1, total: 2 },
    issues: fingerprints,
    counts: { error: fingerprints.length, warning: 0, info: 0 },
  });

  it('merges runs, marks flaky findings and scores the page', () => {
    const result = aggregateRuns([
      { page: pageOf(['f1']), issues: [issue({ fingerprint: 'f1' })] },
      { page: pageOf([]), issues: [] },
      { page: pageOf(['f1', 'f2']), issues: [issue({ fingerprint: 'f1' }), issue({ fingerprint: 'f2', severity: 'warning' })] },
      { page: pageOf(['f1']), issues: [issue({ fingerprint: 'f1' })] },
      { page: pageOf([], 'error'), issues: [] },
    ]);
    expect(result.issues.map((entry) => [entry.fingerprint, entry.occurrences, entry.flaky])).toEqual([
      ['f1', { seen: 3, runs: 4 }, true],
      ['f2', { seen: 1, runs: 4 }, true],
    ]);
    expect(result.page).toMatchObject({ status: 'failed', runs: 5, flakiness: 0.6, issues: ['f1', 'f2'], counts: { error: 1, warning: 1, info: 0 } });
  });

  it('keeps consistent findings non-flaky', () => {
    const result = aggregateRuns([
      { page: pageOf(['f1']), issues: [issue()] },
      { page: pageOf(['f1']), issues: [issue()] },
    ]);
    expect(result.issues[0]).toMatchObject({ occurrences: { seen: 2, runs: 2 } });
    expect(result.issues[0]!.flaky).toBeUndefined();
    expect(result.page.flakiness).toBe(0);
  });
});
