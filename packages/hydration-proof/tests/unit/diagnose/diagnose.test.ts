import { describe, expect, it } from 'vitest';
import { diagnose, type DiagnosisContext } from '../../../src/diagnose/index.ts';
import type { Issue } from '../../../src/report/model.ts';

function issue(overrides: Partial<Issue>): Issue {
  return {
    fingerprint: 'f',
    code: 'HP1001',
    title: 't',
    severity: 'error',
    confidence: 1,
    message: 'm',
    route: { url: 'http://x.test/', pattern: '/' },
    scenario: 'default',
    stage: 'hydration',
    evidence: [],
    suggestions: [],
    docsUrl: '',
    ...overrides,
  };
}

const base: DiagnosisContext = { scenario: { locale: 'en-US', timezoneId: 'UTC' }, server: { locale: 'en-US', timezoneId: 'UTC' } };

describe('diagnose', () => {
  it.each([
    ['time', { server: 'Rendered at 1789636874184', client: 'Rendered at 1789636874262' }, base],
    ['random', { server: 'Lucky 0.36467588', client: 'Lucky 0.28925467' }, base],
    ['random', { server: 'id 3f1c2a9e-1b2c-4d3e-8f4a-5b6c7d8e9f00', client: 'id 9a8b7c6d-5e4f-4a3b-9c2d-1e0f2a3b4c5d' }, base],
    ['locale', { server: 'Total: 1,234,567.891', client: 'Total: 1.234.567,891' }, { ...base, scenario: { ...base.scenario, locale: 'de-DE' } }],
    ['timezone', { server: 'Opens at 5:00:00 AM', client: 'Opens at 10:00:00 AM' }, { ...base, scenario: { ...base.scenario, timezoneId: 'Asia/Karachi' } }],
    ['theme', { attribute: 'class', server: 'card theme-light', client: 'card theme-dark' }, { ...base, scenario: { ...base.scenario, colorScheme: 'dark' } }],
    ['css-in-js', { code: 'HP1004' as const, attribute: 'class', server: 'sc-gsDMPd eWJlSr', client: 'sc-bdvwhi fiFffQ' }, base],
    ['unstable-id', { code: 'HP1002' as const, attribute: 'id', server: ':R5:', client: ':r1:' }, base],
    ['extension', { code: 'HP4002' as const }, base],
    ['invalid-html', { code: 'HP3001' as const }, base],
    ['third-party-script', { code: 'HP4001' as const }, base],
    ['data', { server: 'Visits: 1', client: 'Visits: 2' }, base],
  ])('finds %s', (expected, overrides, context) => {
    expect(diagnose(issue(overrides as Partial<Issue>), context).cause?.id).toBe(expected);
  });

  it('uses CDN headers for whitespace differences', () => {
    const plain = diagnose(issue({ code: 'HP1015', server: 'Hello', client: 'Hello ' }), base);
    const viaCdn = diagnose(issue({ code: 'HP1015', server: 'Hello', client: 'Hello ' }), { ...base, headers: { 'cf-ray': 'abc' } });
    expect(plain.cause?.id).toBe('cdn');
    expect(viaCdn.cause!.confidence).toBeGreaterThan(plain.cause!.confidence);
  });

  it('reads the source around the element', () => {
    const content = [
      "'use client';",
      'export function Greeting() {',
      "  const name = typeof window === 'undefined' ? 'guest' : localStorage.getItem('name');",
      '  return <p id="greeting">Hi {name}</p>;',
      '}',
    ].join('\n');
    const result = diagnose(issue({ server: 'Hi guest', client: 'Hi Sohail' }), { ...base, source: { content, line: 4, file: 'app/Greeting.tsx' } });
    expect(result.cause?.id).toBe('storage');
    expect(result.evidence.some((entry) => entry.message.startsWith('app/Greeting.tsx:3'))).toBe(true);
    expect(result.suggestions[0]).toMatch(/Storage is only available in the browser/);
  });

  it('keeps intentional suppression as info and flags suspicious suppression', () => {
    const intentional = diagnose(issue({ code: 'HP6001', suppressed: true, server: '10:01:02', client: '10:01:05' }), base);
    expect(intentional.cause?.id).toBe('suppressed');
    expect(intentional.severity).toBeUndefined();
    const content = "function Name() {\n  const user = localStorage.getItem('user');\n  return <b suppressHydrationWarning>{user}</b>;\n}";
    const suspicious = diagnose(issue({ code: 'HP6001', suppressed: true, server: 'guest', client: 'Sohail' }), { ...base, source: { content, line: 3, file: 'x.tsx' } });
    expect(suspicious.severity).toBe('warning');
    expect(suspicious.evidence.some((entry) => /does not look intentional/.test(entry.message))).toBe(true);
  });

  it('stays silent without evidence', () => {
    expect(diagnose(issue({ server: 'Alpha', client: 'Beta' }), base).cause).toBeUndefined();
  });
});
