import type { Cause, Evidence, Issue } from '../report/model.ts';

// Cause diagnosis: combines the shape of the differing values, the source
// code around the element, the scenario and the stage the difference came
// from into one likely cause with a confidence score.

export type CauseId =
  | 'time'
  | 'timezone'
  | 'locale'
  | 'random'
  | 'browser-api'
  | 'storage'
  | 'media-query'
  | 'theme'
  | 'data'
  | 'invalid-html'
  | 'css-in-js'
  | 'extension'
  | 'third-party-script'
  | 'cdn'
  | 'unstable-id'
  | 'suppressed';

interface CauseInfo {
  title: string;
  fixes: string[];
}

export const CAUSES: Record<CauseId, CauseInfo> = {
  time: {
    title: 'Time-dependent value',
    fixes: [
      'The server and the browser render at different moments. Pass the timestamp the server used as a prop, or render the time after mount (useEffect).',
    ],
  },
  timezone: {
    title: 'Timezone difference',
    fixes: [
      'The server and the browser format dates in different timezones. Pass an explicit timeZone to the formatter (the same on both sides), or format the date after mount.',
    ],
  },
  locale: {
    title: 'Locale-dependent formatting',
    fixes: [
      'toLocaleString / Intl formatters use the server locale on the server and the browser locale on the client. Pass an explicit locale (for example from the URL or a cookie) on both sides.',
    ],
  },
  random: {
    title: 'Random value',
    fixes: [
      'Random values differ on every render. Generate them once on the server and pass them down, or use useId for element ids.',
    ],
  },
  'browser-api': {
    title: 'Browser-only API used during render',
    fixes: [
      'Code like `typeof window !== "undefined"` or window/navigator/document access renders differently on the server. Read browser values in useEffect, or render the component on the client only.',
    ],
  },
  storage: {
    title: 'localStorage / sessionStorage read during render',
    fixes: ['Storage is only available in the browser. Render a neutral value first and read storage in useEffect.'],
  },
  'media-query': {
    title: 'Screen size or media query read during render',
    fixes: ['Use CSS media queries for layout differences, or read matchMedia / window size after mount.'],
  },
  theme: {
    title: 'Theme preference (dark/light mode)',
    fixes: [
      'The server cannot know the color scheme. Store the theme in a cookie and read it on the server, or set the class with an inline script before hydration and mark that element with suppressHydrationWarning.',
    ],
  },
  data: {
    title: 'Server and client used different data',
    fixes: [
      'The client fetched data again and got a different result. Send the data the server rendered with to the client (props, the framework data APIs, or a serialized cache) instead of refetching during hydration.',
    ],
  },
  'invalid-html': {
    title: 'Invalid HTML nesting',
    fixes: ['Fix the nesting so the browser does not rewrite it, for example use <span> instead of <div> inside <p>.'],
  },
  'css-in-js': {
    title: 'CSS-in-JS class names differ',
    fixes: [
      'Enable the library\'s server rendering support (for styled-components: `compiler.styledComponents` in next.config and a style registry) and never create styled components conditionally.',
    ],
  },
  extension: {
    title: 'Browser extension',
    fixes: ['A browser extension changed the page. Nothing to fix in your code; ignore these attributes or test in a clean profile.'],
  },
  'third-party-script': {
    title: 'A script changed the page before hydration',
    fixes: [
      'Load the script after hydration (for example next/script with strategy="afterInteractive" or "lazyOnload"), or make it change only elements outside React\'s tree.',
    ],
  },
  cdn: {
    title: 'HTML rewritten by a CDN or proxy',
    fixes: ['Turn off HTML minification or rewriting (e.g. Cloudflare Auto Minify, email obfuscation) for server-rendered pages.'],
  },
  'unstable-id': {
    title: 'Generated id differs',
    fixes: ['Use React\'s useId instead of counters or random ids, and use the same identifierPrefix on server and client.'],
  },
  suppressed: {
    title: 'Intentional difference (suppressHydrationWarning)',
    fixes: ['Keep suppressHydrationWarning on the smallest element that needs it.'],
  },
};

export const CAUSE_DOCS_BASE = 'https://hydration.jscrate.dev/docs/causes/';

export interface DiagnosisContext {
  /** Browser settings of the scenario. */
  scenario: { locale?: string; timezoneId?: string; colorScheme?: string; hasStorage?: boolean; mobile?: boolean };
  /** Locale and timezone the server most likely rendered with. */
  server: { locale?: string; timezoneId?: string };
  /** Lower-case document response headers. */
  headers?: Record<string, string>;
  /**
   * Original source text and the 1-based line the element was created on
   * (`scope: 'component'`: the line declares the component that rendered it).
   */
  source?: { content: string; line: number; file: string; scope?: 'element' | 'component' };
}

interface Candidate {
  id: CauseId;
  score: number;
  reason: string;
}

const EPOCH_MS = /\b1[5-9]\d{11}\b/;
const TIME_OF_DAY = /\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AaPp]\.?[Mm]\.?)?\b/;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?/;
const MONTH = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/i;
const DECIMAL_RANDOM = /\b0\.\d{4,}\b/;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const USE_ID = /(?::[rR][0-9a-zA-Z]*:|«[rR][0-9a-zA-Z]*»|_[rR]_[0-9a-zA-Z]*_)/;
const CSS_IN_JS_TOKEN = /^(?:sc-[A-Za-z0-9]+|css-[a-z0-9]+|emotion-\d+|jsx-\d+|makeStyles-.+-\d+|Mui[A-Za-z]+-root-\d+|[A-Za-z]{5,7})$/;
const THEME_TOKEN = /(?:^|[-_])(?:dark|light|night|day)(?:$|[-_])|theme/i;
const EXTENSION_ATTRIBUTE = /grammarly|gr-c-s|gr-ext|lastpass|dashlane|bitwarden|1password|darkreader|translate|cz-shortcut|bis_/i;
const CDN_HEADERS = ['cf-ray', 'x-amz-cf-id', 'x-served-by', 'x-cache', 'via', 'x-cdn', 'x-fastly-request-id', 'x-akamai-transformed', 'x-cdn-proxy'];

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '');
}

function tokens(value: string | null | undefined): Set<string> {
  return new Set((value ?? '').split(/\s+/).filter(Boolean));
}

function differingTokens(a: string | null | undefined, b: string | null | undefined): string[] {
  const left = tokens(a);
  const right = tokens(b);
  return [...left].filter((token) => !right.has(token)).concat([...right].filter((token) => !left.has(token)));
}

function localeLikeNumbers(server: string, client: string): boolean {
  const numberish = /[\d][\d.,\s\u00a0\u202f']*[\d]/g;
  const a = server.match(numberish) ?? [];
  const b = client.match(numberish) ?? [];
  if (a.length === 0 || a.length !== b.length) return false;
  return a.some((value, index) => value !== b[index] && digitsOnly(value) === digitsOnly(b[index]!));
}

function valueCandidates(issue: Issue, context: DiagnosisContext): Candidate[] {
  const out: Candidate[] = [];
  const server = typeof issue.server === 'string' ? issue.server : '';
  const client = typeof issue.client === 'string' ? issue.client : '';
  const scenario = context.scenario;
  const timezoneDiffers =
    scenario.timezoneId !== undefined && context.server.timezoneId !== undefined && scenario.timezoneId !== context.server.timezoneId;
  const localeDiffers =
    scenario.locale !== undefined && context.server.locale !== undefined && scenario.locale !== context.server.locale;

  if (issue.attribute === 'class') {
    const changed = differingTokens(issue.server, issue.client);
    if (changed.length > 0 && changed.every((token) => THEME_TOKEN.test(token))) {
      out.push({ id: 'theme', score: scenario.colorScheme === 'dark' ? 0.9 : 0.75, reason: `The class names that differ (${changed.join(', ')}) look like theme classes.` });
    } else if (changed.length > 0 && changed.every((token) => CSS_IN_JS_TOKEN.test(token))) {
      out.push({ id: 'css-in-js', score: changed.some((token) => /^(?:sc|css|emotion|jsx)-/.test(token)) ? 0.9 : 0.7, reason: `The class names that differ (${changed.join(', ')}) are generated by a CSS-in-JS library.` });
    }
  }
  if (issue.attribute === 'id' || issue.attribute === 'for' || issue.attribute?.startsWith('aria-')) {
    if (USE_ID.test(server) || USE_ID.test(client)) out.push({ id: 'unstable-id', score: 0.85, reason: 'The attribute holds a React-generated id.' });
  }
  if (issue.attribute && EXTENSION_ATTRIBUTE.test(issue.attribute)) {
    out.push({ id: 'extension', score: 0.9, reason: `The attribute ${issue.attribute} is added by a browser extension.` });
  }

  if (server === '' && client === '') return out;
  if (EPOCH_MS.test(server) && EPOCH_MS.test(client)) {
    out.push({ id: 'time', score: 0.92, reason: 'Both values contain millisecond timestamps.' });
  }
  const timeLike = (TIME_OF_DAY.test(server) || ISO_DATE.test(server) || MONTH.test(server)) && (TIME_OF_DAY.test(client) || ISO_DATE.test(client) || MONTH.test(client));
  if (timeLike) {
    if (timezoneDiffers) {
      out.push({ id: 'timezone', score: 0.9, reason: `Both values are dates or times, and the browser timezone (${scenario.timezoneId}) differs from the server's (${context.server.timezoneId}).` });
    } else if (localeDiffers && digitsOnly(server) === digitsOnly(client)) {
      out.push({ id: 'locale', score: 0.85, reason: `The same date is formatted differently for locale ${scenario.locale}.` });
    } else {
      out.push({ id: 'time', score: 0.75, reason: 'Both values are dates or times that differ.' });
    }
  }
  if (localeLikeNumbers(server, client)) {
    out.push({ id: 'locale', score: localeDiffers ? 0.93 : 0.8, reason: 'The same number is formatted with different separators.' });
  }
  if (DECIMAL_RANDOM.test(server) && DECIMAL_RANDOM.test(client)) {
    out.push({ id: 'random', score: 0.85, reason: 'Both values contain random-looking decimals.' });
  }
  if (UUID.test(server) && UUID.test(client)) {
    out.push({ id: 'random', score: 0.9, reason: 'Both values contain random UUIDs.' });
  }
  if (issue.code === 'HP1015') {
    const cdnHeader = CDN_HEADERS.find((name) => context.headers?.[name] !== undefined);
    out.push({
      id: 'cdn',
      score: cdnHeader ? 0.88 : 0.6,
      reason: cdnHeader ? `Only whitespace differs and the response passed through a CDN or proxy (${cdnHeader}).` : 'Only whitespace differs, which HTML minifiers cause.',
    });
  }
  const serverNumbers = server.match(/\d+/g);
  const clientNumbers = client.match(/\d+/g);
  if (serverNumbers?.length === 1 && clientNumbers?.length === 1 && server.replace(/\d+/, '#') === client.replace(/\d+/, '#')) {
    const a = Number(serverNumbers[0]);
    const b = Number(clientNumbers[0]);
    if (b > a && b - a <= 5 && a < 1e9) out.push({ id: 'data', score: 0.55, reason: 'A counter-like number is higher on the client.' });
  }
  return out;
}

interface SourcePattern {
  id: CauseId;
  pattern: RegExp;
  score: number;
  label: string;
}

const SOURCE_PATTERNS: SourcePattern[] = [
  { id: 'time', pattern: /\bDate\.now\s*\(|\bnew Date\s*\(\s*\)|\bperformance\.now\s*\(/, score: 0.85, label: 'reads the current time' },
  { id: 'timezone', pattern: /\.toLocale(?:Time|Date)?String\s*\(|Intl\.DateTimeFormat/, score: 0.6, label: 'formats a date in the runtime timezone' },
  { id: 'locale', pattern: /\.toLocale(?:String|DateString|TimeString)\s*\(\s*\)|Intl\.(?:NumberFormat|DateTimeFormat)\s*\(\s*\)|toLocaleString\s*\(\s*\)/, score: 0.75, label: 'formats with the runtime locale' },
  { id: 'random', pattern: /\bMath\.random\s*\(|crypto\.randomUUID\s*\(|\buuid(?:v4)?\s*\(|\bnanoid\s*\(/, score: 0.9, label: 'generates a random value' },
  { id: 'storage', pattern: /\b(?:localStorage|sessionStorage)\b/, score: 0.9, label: 'reads browser storage' },
  { id: 'theme', pattern: /prefers-color-scheme/, score: 0.92, label: 'reads the color scheme preference' },
  { id: 'media-query', pattern: /\bmatchMedia\s*\(|\binnerWidth\b|\bscreen\.(?:width|height)\b/, score: 0.85, label: 'reads the screen size' },
  { id: 'css-in-js', pattern: /\bstyled(?:\.[a-z]+|\()|\bcss`|@emotion|makeStyles\s*\(/, score: 0.7, label: 'creates CSS-in-JS styles' },
  { id: 'data', pattern: /\bfetch\s*\(|\buseSWR\s*\(|\buseQuery\s*\(|\baxios\b/, score: 0.65, label: 'fetches data' },
  { id: 'browser-api', pattern: /typeof\s+(?:window|document|navigator)\b|\bnavigator\.|\bwindow\.(?!matchMedia|localStorage|sessionStorage)/, score: 0.6, label: 'uses a browser-only API' },
];

const SCAN_RADIUS = 30;
const MAX_COMPONENT_LINES = 200;

/** Last line (exclusive index) of the block that opens on `from`, by brace counting. */
function blockEnd(lines: readonly string[], from: number): number {
  let depth = 0;
  let opened = false;
  const limit = Math.min(lines.length, from + MAX_COMPONENT_LINES);
  for (let index = from; index < limit; index++) {
    const code = lines[index]!.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '').replace(/\/\/.*$/, '');
    for (const char of code) {
      if (char === '{') {
        depth++;
        opened = true;
      } else if (char === '}') {
        depth--;
      }
    }
    if (opened && depth <= 0) return index + 1;
  }
  return limit;
}

function sourceCandidates(issue: Issue, context: DiagnosisContext): { candidates: Candidate[]; hits: Evidence[] } {
  const source = context.source;
  if (!source) return { candidates: [], hits: [] };
  const lines = source.content.split(/\r?\n/);
  const component = source.scope === 'component';
  const start = component ? source.line - 1 : Math.max(0, source.line - 1 - SCAN_RADIUS);
  const end = component ? blockEnd(lines, source.line - 1) : Math.min(lines.length, source.line + 5);
  const candidates: Candidate[] = [];
  const hits: Evidence[] = [];
  const best = new Map<CauseId, { distance: number; line: number; label: string; score: number }>();
  for (let index = start; index < end; index++) {
    const text = lines[index]!;
    if (/^\s*(?:\/\/|\*)/.test(text)) continue;
    for (const entry of SOURCE_PATTERNS) {
      if (!entry.pattern.test(text)) continue;
      const distance = Math.abs(index + 1 - source.line);
      const previous = best.get(entry.id);
      if (!previous || distance < previous.distance) best.set(entry.id, { distance, line: index + 1, label: entry.label, score: entry.score });
    }
  }
  for (const [id, hit] of best) {
    // Nearer code is stronger evidence.
    let score = hit.score - Math.min(0.2, hit.distance * 0.01);
    if (id === 'timezone' && !(context.scenario.timezoneId && context.server.timezoneId && context.scenario.timezoneId !== context.server.timezoneId)) score -= 0.3;
    if (id === 'css-in-js' && issue.attribute !== 'class') score -= 0.3;
    candidates.push({ id, score, reason: `${source.file}:${hit.line} ${hit.label}.` });
    hits.push({ kind: 'note', message: `${source.file}:${hit.line} ${hit.label}: ${lines[hit.line - 1]!.trim().slice(0, 120)}` });
  }
  return { candidates, hits };
}

function stageCandidates(issue: Issue): Candidate[] {
  switch (issue.code) {
    case 'HP3001':
    case 'HP3002':
      return [{ id: 'invalid-html', score: 0.97, reason: 'The browser repaired the markup before React hydrated it.' }];
    case 'HP4002':
      return [{ id: 'extension', score: 0.9, reason: 'The change matches what browser extensions do.' }];
    case 'HP4001':
      return [{ id: 'third-party-script', score: 0.8, reason: 'The DOM changed after parsing and before hydration.' }];
    case 'HP4003':
      return [{ id: 'cdn', score: 0.95, reason: 'The HTML the browser received differs from what the origin produced.' }];
    default:
      return [];
  }
}

function scenarioCandidates(issue: Issue, context: DiagnosisContext): Candidate[] {
  if (!issue.code.startsWith('HP1')) return [];
  const out: Candidate[] = [];
  const { scenario } = context;
  if (scenario.colorScheme === 'dark' && issue.attribute === 'class') out.push({ id: 'theme', score: 0.5, reason: 'The scenario uses dark mode.' });
  if (scenario.hasStorage) out.push({ id: 'storage', score: 0.35, reason: 'The scenario pre-fills browser storage.' });
  if (scenario.mobile) out.push({ id: 'media-query', score: 0.35, reason: 'The scenario uses a mobile viewport.' });
  return out;
}

// Differences people suppress on purpose (timestamps, next-themes style theme classes).
const INTENTIONAL: ReadonlySet<CauseId> = new Set(['time', 'timezone', 'locale', 'random', 'theme', 'extension']);

export interface Diagnosis {
  cause?: Cause;
  evidence: Evidence[];
  suggestions: string[];
  /** Severity override for suspicious suppression. */
  severity?: Issue['severity'];
}

export function diagnose(issue: Issue, context: DiagnosisContext): Diagnosis {
  const source = sourceCandidates(issue, context);
  const candidates = [...stageCandidates(issue), ...valueCandidates(issue, context), ...source.candidates, ...scenarioCandidates(issue, context)];

  // Combine: the strongest signal wins; other signals for the same cause add a little.
  const totals = new Map<CauseId, { score: number; reasons: string[] }>();
  for (const candidate of candidates) {
    const entry = totals.get(candidate.id);
    if (!entry) totals.set(candidate.id, { score: candidate.score, reasons: [candidate.reason] });
    else {
      entry.score = Math.min(0.99, Math.max(entry.score, candidate.score) + 0.05);
      entry.reasons.push(candidate.reason);
    }
  }
  // Specific causes beat their generic parents when both are present.
  const time = totals.get('time');
  const zone = totals.get('timezone');
  if (time && zone && zone.score >= 0.8) totals.delete('time');
  const locale = totals.get('locale');
  if (time && locale && locale.score > time.score) totals.delete('time');
  const browser = totals.get('browser-api');
  if (browser) {
    for (const specific of ['storage', 'media-query', 'theme'] as const) {
      const other = totals.get(specific);
      if (other && other.score >= browser.score - 0.1) {
        totals.delete('browser-api');
        break;
      }
    }
  }

  const ranked = [...totals.entries()].sort((a, b) => b[1].score - a[1].score);
  const diagnosis: Diagnosis = { evidence: source.hits, suggestions: [] };
  const top = ranked[0];

  if (issue.suppressed) {
    const detected = top?.[0];
    diagnosis.cause = { id: 'suppressed', title: CAUSES.suppressed.title, confidence: 0.9 };
    diagnosis.suggestions = CAUSES.suppressed.fixes;
    if (detected !== undefined && !INTENTIONAL.has(detected) && top![1].score >= 0.6) {
      diagnosis.severity = 'warning';
      diagnosis.evidence.push({
        kind: 'note',
        message: `suppressHydrationWarning hides a difference that does not look intentional (${CAUSES[detected].title.toLowerCase()}).`,
      });
      diagnosis.suggestions = [...CAUSES[detected].fixes, ...CAUSES.suppressed.fixes];
    }
    return diagnosis;
  }

  if (!top || top[1].score < 0.35) return diagnosis;
  const [id, { score, reasons }] = top;
  diagnosis.cause = { id, title: CAUSES[id].title, confidence: Math.round(score * 100) / 100 };
  diagnosis.suggestions = CAUSES[id].fixes;
  diagnosis.evidence.unshift({ kind: 'note', message: `Likely cause: ${CAUSES[id].title}. ${reasons[0]}` });
  return diagnosis;
}

export function causeDocsUrl(id: string): string {
  return `${CAUSE_DOCS_BASE}${id}`;
}
