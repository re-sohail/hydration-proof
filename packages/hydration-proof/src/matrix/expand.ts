import type { BrowserName, CacheState, MatrixConfig, NetworkProfile, ScenarioConfig, ScenarioVariant, ViewportOption } from '../config/types.ts';
import { fullCombinations, pairwiseCombinations, sampleCombinations, type Assignment } from './pairwise.ts';

// Expands scenarios into environment combinations (the matrix) and records
// what each combination is, for reports and "only in ..." classification.

export const DEFAULT_MATRIX_MAX = 16;

/** Axis name → value label of one tested environment. */
export type EnvironmentLabels = Record<string, string>;

export interface ExpandedScenario {
  config: ScenarioConfig;
  /** The scenario the environment was derived from. */
  base: string;
  /** Values of the axes the matrix varies (empty for a scenario without a matrix). */
  environment: EnvironmentLabels;
}

export interface MatrixDefaults {
  browser: BrowserName;
}

interface AxisValue {
  label: string;
  apply(scenario: ScenarioConfig): ScenarioConfig;
  /** Effective values used by the compatibility rules. */
  browser?: BrowserName;
  cpu?: number;
  network?: NetworkProfile;
  cache?: CacheState;
  viewport?: ViewportOption;
}

interface Axis {
  name: string;
  values: AxisValue[];
  /** A user-defined axis (labelled `name=value`). */
  custom?: boolean;
}

export function networkLabel(profile: NetworkProfile): string {
  if (typeof profile === 'string') return profile;
  return profile.name ?? `${profile.downloadKbps}kbps/${profile.latencyMs}ms`;
}

export function viewportLabel(viewport: ViewportOption): string {
  return typeof viewport === 'string' ? viewport : `${viewport.width}x${viewport.height}`;
}

function mergeVariant(scenario: ScenarioConfig, variant: ScenarioVariant): ScenarioConfig {
  const out: ScenarioConfig = { ...scenario };
  if (variant.cookies) out.cookies = [...(scenario.cookies ?? []), ...variant.cookies];
  if (variant.headers) out.headers = { ...scenario.headers, ...variant.headers };
  if (variant.localStorage) out.localStorage = { ...scenario.localStorage, ...variant.localStorage };
  if (variant.sessionStorage) out.sessionStorage = { ...scenario.sessionStorage, ...variant.sessionStorage };
  if (variant.initScripts) out.initScripts = [...(scenario.initScripts ?? []), ...variant.initScripts];
  if (variant.query) out.query = { ...scenario.query, ...variant.query };
  return out;
}

function axesOf(matrix: MatrixConfig): Axis[] {
  const axes: Axis[] = [];
  const add = <T>(
    name: string,
    values: readonly T[] | undefined,
    label: (value: T) => string,
    apply: (scenario: ScenarioConfig, value: T) => ScenarioConfig,
    extra: (value: T) => Partial<AxisValue> = () => ({}),
    custom = false,
  ): void => {
    if (!values || values.length === 0) return;
    const seen = new Set<string>();
    const list: AxisValue[] = [];
    for (const value of values) {
      const text = label(value);
      if (seen.has(text)) continue;
      seen.add(text);
      list.push({ label: text, apply: (scenario) => apply(scenario, value), ...extra(value) });
    }
    axes.push(custom ? { name, values: list, custom } : { name, values: list });
  };
  add('locale', matrix.locale, String, (scenario, locale) => ({ ...scenario, locale }));
  add('timezone', matrix.timezoneId, String, (scenario, timezoneId) => ({ ...scenario, timezoneId }));
  add('colorScheme', matrix.colorScheme, String, (scenario, colorScheme) => ({ ...scenario, colorScheme }));
  add('reducedMotion', matrix.reducedMotion, String, (scenario, reducedMotion) => ({ ...scenario, reducedMotion }));
  add('viewport', matrix.viewport, viewportLabel, (scenario, viewport) => ({ ...scenario, viewport }), (viewport) => ({ viewport }));
  add('browser', matrix.browser, String, (scenario, browser) => ({ ...scenario, browser }), (browser) => ({ browser }));
  add('network', matrix.network, networkLabel, (scenario, network) => ({ ...scenario, network }), (network) => ({ network }));
  add('cpu', matrix.cpu, (cpu) => `${cpu}x`, (scenario, cpu) => ({ ...scenario, cpu }), (cpu) => ({ cpu }));
  add('cache', matrix.cache, String, (scenario, cache) => ({ ...scenario, cache }), (cache) => ({ cache }));
  for (const [name, variants] of Object.entries(matrix.axes ?? {})) {
    add(name, Object.entries(variants), ([value]) => value, (scenario, [, variant]) => mergeVariant(scenario, variant), () => ({}), true);
  }
  return axes;
}

/** Settings the compatibility rules look at; `undefined` = not decided yet. */
interface Effective {
  browser: BrowserName | undefined;
  cpu: number | undefined;
  network: NetworkProfile | undefined;
  cache: CacheState | undefined;
}

/** Combinations the browsers cannot run. Returns a reason, or undefined when fine (or not decided yet). */
export function incompatibility(effective: Effective): string | undefined {
  const { browser, cpu, network, cache } = effective;
  if (cpu !== undefined && cpu > 1 && browser !== undefined && browser !== 'chromium') return 'CPU slowdown needs Chromium';
  if (cache === 'warm' && network !== undefined && network !== 'fast' && browser !== undefined && browser !== 'chromium') {
    return 'network throttling in Firefox and WebKit turns the HTTP cache off, so a warm cache cannot be tested there';
  }
  return undefined;
}

const FIELDS = ['browser', 'cpu', 'network', 'cache'] as const;

function effectiveOf(scenario: ScenarioConfig, axes: readonly Axis[], assignment: Assignment, defaults: MatrixDefaults): Effective {
  const out: Effective = {
    browser: scenario.browser ?? defaults.browser,
    cpu: scenario.cpu ?? 1,
    network: scenario.network ?? 'fast',
    cache: scenario.cache ?? 'cold',
  };
  axes.forEach((axis, index) => {
    const chosen = assignment[index];
    for (const field of FIELDS) {
      if (axis.values[0]?.[field] === undefined) continue;
      // An axis that decides this field but has no value yet: unknown.
      (out as unknown as Record<string, unknown>)[field] = chosen === undefined ? undefined : axis.values[chosen]![field];
    }
  });
  return out;
}

/** Expand the scenarios the matrix applies to. `notes` receives explanations of what was limited. */
export function expandMatrix(
  scenarios: readonly ScenarioConfig[],
  matrix: MatrixConfig | undefined,
  defaults: MatrixDefaults,
  notes: string[] = [],
): ExpandedScenario[] {
  const plain = (scenario: ScenarioConfig): ExpandedScenario => ({ config: scenario, base: scenario.name, environment: {} });
  const axes = matrix ? axesOf(matrix) : [];
  if (!matrix || axes.length === 0) return scenarios.map(plain);

  const strategy = matrix.strategy ?? 'pairwise';
  const max = matrix.max ?? DEFAULT_MATRIX_MAX;
  const sizes = axes.map((axis) => axis.values.length);
  const varied = axes.filter((axis) => axis.values.length > 1);
  const out: ExpandedScenario[] = [];
  const reasons = new Set<string>();

  for (const scenario of scenarios) {
    if (matrix.scenarios && !matrix.scenarios.includes(scenario.name)) {
      out.push(plain(scenario));
      continue;
    }
    const valid = (assignment: Assignment): boolean => {
      const reason = incompatibility(effectiveOf(scenario, axes, assignment, defaults));
      if (reason !== undefined) reasons.add(reason);
      return reason === undefined;
    };
    let combos: number[][];
    if (strategy === 'full') {
      combos = fullCombinations(sizes, valid, max + 1);
      if (combos.length > max) {
        notes.push(`The full matrix of "${scenario.name}" has more than ${max} environments; testing pairwise combinations instead (raise matrix.max to test all).`);
        combos = pairwiseCombinations(sizes, valid);
      }
    } else if (strategy === 'sample') {
      combos = sampleCombinations(sizes, max, matrix.seed ?? 1, valid);
    } else {
      combos = pairwiseCombinations(sizes, valid);
    }
    if (combos.length > max) {
      notes.push(`"${scenario.name}" needs ${combos.length} environments to cover every pair of values; testing the first ${max} (raise matrix.max for full pair coverage).`);
      combos = combos.slice(0, max);
    }
    if (combos.length === 0) {
      notes.push(`No environment of the matrix can run for "${scenario.name}".`);
      continue;
    }

    if ((scenario.mocks?.length ?? 0) > 0 && axes.some((axis) => axis.values.some((value) => value.cache === 'warm'))) {
      reasons.add(`mocks turn the HTTP cache off, so a warm cache in "${scenario.name}" only repeats the visit`);
    }

    for (const combo of combos) {
      let config: ScenarioConfig = { ...scenario };
      const environment: EnvironmentLabels = {};
      const labels: string[] = [];
      combo.forEach((index, axis) => {
        const value = axes[axis]!.values[index]!;
        config = value.apply(config);
        environment[axes[axis]!.name] = value.label;
        if (varied.includes(axes[axis]!)) labels.push(axes[axis]!.custom ? `${axes[axis]!.name}=${value.label}` : value.label);
      });
      config.name = labels.length > 0 ? `${scenario.name} (${labels.join(', ')})` : scenario.name;
      out.push({ config, base: scenario.name, environment });
    }
  }
  for (const reason of reasons) notes.push(`Matrix limited: ${reason}.`);
  return out;
}
