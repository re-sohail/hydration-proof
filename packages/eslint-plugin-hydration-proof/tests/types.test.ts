// Compile-time checks of the public types (run by `pnpm typecheck`), plus a
// runtime smoke test so vitest has something to execute.
import type { ESLint, Linter } from 'eslint';
import { defineConfig } from 'eslint/config';
import { expect, it } from 'vitest';
import hydrationProof from '../src/index.ts';
import type { HydrationProofPlugin, HydrationProofSettings, NoLocaleWithoutExplicitLocaleOptions, RuleName } from '../src/index.ts';

const plugin: ESLint.Plugin = hydrationProof;
const flat: Linter.Config[] = [hydrationProof.configs.recommended, hydrationProof.configs.next, hydrationProof.configs.strict];
const settings: HydrationProofSettings = { serverComponents: 'next-app' };
const localeOptions: NoLocaleWithoutExplicitLocaleOptions = { defaultLocale: 'en-GB' };
const ruleName: RuleName = 'no-date-in-render';

const config = defineConfig([
  hydrationProof.configs.recommended,
  {
    files: ['**/*.{jsx,tsx}'],
    plugins: { 'hydration-proof': hydrationProof },
    settings: { 'hydration-proof': settings },
    rules: {
      [`hydration-proof/${ruleName}`]: 'error',
      'hydration-proof/no-locale-without-explicit-locale': ['warn', localeOptions],
    },
  },
]);

// @ts-expect-error: presets are named.
void hydrationProof.configs.missing;

it('exposes typed presets and rules', () => {
  const typed: HydrationProofPlugin = hydrationProof;
  expect(typed.meta.name).toBe('eslint-plugin-hydration-proof');
  expect(plugin.rules?.[ruleName]).toBeDefined();
  expect(flat).toHaveLength(3);
  expect(config).toHaveLength(2);
});
