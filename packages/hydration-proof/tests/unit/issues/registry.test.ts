import { describe, expect, it } from 'vitest';
import { fingerprint, stableSelector } from '../../../src/issues/fingerprint.ts';
import { docsUrl, ISSUES, isIssueCode } from '../../../src/issues/registry.ts';
import { suggestionsFor } from '../../../src/issues/suggestions.ts';

describe('issue registry', () => {
  it('has unique codes and names and complete entries', () => {
    const names = new Set<string>();
    for (const [code, definition] of ISSUES) {
      expect(code).toMatch(/^HP\d{4}$/);
      expect(definition.code).toBe(code);
      expect(names.has(definition.name)).toBe(false);
      names.add(definition.name);
      expect(definition.title.length).toBeGreaterThan(5);
      expect(definition.description.endsWith('.') || definition.description.endsWith(')')).toBe(true);
    }
    expect(docsUrl('HP1001')).toBe('https://hydration.jscrate.dev/docs/issues/hp1001');
    expect(isIssueCode('HP1001')).toBe(true);
    expect(isIssueCode('HP0000')).toBe(false);
  });

  it('has advice for every error-level mismatch', () => {
    for (const [code, definition] of ISSUES) {
      if (definition.severity === 'error' && code.startsWith('HP1')) expect(suggestionsFor(code).length, code).toBeGreaterThan(0);
    }
  });
});

describe('fingerprints', () => {
  // Golden values: changing them invalidates every stored baseline.
  it('are stable', () => {
    expect(fingerprint({ code: 'HP1001', routePattern: '/date-now', selector: '#date-now' })).toBe('7fa732dc559089f6');
    expect(fingerprint({ code: 'HP1004', routePattern: '/products/[id]', selector: 'main > h2', attribute: 'class' })).toBe('6cb8aa38de835bd1');
    expect(fingerprint({ code: 'HP2001', routePattern: '/', key: 'hydration-failed' })).toBe('7fbb191593a89645');
  });

  it('ignore useId values and hashed class suffixes in selectors', () => {
    expect(stableSelector('#\\:r1\\: > p')).toBe('#r* > p');
    expect(stableSelector('#«r4» > p')).toBe('#r* > p');
    expect(stableSelector('#_r_5_ > p')).toBe('#r* > p');
    expect(stableSelector('#card-a1b2c3 > p')).toBe('#card > p');
    expect(stableSelector('#invalid-nesting')).toBe('#invalid-nesting');
    expect(stableSelector('.sc-gsDMPd')).toBe('.sc-gsDMPd');
    expect(fingerprint({ code: 'HP1001', routePattern: '/', selector: '#\\:r1\\:' })).toBe(
      fingerprint({ code: 'HP1001', routePattern: '/', selector: '#\\:r9\\:' }),
    );
  });
});
