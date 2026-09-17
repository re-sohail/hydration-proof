import type { IssueCode } from './registry.ts';

// Generic, safe advice per issue code. Cause-specific advice (0.2) is added
// on top by the diagnosis engine.

const SUGGESTIONS: Partial<Record<IssueCode, string[]>> = {
  HP1001: [
    'Render exactly the same text on the server and in the first client render.',
    'Move browser-only or time-dependent values into useEffect, or compute them on the server and pass them down as props.',
  ],
  HP1002: [
    'Compute the attribute from data that is identical on the server and the client.',
    'React does not fix attributes during hydration, so users keep seeing the server value until the next update.',
  ],
  HP1003: ['Make inline styles depend only on data available on both server and client, or apply them after mount.'],
  HP1004: [
    'Make class names deterministic between server and client.',
    'For themes, read the preference on the server (for example from a cookie) or set the class with a pre-hydration script and suppressHydrationWarning on that element.',
    'For CSS-in-JS, set up the library\'s server style registry so class names are generated in the same order.',
  ],
  HP1005: ['Remove the attribute from the server output or render it on the client too.'],
  HP1006: ['Render the attribute on the server as well, or add it after mount in useEffect.'],
  HP1007: ['Render the same element type on server and client; branch on data that both sides share.'],
  HP1008: ['Do not render server-only nodes inside hydrated components; use the same condition on both sides.'],
  HP1009: ['Render client-only nodes after mount (useEffect) or with a client-only component.'],
  HP1010: ['Fix the mismatch inside this branch; React re-renders it on every page load until then.'],
  HP1011: ['Fix the mismatch or wrap the unstable part in a Suspense boundary so React only re-renders that part.'],
  HP1012: ['Use defaultValue/defaultChecked with values that are identical on server and client.'],
  HP1013: ['Make the injected HTML identical on server and client, or render it after mount.'],
  HP1014: [
    'Render the same <title> and <meta> tags on the server and the client, so search engines, link previews and the first paint show the final values.',
    'Compute head values from data the server has (route params, cookies) instead of browser-only values.',
  ],
  HP1015: [
    'Turn off HTML minification that removes whitespace (for example CDN "Auto Minify") for server-rendered React pages.',
    'Avoid relying on whitespace-only text nodes between elements.',
  ],
  HP2001: ['Run hydration-proof in development mode (--mode dev) for React\'s detailed diff.'],
  HP2003: ['Check the error React reported for this boundary; the boundary is rendered on the client until it is fixed.'],
  HP2004: ['Wrap unstable parts in Suspense boundaries so a hydration error does not re-render the whole page.'],
  HP2005: ['Wrap updates triggered during hydration in startTransition.'],
  HP2006: ['Check the server logs: the server threw while rendering this Suspense boundary.'],
  HP3001: [
    'Fix the nesting: for example use <span> instead of <div> inside <p>, and wrap table rows in <tbody>.',
    'The browser rewrites invalid markup before React hydrates, so the DOM never matches what React rendered.',
  ],
  HP3002: ['Do not nest links inside links, buttons inside buttons or forms inside forms.'],
  HP3003: ['Give every element a unique id; generate ids for repeated components with useId.'],
  HP3004: [
    'Give every React root on the page its own identifierPrefix (hydrateRoot(container, element, { identifierPrefix: "app-" })).',
    'Or render the parts in one root (for example with portals), so useId generates unique ids.',
  ],
  HP4001: [
    'Find the script that changes the DOM before hydration and run it after hydration, or make it change only elements outside React\'s tree.',
    'If a browser extension causes this, it cannot be fixed in code; add an ignore rule for the extension\'s attributes.',
  ],
  HP4002: ['This comes from a browser extension on the test machine or simulated by your scenario; ignore it if it is expected.'],
  HP4003: ['Disable HTML rewriting (minification, email obfuscation, injection) for server-rendered pages at the CDN or proxy.'],
  HP5001: [
    'Keep controls disabled (or show them as loading) until the page is interactive, or make them work without JavaScript (links, forms with Server Actions).',
    'Ship less JavaScript for the first view and hydrate important controls first (Suspense boundaries hydrate in order of interaction).',
  ],
  HP5002: [
    'Use uncontrolled inputs (defaultValue/defaultChecked) or read the current DOM value when the component mounts, so text typed before hydration is kept.',
    'Fix any hydration mismatch around the form: a re-rendered branch creates new, empty inputs.',
  ],
  HP5003: ['Avoid re-creating the focused element during hydration (fix mismatches around it), and do not move focus in effects that run on load.'],
  HP5004: [
    'Render the same content for a route whether it is loaded directly or reached through client-side navigation: read data from the route (params, search params, server data), not from the previous page or client state.',
    'Check layouts that keep state between navigations and components that depend on the previous route.',
  ],
  HP5005: [
    'Open the route through a link in the browser and check the console and the network tab for the failed request.',
    'Make sure server components of the route do not throw for requests that come from client-side navigation (RSC requests).',
  ],
  HP5006: [
    'Handle the event in one place: remove the inline on* attribute or the script that adds the listener, or remove the React handler.',
  ],
  HP5007: ['Do not change the scroll position during hydration (scrollTo in effects, focus() on load); let the browser restore it.'],
  HP5008: ['Run the interaction in a headed browser (--headed) to see where it fails.'],
  HP6001: [
    'This is fine if the difference is intentional (timestamps, for example). Keep suppressHydrationWarning on the smallest element possible.',
  ],
  HP6002: ['suppressHydrationWarning only covers the element\'s own text and attributes; fix the structural difference.'],
  HP6003: ['Remove suppressHydrationWarning if nothing on this element differs, so real mismatches are not hidden later.'],
  HP9001: ['Increase the hydration timeout, or check for Suspense boundaries that never resolve in the test environment.'],
  HP9002: ['Check that the URL serves a React page and that its scripts load in the test browser.'],
  HP9004: ['Check that the server is running and the URL is correct.'],
  HP9005: ['Make the route return a success status, or list the status in the route\'s expected statuses.'],
  HP9009: ['Increase ready.quietMs/timeout or provide ready.selector for pages with continuous updates.'],
  HP9010: [
    'If the redirect is intended, set expectRedirect on the route, or limit the route to the scenarios that can open it (scenario include/exclude).',
    'For signed-in scenarios, check the login step or the storage state file.',
  ],
};

export function suggestionsFor(code: IssueCode): string[] {
  return SUGGESTIONS[code] ?? [];
}
