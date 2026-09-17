import { existsSync, readFileSync } from 'node:fs';
import { Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

// Checks the built package the way users receive it. Skipped until `pnpm build` has run.
const dist = new URL('../dist/', import.meta.url);
const built = existsSync(new URL('index.js', dist)) && existsSync(new URL('index.d.ts', dist));

describe.skipIf(!built)('the built package', () => {
  it('works as a flat config plugin', async () => {
    const { default: plugin } = (await import(new URL('index.js', dist).href)) as { default: { meta: { version: string }; configs: Record<string, Linter.Config>; rules: object } };
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(plugin.meta.version).toBe(pkg.version);
    expect(Object.keys(plugin.rules)).toHaveLength(15);
    const messages = new Linter().verify('export const A = () => <p>{Math.random()}</p>', [plugin.configs.recommended!], 'a.js');
    expect(messages.map((message) => message.ruleId)).toEqual(['hydration-proof/no-random-in-render']);
  });

  it('imports nothing at run time and inlines only the version from package.json', () => {
    const source = readFileSync(new URL('index.js', dist), 'utf8');
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(/);
    expect(source).not.toContain('devDependencies');
  });

  it('ships types that only import eslint', () => {
    const types = readFileSync(new URL('index.d.ts', dist), 'utf8');
    const imports = [...types.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]);
    expect([...new Set(imports)]).toEqual(['eslint']);
    for (const name of ['HydrationProofPlugin', 'HydrationProofConfigs', 'RuleName', 'HydrationProofSettings']) expect(types).toContain(name);
  });
});
