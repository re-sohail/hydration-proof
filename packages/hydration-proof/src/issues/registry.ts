// Every issue hydration-proof can report. This table is the single source of
// truth for codes, titles, default severities, documentation links and the
// SARIF rule list. Codes are stable: never renumber or reuse one.

export type Severity = 'error' | 'warning' | 'info';

export interface IssueDefinition {
  code: string;
  /** Kebab-case identifier, stable like the code. */
  name: string;
  title: string;
  severity: Severity;
  description: string;
}

export const DOCS_BASE = 'https://hydration.jscrate.dev/docs/issues/';

export type IssueCode =
  | 'HP1001'
  | 'HP1002'
  | 'HP1003'
  | 'HP1004'
  | 'HP1005'
  | 'HP1006'
  | 'HP1007'
  | 'HP1008'
  | 'HP1009'
  | 'HP1010'
  | 'HP1011'
  | 'HP1012'
  | 'HP1013'
  | 'HP1014'
  | 'HP1015'
  | 'HP2001'
  | 'HP2002'
  | 'HP2003'
  | 'HP2004'
  | 'HP2005'
  | 'HP2006'
  | 'HP2007'
  | 'HP3001'
  | 'HP3002'
  | 'HP3003'
  | 'HP4001'
  | 'HP4002'
  | 'HP4003'
  | 'HP5001'
  | 'HP5002'
  | 'HP5003'
  | 'HP6001'
  | 'HP6002'
  | 'HP6003'
  | 'HP9001'
  | 'HP9002'
  | 'HP9003'
  | 'HP9004'
  | 'HP9005'
  | 'HP9006'
  | 'HP9007'
  | 'HP9008'
  | 'HP9009';

type Row = readonly [name: string, title: string, severity: Severity, description: string];

const definitions: Record<IssueCode, Row> = {
  // HP1xxx — the DOM React hydrated does not match what it rendered
  HP1001: ['text-mismatch', 'Text differs between server and client', 'error',
    'The server HTML contains different text than the browser rendered during hydration.'],
  HP1002: ['attribute-mismatch', 'Attribute differs between server and client', 'error',
    'An attribute value in the server HTML differs from the value React rendered on the client. React does not patch attributes during hydration.'],
  HP1003: ['style-mismatch', 'Inline style differs between server and client', 'error',
    'The style attribute rendered on the server differs from the style React applies on the client.'],
  HP1004: ['class-mismatch', 'Class name differs between server and client', 'error',
    'The class attribute rendered on the server differs from the className React renders on the client. The page keeps the server classes.'],
  HP1005: ['extra-attribute', 'Attribute only present in the server HTML', 'warning',
    'The server HTML has an attribute that React does not render on the client.'],
  HP1006: ['missing-attribute', 'Attribute missing from the server HTML', 'error',
    'React renders an attribute on the client that the server HTML does not have.'],
  HP1007: ['element-mismatch', 'Different element rendered on server and client', 'error',
    'The server rendered one element and the client rendered a different one in the same place.'],
  HP1008: ['extra-element', 'Element only present in the server HTML', 'error',
    'The server HTML contains a node the client render does not produce.'],
  HP1009: ['missing-element', 'Element missing from the server HTML', 'error',
    'The client render produces a node the server HTML does not contain.'],
  HP1010: ['branch-replaced', 'React discarded server HTML and rendered a branch again', 'error',
    'Hydration failed inside this branch, so React threw away the server HTML and rendered it on the client. This costs performance and resets state.'],
  HP1011: ['root-replaced', 'React discarded the whole server-rendered page', 'error',
    'Hydration failed outside any Suspense boundary, so React re-rendered the entire root on the client.'],
  HP1012: ['form-state-mismatch', 'Form state differs between server and client', 'warning',
    'A form control value, checked or selected state changed during hydration.'],
  HP1013: ['inner-html-mismatch', 'dangerouslySetInnerHTML differs between server and client', 'error',
    'The HTML injected with dangerouslySetInnerHTML differs between the server and the client. React does not patch it.'],
  HP1014: ['head-mismatch', 'Document head differs between server and client', 'warning',
    'Metadata, stylesheets or scripts in <head> changed during hydration.'],
  HP1015: ['whitespace-mismatch', 'Whitespace differs between server and client', 'error',
    'Only whitespace differs, which usually means something rewrote the HTML between the server and the browser.'],

  // HP2xxx — React reported a problem
  HP2001: ['react-hydration-error', 'React reported a hydration error', 'error',
    'React reported that hydration failed. The DOM comparison could not locate the exact difference.'],
  HP2002: ['react-hydration-warning', 'React warned about a hydration mismatch', 'warning',
    'React logged a hydration mismatch warning (development builds only).'],
  HP2003: ['boundary-client-rendered', 'A Suspense boundary switched to client rendering', 'error',
    'React could not hydrate a Suspense boundary and rendered it on the client instead.'],
  HP2004: ['root-client-rendered', 'The root switched to client rendering', 'error',
    'An error during hydration outside any Suspense boundary made React render the whole root on the client.'],
  HP2005: ['update-before-hydration', 'An update arrived before hydration finished', 'warning',
    'A Suspense boundary or root received an update before it finished hydrating (React errors 421/424).'],
  HP2006: ['server-render-error', 'The server could not finish rendering a boundary', 'error',
    'The server failed to render part of the page and the client had to render it (React error 419).'],
  HP2007: ['page-error', 'Uncaught error while loading the page', 'warning',
    'A script threw during page load. It may or may not be related to hydration.'],

  // HP3xxx — markup the browser repaired
  HP3001: ['invalid-nesting', 'Invalid HTML nesting', 'error',
    'The markup nests elements in a way HTML does not allow. Browsers repair it while parsing, so the DOM no longer matches what React rendered.'],
  HP3002: ['nested-interactive', 'Interactive element nested in another', 'error',
    'Links, buttons and forms cannot contain another element of the same kind.'],
  HP3003: ['duplicate-id', 'Duplicate id attribute', 'info',
    'Several elements share the same id.'],

  // HP4xxx — something outside React changed the page
  HP4001: ['pre-hydration-mutation', 'The page was modified before React hydrated', 'error',
    'A script, browser extension or third-party tag changed the server-rendered DOM before hydration.'],
  HP4002: ['extension-mutation', 'A browser extension changed the page', 'info',
    'Changes typical of browser extensions (grammar checkers, password managers, translators) were found.'],
  HP4003: ['html-rewritten', 'HTML was rewritten between the server and the browser', 'error',
    'The HTML the browser received differs from what the origin server produced (CDN minification, proxies, edge functions).'],

  // HP5xxx — interaction and streaming (0.6)
  HP5001: ['lost-interaction', 'An interaction before hydration was lost', 'error',
    'A click or input made before hydration finished had no effect.'],
  HP5002: ['input-reset', 'User input was reset during hydration', 'error',
    'Text typed before hydration finished was cleared or replaced.'],
  HP5003: ['focus-lost', 'Focus was lost during hydration', 'warning',
    'The focused element was replaced during hydration.'],

  // HP6xxx — suppressHydrationWarning audit
  HP6001: ['suppressed-mismatch', 'Mismatch hidden by suppressHydrationWarning', 'info',
    'The server and client values differ on an element marked with suppressHydrationWarning. React keeps the server value.'],
  HP6002: ['suppression-hides-structure', 'suppressHydrationWarning cannot hide a structural difference', 'error',
    'suppressHydrationWarning only covers text and attributes one level deep; the elements inside still differ.'],
  HP6003: ['suppression-unused', 'suppressHydrationWarning with nothing to suppress', 'info',
    'The element is marked with suppressHydrationWarning but its server and client output are identical.'],

  // HP9xxx — the test itself could not complete
  HP9001: ['hydration-timeout', 'Hydration did not finish in time', 'error',
    'React was on the page but hydration did not complete before the timeout.'],
  HP9002: ['no-react', 'No React found on the page', 'warning',
    'The page loaded without any React renderer, so nothing was hydrated.'],
  HP9003: ['client-rendered-page', 'The page is rendered on the client only', 'info',
    'React mounted with createRoot instead of hydrating server HTML.'],
  HP9004: ['navigation-failed', 'The page could not be loaded', 'error',
    'The browser could not navigate to the URL.'],
  HP9005: ['http-error', 'The server answered with an error status', 'error',
    'The document response had an HTTP error status.'],
  HP9006: ['body-unavailable', 'The server HTML could not be captured', 'warning',
    'The document body was not available, so server-side stages could not be compared.'],
  HP9007: ['capture-truncated', 'Some capture data was dropped', 'warning',
    'Buffers overflowed while capturing; results may be incomplete.'],
  HP9008: ['no-root', 'React loaded but never mounted a root', 'warning',
    'A React renderer was injected but no root was created before the timeout.'],
  HP9009: ['ready-timeout', 'The page never became quiet', 'warning',
    'The ready conditions (quiet DOM, selector, function) were not met before the timeout.'],
};

export const ISSUES: ReadonlyMap<IssueCode, IssueDefinition> = new Map(
  (Object.entries(definitions) as [IssueCode, Row][]).map(([code, [name, title, severity, description]]) => [
    code,
    { code, name, title, severity, description },
  ]),
);

export function issueDefinition(code: IssueCode): IssueDefinition {
  const found = ISSUES.get(code);
  if (!found) throw new Error(`Unknown issue code ${code}`);
  return found;
}

export function docsUrl(code: IssueCode): string {
  return `${DOCS_BASE}${code.toLowerCase()}`;
}

export function isIssueCode(value: string): value is IssueCode {
  return ISSUES.has(value as IssueCode);
}
