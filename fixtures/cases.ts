// Ground truth for every fixture page: how to load it and what a correct run
// of hydration-proof must report. Shared by scripts/verify-fixtures.ts,
// scripts/measure.ts and the e2e suite.

export type FixtureApp = 'next-app' | 'next-pages';

export interface CaseContext {
  locale?: string;
  timezoneId?: string;
  colorScheme?: 'light' | 'dark';
  viewport?: { width: number; height: number };
}

export interface Expectation {
  /** At least one reported (non-ignored) issue must have one of these codes. */
  anyOfCodes: string[];
  /** ...and, when set, point at an element matching this CSS id selector. */
  selector?: string;
  /** Expected cause id (from 0.2). */
  cause?: string;
}

export interface FixtureCase {
  app: FixtureApp;
  route: string;
  kind: 'broken' | 'control';
  via?: 'direct' | 'cdn-proxy';
  context?: CaseContext;
  /** localStorage entries set before the page loads. */
  storage?: Record<string, string>;
  /** Extra init scripts (simulated extensions). */
  initScripts?: string[];
  /** Broken cases: what must be found. Controls: nothing above `info`. */
  expect?: Expectation;
  /** Only meaningful for one router. */
  only?: FixtureApp;
}

/** Environment every fixture server runs with. */
export const SERVER_ENV: Record<string, string> = {
  TZ: 'UTC',
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
  NEXT_TELEMETRY_DISABLED: '1',
};

/** Browser context that matches SERVER_ENV, used unless a case overrides it. */
export const DEFAULT_CONTEXT: Required<Pick<CaseContext, 'locale' | 'timezoneId' | 'colorScheme'>> = {
  locale: 'en-US',
  timezoneId: 'UTC',
  colorScheme: 'light',
};

export const PORTS: Record<FixtureApp, { prod: number; dev: number; proxy: number }> = {
  'next-app': { prod: 3100, dev: 3110, proxy: 3101 },
  'next-pages': { prod: 3200, dev: 3210, proxy: 3201 },
};

// Simulates a translation / grammar extension editing the page before React hydrates.
const EXTENSION_SCRIPT = `document.addEventListener('DOMContentLoaded', () => {
  const target = document.getElementById('browser-mutation');
  if (target && target.firstChild) target.firstChild.data = 'Hola mundo';
  document.body.setAttribute('data-new-gr-c-s-check-loaded', '14.1250.0');
  document.body.appendChild(document.createElement('grammarly-desktop-integration'));
});`;

const TEXT = ['HP1001'];

function broken(route: string, expect: Expectation, extra: Partial<FixtureCase> = {}): Omit<FixtureCase, 'app'> {
  return { route, kind: 'broken', expect, ...extra };
}

function control(route: string, extra: Partial<FixtureCase> = {}): Omit<FixtureCase, 'app'> {
  return { route, kind: 'control', ...extra };
}

const shared: Omit<FixtureCase, 'app'>[] = [
  broken('/date-now', { anyOfCodes: TEXT, selector: '#date-now' }),
  broken('/math-random', { anyOfCodes: TEXT, selector: '#math-random' }),
  broken('/locale', { anyOfCodes: TEXT, selector: '#locale' }, { context: { locale: 'de-DE' } }),
  broken('/timezone', { anyOfCodes: TEXT, selector: '#timezone' }, { context: { timezoneId: 'Asia/Karachi' } }),
  broken('/local-storage', { anyOfCodes: TEXT, selector: '#local-storage' }, { storage: { name: 'Sohail' } }),
  broken('/match-media', { anyOfCodes: TEXT, selector: '#match-media' }, { context: { viewport: { width: 390, height: 844 } } }),
  broken('/invalid-nesting', { anyOfCodes: ['HP3001'], selector: '#invalid-nesting' }),
  broken('/dark-mode', { anyOfCodes: ['HP1004'], selector: '#dark-mode' }, { context: { colorScheme: 'dark' } }),
  broken('/css-in-js', { anyOfCodes: ['HP1004'], selector: '#css-in-js' }),
  broken('/browser-mutation', { anyOfCodes: ['HP4001'], selector: '#browser-mutation' }, { initScripts: [EXTENSION_SCRIPT] }),
  broken('/cdn-whitespace', { anyOfCodes: ['HP1001', 'HP1015', 'HP4003'], selector: '#cdn-whitespace' }, { via: 'cdn-proxy' }),
  broken('/api-data', { anyOfCodes: TEXT, selector: '#api-data' }),
  control('/mounted'),
  control('/suppress'),
  control('/use-id'),
  control('/static'),
  control('/layout-effect'),
  control('/theme-script'),
  control('/cdn-whitespace'),
  control('/streaming', { only: 'next-app' }),
];

export const CASES: FixtureCase[] = (['next-app', 'next-pages'] as const).flatMap((app) =>
  shared.filter((entry) => entry.only === undefined || entry.only === app).map((entry) => ({ app, ...entry })),
);

export function caseId(entry: FixtureCase): string {
  return `${entry.app}${entry.route}${entry.via === 'cdn-proxy' ? ' (via CDN)' : ''}${entry.kind === 'control' ? ' [control]' : ''}`;
}
