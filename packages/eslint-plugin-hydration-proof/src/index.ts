// eslint-plugin-hydration-proof: ESLint rules that catch React hydration
// mismatches before they ship.
import type { Linter, Rule } from 'eslint';
import packageJson from '../package.json' with { type: 'json' };
import type { RuleName } from './rules/index.ts';
import { rules } from './rules/index.ts';

export type { RuleName } from './rules/index.ts';
export type { HydrationProofSettings, ServerComponentsMode } from './utils/files.ts';
export type { AuditSuppressHydrationWarningOptions } from './rules/audit-suppress-hydration-warning.ts';
export type { NoGlobalRenderCounterOptions } from './rules/no-global-render-counter.ts';
export type { NoLocaleWithoutExplicitLocaleOptions } from './rules/no-locale-without-explicit-locale.ts';
export type { NoTimezoneWithoutExplicitTimezoneOptions } from './rules/no-timezone-without-explicit-timezone.ts';
export type { RequireDeterministicListOrderOptions } from './rules/require-deterministic-list-order.ts';

export type PresetName = 'recommended' | 'next' | 'strict';

export type HydrationProofConfigs = {
  /** Every rule: definite mismatches as errors, likely ones as warnings. */
  recommended: Linter.Config;
  /** `recommended` plus App Router Server Component detection. */
  next: Linter.Config;
  /** Every rule as an error, and every `suppressHydrationWarning` must be justified. */
  strict: Linter.Config;
};

export type HydrationProofPlugin = {
  meta: { name: string; version: string; namespace: string };
  rules: Record<RuleName, Rule.RuleModule>;
  configs: HydrationProofConfigs;
};

const NAMESPACE = 'hydration-proof';

/** Severity of every rule in the recommended preset. */
const RECOMMENDED: Record<RuleName, 'error' | 'warn'> = {
  'no-date-in-render': 'error',
  'no-random-in-render': 'error',
  'no-browser-global-in-render': 'error',
  'no-storage-in-initial-render': 'error',
  'no-match-media-in-render': 'error',
  'no-locale-without-explicit-locale': 'warn',
  'no-timezone-without-explicit-timezone': 'warn',
  'no-unstable-id': 'error',
  'no-global-render-counter': 'error',
  'no-window-render-branch': 'error',
  'no-invalid-interactive-nesting': 'error',
  'audit-suppress-hydration-warning': 'error',
  'no-client-only-initial-state': 'warn',
  'require-stable-server-snapshot': 'error',
  'require-deterministic-list-order': 'warn',
};

function prefixed(entries: Record<string, Linter.RuleEntry>): Linter.RulesRecord {
  return Object.fromEntries(Object.entries(entries).map(([name, entry]) => [`${NAMESPACE}/${name}`, entry]));
}

const plugin: HydrationProofPlugin = {
  meta: { name: 'eslint-plugin-hydration-proof', version: packageJson.version, namespace: NAMESPACE },
  rules,
  configs: {} as HydrationProofConfigs,
};

/** JavaScript and TypeScript sources. Without this, ESLint would only lint .js/.mjs/.cjs files. */
const FILES = ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'];
// Presets enable JSX parsing for .js files; TypeScript parsers ignore this for .ts/.tsx.
const languageOptions: Linter.Config['languageOptions'] = { parserOptions: { ecmaFeatures: { jsx: true } } };

plugin.configs.recommended = {
  name: `${NAMESPACE}/recommended`,
  files: FILES,
  plugins: { [NAMESPACE]: plugin },
  languageOptions,
  rules: prefixed(RECOMMENDED),
};

plugin.configs.next = {
  name: `${NAMESPACE}/next`,
  files: FILES,
  plugins: { [NAMESPACE]: plugin },
  languageOptions,
  settings: { [NAMESPACE]: { serverComponents: 'next-app' } },
  rules: prefixed(RECOMMENDED),
};

plugin.configs.strict = {
  name: `${NAMESPACE}/strict`,
  files: FILES,
  plugins: { [NAMESPACE]: plugin },
  languageOptions,
  rules: prefixed({
    ...Object.fromEntries(Object.keys(rules).map((name) => [name, 'error'])),
    'audit-suppress-hydration-warning': ['error', { reportAll: true }],
  }),
};

export const configs: HydrationProofConfigs = plugin.configs;
export { rules };
export default plugin;
