# Security

hydration-proof runs your app in a browser and reads what it renders, so it sees
everything the app renders — including pages behind a login. This page says what
it does with that, what it sends where, and how to keep reports safe to share.

Please report vulnerabilities privately through
[GitHub security advisories](https://github.com/re-sohail/hydration-proof/security/advisories/new),
not in public issues.

## No telemetry

Nothing about your app, your run or your machine is uploaded. There is no
analytics, no crash reporting, no version check and no "anonymous usage data" —
neither on install nor at run time. The package has no `postinstall` or other
lifecycle script, so nothing runs until you run a command yourself.

## The network

Every request comes from a command you started, and all of them go to the app
you are testing:

| What | Where it goes |
| --- | --- |
| The pages under test, and everything they load | The URL from `server.url` or `--url` |
| Readiness checks while the server starts | The same URL |
| Sitemap and crawl requests | The same origin (crawling never leaves it; a `routes.sitemap` URL you configure yourself is used as given) |
| Scripts and source maps, to turn a stack frame into `file:line` | The app's origin, plus any origin in [`sourceOrigins`](configuration.md#sourceorigins) |

Two commands reach further, and only when you run them:

- `hydration-proof install` downloads browsers, through Playwright's own
  installer and its hosts. `PLAYWRIGHT_DOWNLOAD_HOST` and the other Playwright
  environment variables work as usual, so an internal mirror can be used.
- The build and server commands from your config are run as you wrote them, with
  your environment. They may of course do anything.

### Source maps are origin-restricted

To name the file and line a finding comes from, hydration-proof downloads the
page's scripts and their source maps. Those requests are limited to the app's
own origin. A script or `sourceMappingURL` pointing anywhere else is skipped,
and the run ends with a note listing the origins it refused:

```text
Source maps were not fetched from https://cdn.example.com (only the app's own
origin is used). Add sourceOrigins to the config to allow them.
```

This matters because a page can name any URL in a `sourceMappingURL` comment.
Without the restriction, testing a page you do not control could make your CI
runner fetch from a host of that page's choosing — from inside your network. If
your app really does serve its bundles from a CDN, allow that one origin:

```ts
sourceOrigins: ['https://cdn.example.com'];
```

Findings are still reported without a source location when a map is skipped, so
the restriction costs you file names, never detection.

## What ends up in a report

A report is built from the app's own output, so it can contain page text, values
of attributes, URLs with their query strings, server log lines and screenshots.
**Treat a report like a test artifact of the app it came from**, and think before
attaching one to a public pull request.

### Redaction is on by default

Before anything is written or printed, known secrets and personal data are
replaced. Fingerprints are computed first, so redaction never changes which
findings are grouped together or matched against a baseline.

Built-in rules cover:

- email addresses
- JWTs, `Bearer` tokens, `sk_`/`pk_`/`rk_` keys, GitHub (`ghp_`, `github_pat_`),
  GitLab (`glpat-`), Slack (`xox…`), AWS (`AKIA…`) and Google (`AIza…`) keys,
  and PEM private key blocks
- secret URL parameters (`token`, `api_key`, `password`, `session`, `code`,
  `signature` and others), whose values become `[redacted]`
- payment card numbers: a match must pass the Luhn checksum **and** have a
  prefix and length a card network actually issues, so order ids and
  millisecond timestamps are left alone

Add your own patterns with [`redact`](ci.md#personal-data-and-secrets).
`selectors` is separate: it blacks those elements out in screenshots, and does
not change report text.

```ts
redact: {
  patterns: [/CUST-\d{6}/],
  selectors: ['.account-number', '[data-private]'],
}
```

`redact: false` turns redaction off entirely, and `screenshots: 'off'` is the
blunt instrument for pages whose pictures should not exist at all. The summary of
a run says how many values were replaced and under which label, so you can see
the rules firing.

### Keep credentials out of the config

Log in with `hooks.globalSetup` and a `storageState` file, or read secrets from
the environment — never write them into `hydration-proof.config.ts`:

```ts
scenarios: [{ name: 'admin', headers: { authorization: `Bearer ${process.env.TEST_TOKEN}` } }];
```

`hydration-proof init` adds the report folder to `.gitignore`; add your
`storageState` file too. See [signed-in pages](configuration.md#signed-in-pages).

## The HTML report

`report.html` is a single file you open from disk. The report data sits in a
`<script type="application/json">` element with `<`, `>`, `&` and the line
separators escaped, and the viewer only ever writes it into the page with
`textContent`, so page content from the app under test cannot become markup or
script in the report. The document also carries a `Content-Security-Policy`
`<meta>` with `default-src 'none'`, which stops the report from loading or
sending anything at all.

## The dashboard and `dev`

`hydration-proof ui` starts a small local server. It is meant for your own
machine, and it is built so that a web page you happen to have open cannot drive
it:

- it listens on `127.0.0.1` only, never on `0.0.0.0`
- every request needs a random 144-bit token, generated per run and printed as
  part of the URL; it is compared with `timingSafeEqual`
- requests whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` are
  refused, so a DNS name that resolves to your loopback address cannot reach it
- `POST /api/*` needs the token in an `x-hydration-proof-token` header, which a
  cross-site form cannot set, and a request with an `Origin` header from
  anywhere else is refused
- report files are served from one token-prefixed path, from inside the output
  folder only, and only with known media types
- bodies are capped, and responses carry `no-store` and `nosniff`

Do not forward the port or share the URL: the token in it is the only thing
protecting the dashboard, and running tests means running your configured build
and server commands.

`hydration-proof dev` opens a normal browser window with the overlay injected by
an init script. The overlay lives in its own shadow root, so the app's CSS
cannot reach it and its own CSS cannot reach the app, and every node it adds
carries `data-hydration-proof-internal` so the tool's own markup is never
compared as if it were the app's. Your files are never modified: nothing is
written into your source tree, and nothing ships in your production bundle.

## Supply chain

- One runtime dependency: `playwright-core`, which itself has none. Everything
  else is Node built-ins or code in this repository.
- Published as ESM with no lifecycle scripts, so installing the package cannot
  execute anything.
- The browser runtime is inlined into `dist` at build time, so nothing is read
  from disk or the network at run time; this is also what makes Yarn Plug'n'Play
  work.
- Releases are published from CI with npm trusted publishing (OIDC), so no
  long-lived npm token exists to leak. Every published version has a provenance
  attestation you can check with `npm audit signatures`.

## Running it on untrusted pages

Testing a URL you do not control means loading that page in a browser on your
machine or runner. The browser is Playwright's, sandboxed as usual, each run
gets a fresh context, and the source-map restriction above keeps a hostile page
from steering requests. It is still worth doing in a container with no access to
your internal network, the way you would treat any other untrusted URL.
