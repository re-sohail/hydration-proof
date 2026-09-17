import { RuleTester } from 'eslint';
import * as tsParser from '@typescript-eslint/parser';
import { describe, it } from 'vitest';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

/** JavaScript with JSX, parsed by ESLint's default parser (espree). */
export const jsxTester: RuleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

/** TypeScript with JSX, parsed by @typescript-eslint/parser. */
export const tsxTester: RuleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

export const nextAppSettings = { 'hydration-proof': { serverComponents: 'next-app' } } as const;

/** A test case in a `.tsx` file. */
export function tsx<T extends { code: string }>(test: T): T & { filename: string } {
  return { filename: 'src/components/Example.tsx', ...test };
}

/** A test case for an App Router file with `serverComponents: 'next-app'`. */
export function nextApp<T extends { code: string }>(filename: string, test: T): T & { filename: string; settings: typeof nextAppSettings } {
  return { ...test, filename, settings: nextAppSettings };
}
