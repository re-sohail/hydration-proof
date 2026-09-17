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
  /** Acceptable cause ids. */
  cause?: string[];
  /**
   * Development mode: the reported source file must end with `file`, and the
   * reported line must contain `contains`.
   */
  source?: { file: string; contains: string };
  /**
   * The cause cannot be read off the values, only out of the code (a
   * `typeof window` branch, an API call). It is then required only when the
   * file named by `source` was actually resolved.
   */
  causeNeedsSource?: true;
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
  /**
   * A real mismatch that React itself never reports, so `verify-fixtures`
   * requires silence from React instead of a warning. These are the cases the
   * props audit exists for: `true`, or the apps where React stays quiet.
   */
  reactSilent?: boolean | FixtureApp[];
}

/** Whether React is expected to say nothing about this case in development. */
export function reactStaysQuiet(entry: FixtureCase): boolean {
  const silent = entry.reactSilent;
  if (silent === undefined || silent === false) return entry.kind === 'control';
  return silent === true || silent.includes(entry.app);
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

// Simulates a translation / grammar extension editing the page before React
// hydrates. Like real extensions it acts as soon as its target is parsed.
const EXTENSION_SCRIPT = `(() => {
  const apply = () => {
    const target = document.getElementById('browser-mutation');
    if (!target || !target.firstChild || !document.body) return false;
    target.firstChild.data = 'Hola mundo';
    document.body.setAttribute('data-new-gr-c-s-check-loaded', '14.1250.0');
    document.body.appendChild(document.createElement('grammarly-desktop-integration'));
    return true;
  };
  const observer = new MutationObserver(() => {
    if (apply()) observer.disconnect();
  });
  observer.observe(document, { childList: true, subtree: true });
})();`;

const TEXT = ['HP1001'];
/** The props audit: an attribute value that differs on both sides. */
const ATTR = ['HP1002'];
/** A form control's value, checked or selected state. */
const FORM = ['HP1012'];
const FILE = 'next-cases/src/broken.jsx';
const at = (id: string, tag = 'p'): Expectation['source'] => ({ file: FILE, contains: `<${tag} id="${id}"` });

function broken(route: string, expect: Expectation, extra: Partial<FixtureCase> = {}): Omit<FixtureCase, 'app'> {
  return { route, kind: 'broken', expect, ...extra };
}

function control(route: string, extra: Partial<FixtureCase> = {}): Omit<FixtureCase, 'app'> {
  return { route, kind: 'control', ...extra };
}

const shared: Omit<FixtureCase, 'app'>[] = [
  broken('/date-now', { anyOfCodes: TEXT, selector: '#date-now', cause: ['time'], source: at('date-now') }),
  broken('/math-random', { anyOfCodes: TEXT, selector: '#math-random', cause: ['random'], source: at('math-random') }),
  broken('/locale', { anyOfCodes: TEXT, selector: '#locale', cause: ['locale'], source: at('locale') }, { context: { locale: 'de-DE' } }),
  broken('/timezone', { anyOfCodes: TEXT, selector: '#timezone', cause: ['timezone'], source: at('timezone') }, { context: { timezoneId: 'Asia/Karachi' } }),
  broken('/local-storage', { anyOfCodes: TEXT, selector: '#local-storage', cause: ['storage'], source: at('local-storage') }, { storage: { name: 'Sohail' } }),
  broken('/match-media', { anyOfCodes: TEXT, selector: '#match-media', cause: ['media-query'], source: at('match-media') }, { context: { viewport: { width: 390, height: 844 } } }),
  broken('/invalid-nesting', { anyOfCodes: ['HP3001'], selector: '#invalid-nesting', cause: ['invalid-html'], source: at('invalid-nesting') }),
  broken('/dark-mode', { anyOfCodes: ['HP1004'], selector: '#dark-mode', cause: ['theme'], source: at('dark-mode', 'div') }, { context: { colorScheme: 'dark' } }),
  broken('/css-in-js', { anyOfCodes: ['HP1004'], selector: '#css-in-js', cause: ['css-in-js'], source: at('css-in-js', 'Title') }),
  broken(
    '/browser-mutation',
    { anyOfCodes: ['HP4001'], selector: '#browser-mutation', cause: ['third-party-script', 'extension'], source: at('browser-mutation') },
    { initScripts: [EXTENSION_SCRIPT] },
  ),
  broken(
    '/cdn-whitespace',
    { anyOfCodes: ['HP1001', 'HP1015', 'HP4003'], selector: '#cdn-whitespace', cause: ['cdn'], source: at('cdn-whitespace') },
    { via: 'cdn-proxy' },
  ),
  broken('/api-data', { anyOfCodes: TEXT, selector: '#api-data', cause: ['data'], source: at('api-data') }),
  control('/mounted'),
  control('/suppress'),
  control('/use-id'),
  control('/static'),
  control('/layout-effect'),
  control('/theme-script'),
  control('/cdn-whitespace'),
  control('/streaming', { only: 'next-app' }),

  // Attributes, properties and inner HTML: the text matches on both sides, so
  // React 19 reports none of these in production and patches none of them.
  broken('/attr-mismatch', { anyOfCodes: ATTR, selector: '#attr-mismatch', cause: ['browser-api'], source: at('attr-mismatch', 'a'), causeNeedsSource: true }),
  broken('/style-mismatch', { anyOfCodes: ['HP1003'], selector: '#style-mismatch', cause: ['browser-api'], source: at('style-mismatch', 'div'), causeNeedsSource: true }),
  broken(
    '/svg-attr',
    { anyOfCodes: ATTR, selector: '#svg-attr-dot', cause: ['theme'], source: at('svg-attr-dot', 'circle'), causeNeedsSource: true },
    { context: { colorScheme: 'dark' } },
  ),
  // Measured: React 18 and 19 report nothing at all for a form control's value
  // or selected state, not even in development. These two are the clearest
  // evidence that the props audit finds what React does not.
  broken(
    '/textarea-value',
    { anyOfCodes: [...FORM, ...TEXT], selector: '#textarea-value', cause: ['browser-api'], source: at('textarea-value', 'textarea'), causeNeedsSource: true },
    { reactSilent: true },
  ),
  broken(
    '/select-option',
    { anyOfCodes: [...FORM, ...ATTR], selector: '#select-option', cause: ['browser-api'], source: at('select-option', 'select'), causeNeedsSource: true },
    { reactSilent: true },
  ),
  broken('/dangerous-html', { anyOfCodes: ['HP1013', ...TEXT], selector: '#dangerous-html', cause: ['browser-api'], source: at('dangerous-html', 'div'), causeNeedsSource: true }),

  // More ways to produce a different value in render.
  broken('/random-uuid', { anyOfCodes: TEXT, selector: '#random-uuid', cause: ['random'], source: at('random-uuid'), causeNeedsSource: true }),
  broken('/user-agent', { anyOfCodes: TEXT, selector: '#user-agent', cause: ['browser-api'], source: at('user-agent'), causeNeedsSource: true }),

  // The right way to do what the pages above get wrong.
  control('/sync-external-store'),
  control('/portal'),
  control('/suppress-attr'),
  control('/random-in-effect'),
];

export const CASES: FixtureCase[] = (['next-app', 'next-pages'] as const).flatMap((app) =>
  shared.filter((entry) => entry.only === undefined || entry.only === app).map((entry) => ({ app, ...entry })),
);

export function caseId(entry: FixtureCase): string {
  return `${entry.app}${entry.route}${entry.via === 'cdn-proxy' ? ' (via CDN)' : ''}${entry.kind === 'control' ? ' [control]' : ''}`;
}
