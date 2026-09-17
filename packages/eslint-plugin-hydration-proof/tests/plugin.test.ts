import { existsSync, readFileSync } from 'node:fs';
import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';
import plugin, { configs, rules } from '../src/index.ts';

const packageRoot = new URL('../', import.meta.url);
const docsRoot = new URL('../../../docs/', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8')) as {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

const RULE_NAMES = [
  'no-date-in-render',
  'no-random-in-render',
  'no-browser-global-in-render',
  'no-storage-in-initial-render',
  'no-match-media-in-render',
  'no-locale-without-explicit-locale',
  'no-timezone-without-explicit-timezone',
  'no-unstable-id',
  'no-global-render-counter',
  'no-window-render-branch',
  'no-invalid-interactive-nesting',
  'audit-suppress-hydration-warning',
  'no-client-only-initial-state',
  'require-stable-server-snapshot',
  'require-deterministic-list-order',
];
const WARN_IN_RECOMMENDED = new Set([
  'no-locale-without-explicit-locale',
  'no-timezone-without-explicit-timezone',
  'no-client-only-initial-state',
  'require-deterministic-list-order',
]);

describe('plugin', () => {
  it('describes itself with the package name and version', () => {
    expect(plugin.meta).toEqual({ name: pkg.name, version: pkg.version, namespace: 'hydration-proof' });
    expect(plugin.rules).toBe(rules);
    expect(plugin.configs).toBe(configs);
  });

  it('has no runtime dependencies and supports ESLint 9 and 10', () => {
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(pkg.peerDependencies).toEqual({ eslint: '^9.0.0 || ^10.0.0' });
  });

  it('exports the 15 rules', () => {
    expect(Object.keys(rules).sort()).toEqual([...RULE_NAMES].sort());
  });
});

describe.each(RULE_NAMES)('rule %s', (name) => {
  const rule = rules[name as keyof typeof rules];
  const meta = rule.meta!;

  it('has complete metadata', () => {
    expect(meta.docs?.url).toBe(`https://hydration.jscrate.dev/docs/rules/${name}`);
    expect(meta.docs?.description).toMatch(/^[A-Z].{20,}[^.]$/);
    expect(['problem', 'suggestion']).toContain(meta.type);
    expect(Array.isArray(meta.schema)).toBe(true);
    expect(Object.keys(meta.messages ?? {}).length).toBeGreaterThan(0);
  });

  it('never autofixes', () => {
    expect(meta.fixable).toBeUndefined();
  });

  it('explains why each report breaks hydration', () => {
    const suggestions = new Set(['addLocale', 'addTimeZone', 'useUtc', 'remove', 'threeWay']);
    for (const [id, message] of Object.entries(meta.messages ?? {})) {
      if (suggestions.has(id)) continue;
      expect(message, id).toMatch(/hydrat|server/i);
      expect(message, id).toMatch(/\.$/);
    }
  });

  it('has a documentation page', () => {
    const file = new URL(`rules/${name}.md`, docsRoot);
    expect(existsSync(file), file.pathname).toBe(true);
    const text = readFileSync(file, 'utf8');
    expect(text.startsWith(`# hydration-proof/${name}\n`)).toBe(true);
    for (const heading of ['## Why', '## Incorrect', '## Correct', '## Options', '## When not to use it']) {
      expect(text, heading).toContain(heading);
    }
    const options = (meta.schema as { properties?: Record<string, unknown> }[])[0]?.properties ?? {};
    for (const option of Object.keys(options)) expect(text, option).toContain(`\`${option}\``);
    if (meta.hasSuggestions) expect(text).toMatch(/suggestion/i);
  });

  it('is listed in the plugin guide', () => {
    const guide = readFileSync(new URL('eslint.md', docsRoot), 'utf8');
    expect(guide).toContain(`[\`${name}\`](rules/${name}.md)`);
  });

  it('validates its options', () => {
    const linter = new Linter();
    const config = (options: unknown[]): Linter.Config[] => [
      { plugins: { 'hydration-proof': plugin }, rules: { [`hydration-proof/${name}`]: ['error', ...options] } as Linter.RulesRecord },
    ];
    expect(() => linter.verify('', config([{ notAnOption: true }]))).toThrow(/invalid|should NOT have|must NOT have|Unexpected/i);
    expect(() => linter.verify('', config([]))).not.toThrow();
  });
});

describe('presets', () => {
  const prefixed = (preset: Linter.Config): [string, unknown][] => Object.entries(preset.rules ?? {});

  it.each(['recommended', 'next', 'strict'] as const)('%s only references rules of this plugin', (name) => {
    const preset = configs[name];
    expect(preset.name).toBe(`hydration-proof/${name}`);
    expect(preset.plugins?.['hydration-proof']).toBe(plugin);
    expect(preset.files).toEqual(['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}']);
    const entries = prefixed(preset);
    expect(entries).toHaveLength(RULE_NAMES.length);
    for (const [key] of entries) {
      expect(key.startsWith('hydration-proof/')).toBe(true);
      expect(RULE_NAMES).toContain(key.slice('hydration-proof/'.length));
    }
  });

  it('recommended uses errors for definite mismatches and warnings for likely ones', () => {
    for (const [key, entry] of prefixed(configs.recommended)) {
      const name = key.slice('hydration-proof/'.length);
      expect(entry, name).toBe(WARN_IN_RECOMMENDED.has(name) ? 'warn' : 'error');
    }
    expect(configs.recommended.settings).toBeUndefined();
  });

  it('next is recommended with App Router Server Components', () => {
    expect(configs.next.rules).toEqual(configs.recommended.rules);
    expect(configs.next.settings).toEqual({ 'hydration-proof': { serverComponents: 'next-app' } });
  });

  it('strict makes every rule an error and audits every suppressHydrationWarning', () => {
    for (const [key, entry] of prefixed(configs.strict)) {
      if (key === 'hydration-proof/audit-suppress-hydration-warning') expect(entry).toEqual(['error', { reportAll: true }]);
      else expect(entry, key).toBe('error');
    }
  });

  it('can be used as flat config on its own, including .jsx files', () => {
    const linter = new Linter();
    for (const preset of Object.values(configs)) {
      for (const filename of ['src/a.js', 'src/a.jsx']) {
        expect(linter.verify('export const A = () => <p>{Date.now()}</p>', [preset], filename).map((message) => message.ruleId)).toEqual([
          'hydration-proof/no-date-in-render',
        ]);
      }
    }
  });
});
