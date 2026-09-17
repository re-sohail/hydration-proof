import { describe, expect, it } from 'vitest';
import { classifyEnvironments, describeSplit } from '../../../src/matrix/classify.ts';
import { expandMatrix, incompatibility } from '../../../src/matrix/expand.ts';
import { fullCombinations, pairwiseCombinations, sampleCombinations, type Assignment } from '../../../src/matrix/pairwise.ts';
import type { Issue, PageResult } from '../../../src/report/model.ts';

function coveredPairs(combos: number[][]): Set<string> {
  const out = new Set<string>();
  for (const combo of combos) {
    for (let i = 0; i < combo.length; i++) {
      for (let j = i + 1; j < combo.length; j++) out.add(`${i}:${combo[i]}|${j}:${combo[j]}`);
    }
  }
  return out;
}

function allPairs(sizes: number[], valid: (a: Assignment) => boolean = () => true): string[] {
  const out: string[] = [];
  for (let i = 0; i < sizes.length; i++) {
    for (let j = i + 1; j < sizes.length; j++) {
      for (let a = 0; a < sizes[i]!; a++) {
        for (let b = 0; b < sizes[j]!; b++) {
          const partial: (number | undefined)[] = sizes.map(() => undefined);
          partial[i] = a;
          partial[j] = b;
          if (valid(partial)) out.push(`${i}:${a}|${j}:${b}`);
        }
      }
    }
  }
  return out;
}

describe('pairwise combinations', () => {
  it.each([
    [[2, 2]],
    [[3, 3, 3]],
    [[3, 3, 3, 3]],
    [[4, 3, 2, 2, 5]],
    [[2, 2, 2, 2, 2, 2, 2, 2, 2, 2]],
  ])('covers every pair of %j with far fewer combinations than the full product', (sizes) => {
    const combos = pairwiseCombinations(sizes);
    const covered = coveredPairs(combos);
    for (const pair of allPairs(sizes)) expect(covered.has(pair), pair).toBe(true);
    expect(combos[0]).toEqual(sizes.map(() => 0));
    const product = sizes.reduce((a, b) => a * b, 1);
    expect(combos.length).toBeLessThanOrEqual(product);
    if (sizes.length >= 4) expect(combos.length).toBeLessThan(product / 2);
    // Deterministic.
    expect(pairwiseCombinations(sizes)).toEqual(combos);
  });

  it('respects constraints and never outputs an invalid combination', () => {
    // axis 0: browser (0 chromium, 1 firefox); axis 1: cpu (0 = 1x, 1 = 4x); axis 2: locale x3
    const valid = (a: Assignment): boolean => !(a[0] === 1 && a[1] === 1);
    const combos = pairwiseCombinations([2, 2, 3], valid);
    for (const combo of combos) expect(valid(combo)).toBe(true);
    const covered = coveredPairs(combos);
    for (const pair of allPairs([2, 2, 3], valid)) expect(covered.has(pair), pair).toBe(true);
    expect(covered.has('0:1|1:1')).toBe(false);
  });

  it('builds full and sampled combinations', () => {
    expect(fullCombinations([2, 3])).toEqual([[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]]);
    expect(fullCombinations([2, 3], (a) => a[1] !== 2)).toHaveLength(4);
    const sample = sampleCombinations([3, 3, 3], 5, 7);
    expect(sample).toHaveLength(5);
    expect(sample[0]).toEqual([0, 0, 0]);
    expect(new Set(sample.map((combo) => combo.join()))).toHaveProperty('size', 5);
    expect(sampleCombinations([3, 3, 3], 5, 7)).toEqual(sample);
    expect(sampleCombinations([3, 3, 3], 5, 8)).not.toEqual(sample);
  });
});

describe('expandMatrix', () => {
  it('leaves scenarios alone without a matrix', () => {
    const out = expandMatrix([{ name: 'default' }], undefined, { browser: 'chromium' });
    expect(out).toEqual([{ config: { name: 'default' }, base: 'default', environment: {} }]);
  });

  it('names environments after the varied axes and applies custom axes', () => {
    const out = expandMatrix(
      [{ name: 'guest', cookies: [{ name: 'a', value: '1' }] }],
      {
        locale: ['en-US', 'de-DE'],
        colorScheme: ['dark'],
        axes: {
          flags: { on: { cookies: [{ name: 'flag', value: 'on' }], query: { beta: '1' } }, off: {} },
        },
        strategy: 'full',
      },
      { browser: 'chromium' },
    );
    expect(out.map((entry) => entry.config.name)).toEqual([
      'guest (en-US, flags=on)',
      'guest (en-US, flags=off)',
      'guest (de-DE, flags=on)',
      'guest (de-DE, flags=off)',
    ]);
    expect(out[0]).toMatchObject({
      base: 'guest',
      environment: { locale: 'en-US', colorScheme: 'dark', flags: 'on' },
      config: {
        locale: 'en-US',
        colorScheme: 'dark',
        cookies: [{ name: 'a', value: '1' }, { name: 'flag', value: 'on' }],
        query: { beta: '1' },
      },
    });
    expect(out[1]!.config.cookies).toEqual([{ name: 'a', value: '1' }]);
  });

  it('skips impossible combinations and explains why', () => {
    const notes: string[] = [];
    const out = expandMatrix(
      [{ name: 'default' }],
      { browser: ['chromium', 'firefox', 'webkit'], cpu: [1, 4], network: ['fast', 'slow-3g'], cache: ['cold', 'warm'] },
      { browser: 'chromium' },
      notes,
    );
    for (const entry of out) {
      const { browser, cpu } = entry.config;
      if (browser !== 'chromium') expect(cpu).toBe(1);
      if (browser !== 'chromium' && entry.config.cache === 'warm') expect(entry.config.network).toBe('fast');
    }
    expect(out.some((entry) => entry.config.browser === 'chromium' && entry.config.cpu === 4)).toBe(true);
    expect(notes.join('\n')).toMatch(/CPU slowdown needs Chromium/);
    expect(incompatibility({ browser: 'webkit', cpu: 2, network: 'fast', cache: 'cold' })).toMatch(/Chromium/);
    expect(incompatibility({ browser: undefined, cpu: 2, network: 'fast', cache: 'cold' })).toBeUndefined();
  });

  it('limits the number of environments and only expands selected scenarios', () => {
    const notes: string[] = [];
    const out = expandMatrix(
      [{ name: 'a' }, { name: 'b' }],
      { locale: ['en-US', 'de-DE', 'fr-FR'], timezoneId: ['UTC', 'Asia/Karachi', 'America/New_York'], strategy: 'full', max: 4, scenarios: ['a'] },
      { browser: 'chromium' },
      notes,
    );
    const a = out.filter((entry) => entry.base === 'a');
    expect(a.length).toBeLessThanOrEqual(4);
    expect(out.filter((entry) => entry.base === 'b')).toEqual([{ config: { name: 'b' }, base: 'b', environment: {} }]);
    expect(notes.some((note) => note.includes('pairwise'))).toBe(true);
    expect(notes.some((note) => note.includes('first 4'))).toBe(true);
  });
});

function page(url: string, scenario: string, environment: Record<string, string>, fingerprints: string[], extra: Partial<PageResult> = {}): PageResult {
  return {
    id: `${url} [${scenario}]`,
    route: { url, pattern: new URL(url).pathname },
    scenario,
    baseScenario: 'default',
    url,
    finalUrl: url,
    status: fingerprints.length ? 'failed' : 'passed',
    outcome: 'hydrated',
    timings: { navigation: 1, total: 2 },
    issues: fingerprints,
    counts: { error: fingerprints.length, warning: 0, info: 0 },
    environment,
    ...extra,
  };
}

function issue(url: string, scenario: string, fingerprint: string, extra: Partial<Issue> = {}): Issue {
  return {
    fingerprint,
    code: 'HP1001',
    title: 't',
    severity: 'error',
    confidence: 1,
    message: 'm',
    route: { url, pattern: new URL(url).pathname },
    scenario,
    stage: 'hydration',
    evidence: [],
    suggestions: [],
    docsUrl: '',
    ...extra,
  };
}

describe('classifyEnvironments', () => {
  it('finds the axis that separates pages with and without a finding', () => {
    const url = 'http://x.test/price';
    const envs = [
      { name: 'default (en-US, UTC, chromium)', env: { locale: 'en-US', timezone: 'UTC', browser: 'chromium' }, has: false },
      { name: 'default (de-DE, Asia/Karachi, chromium)', env: { locale: 'de-DE', timezone: 'Asia/Karachi', browser: 'chromium' }, has: true },
      { name: 'default (de-DE, UTC, firefox)', env: { locale: 'de-DE', timezone: 'UTC', browser: 'firefox' }, has: true },
      { name: 'default (en-US, Asia/Karachi, firefox)', env: { locale: 'en-US', timezone: 'Asia/Karachi', browser: 'firefox' }, has: false },
    ];
    const pages = envs.map((entry) => page(url, entry.name, entry.env, entry.has ? ['f1'] : []));
    const issues = envs.filter((entry) => entry.has).map((entry) => issue(url, entry.name, 'f1'));
    classifyEnvironments(pages, issues);
    expect(issues[0]!.onlyIn).toEqual([{ axis: 'locale', values: ['de-DE'] }]);
    expect(issues[0]!.evidence.at(-1)?.message).toBe('Only found with locale de-DE.');
  });

  it('labels production-only findings across build modes on different ports', () => {
    const prod = 'http://127.0.0.1:4001/a';
    const dev = 'http://localhost:4002/a';
    const pages = [
      page(prod, 'default', { browser: 'chromium' }, ['f1'], { mode: 'production', baseScenario: undefined as unknown as string }),
      page(dev, 'default', { browser: 'chromium' }, [], { mode: 'development', baseScenario: undefined as unknown as string }),
    ];
    const issues = [issue(prod, 'default', 'f1', { mode: 'production' })];
    classifyEnvironments(pages, issues);
    expect(issues[0]!.onlyIn).toEqual([{ axis: 'mode', values: ['production'] }]);
    expect(describeSplit(issues[0]!.onlyIn!)).toBe('Only found with the production build.');
  });

  it('reports every separating axis when the combinations cannot tell them apart, and nothing for findings seen everywhere', () => {
    const url = 'http://x.test/b';
    const pages = [
      page(url, 'a', { locale: 'en-US', colorScheme: 'light' }, ['f2']),
      page(url, 'b', { locale: 'de-DE', colorScheme: 'dark' }, ['f1', 'f2']),
    ];
    const issues = [issue(url, 'b', 'f1'), issue(url, 'a', 'f2'), issue(url, 'b', 'f2')];
    classifyEnvironments(pages, issues);
    expect(issues[0]!.onlyIn).toEqual([
      { axis: 'locale', values: ['de-DE'] },
      { axis: 'colorScheme', values: ['dark'] },
    ]);
    expect(describeSplit(issues[0]!.onlyIn!)).toMatch(/cannot tell which/);
    expect(issues[1]!.onlyIn).toBeUndefined();
  });
});
