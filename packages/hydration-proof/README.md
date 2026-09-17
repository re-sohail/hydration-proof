# hydration-proof

Find React hydration problems before your users do.

`hydration-proof` loads every route of your server-rendered React app in a real browser, watches React hydrate it, and tells you exactly what differed between the server HTML and the first client render: which element, which value on each side, and why. It runs locally and in CI, and adds nothing to your production bundle.

**[Documentation](https://hydration.jscrate.dev)** · [Issue codes](https://github.com/re-sohail/hydration-proof/blob/main/docs/issues.md) · [CLI](https://github.com/re-sohail/hydration-proof/blob/main/docs/cli.md) · [Configuration](https://github.com/re-sohail/hydration-proof/blob/main/docs/configuration.md) · [CI](https://github.com/re-sohail/hydration-proof/blob/main/docs/ci.md)

```text
Hydration Proof — 20 pages on http://localhost:3000

  ✓ /pricing 684ms
  ✖ /dashboard 1.1s  1 error
    HP1001 Text differs between server and client  (timezone difference, 95%)
      #last-login  in LastLogin
      server: "Signed in at 5:00 AM"
      client: "Signed in at 10:00 AM"
      app/dashboard/LastLogin.tsx:14:10
      → Pass an explicit timeZone to the formatter (the same on both sides), or format the date after mount.
  ✖ /settings 687ms  1 error
    HP1004 Class name differs between server and client  (theme preference (dark/light mode), 99%)
      #theme  in ThemePreview
      attribute: class
      server: "theme-light"
      client: "theme-dark"
      app/settings/ThemePreview.tsx:9:5

  Report: .hydration-proof/report/report.html
```

## Why

React expects the first client render to match the server HTML exactly. When it does not:

- React 19 throws the server HTML away and renders the page again on the client (slower, and state is lost), or
- it keeps **wrong attributes silently**: in production, a mismatched `className`, `style` or `data-*` is never reported and never fixed.

The browser console only shows a minified error code in production, and nothing at all for attribute mismatches. `hydration-proof` finds both, in development and production builds.

## What it checks

| | |
| --- | --- |
| **Text and structure** | Text, elements and whitespace that differ between server HTML and the client render, including branches React had to re-render. |
| **Silent attribute mismatches** | Compares every attribute and style with the props React renders on the client, so the mismatches React 19 never reports in production are found too. |
| **Invalid HTML** | Nesting the browser repairs while parsing (`<div>` in `<p>`, links in links, table rows without `<tbody>`), with the line in the server HTML. |
| **Changes before hydration** | Scripts, browser extensions or third-party tags that modify the page before React hydrates it. |
| **CDN and proxy rewrites** | Whitespace minification and other HTML rewriting between your server and the browser. |
| **`suppressHydrationWarning`** | Differences hidden by it are listed as info, so you know what you are suppressing. |
| **React's own reports** | Recoverable errors, component stacks and warnings from React 18 and 19, development and production. |

Every finding has a [stable code](https://github.com/re-sohail/hydration-proof/blob/main/docs/issues.md), the CSS selector of the element, the server and client values, the component and **the line in your code**, the [likely cause](https://github.com/re-sohail/hydration-proof/blob/main/docs/causes.md) (time, timezone, locale, random values, browser storage, media queries, theme, data, CSS-in-JS, extensions, CDNs, ...) with a confidence score, and a fix for that cause.

## Install

```bash
npm install -D hydration-proof
npx hydration-proof install     # downloads Chromium once
```

Works with npm, pnpm, Yarn (including Plug'n'Play) and Bun. There are no install scripts; browsers are only downloaded by the `install` command.

## Use it

```bash
npx hydration-proof init   # creates hydration-proof.config.ts
npx hydration-proof test
```

For a Next.js app, that is all: routes are discovered from `app/`, `pages/` and the build output (dynamic pages the build pre-rendered, the not-found page), the app is built (if needed) and started on a free port, every route is tested, and the process exits with code 1 if something is wrong.

More routes: `--sitemap` adds the pages in your sitemap, and `--crawl` follows the links on tested pages.

Open `.hydration-proof/report/report.html` for the full picture: filters, the server and client values side by side, the code, screenshots with the affected elements outlined, and a timeline of the page. See [reports](https://github.com/re-sohail/hydration-proof/blob/main/docs/reports.md).

Development builds give exact source lines; production builds show what your users get. Test both in one run:

```bash
npx hydration-proof test --mode both
```

To test an app that is already running:

```bash
npx hydration-proof test --url http://localhost:3000 --route / --route /pricing
```

## Configure

```ts
// hydration-proof.config.ts
import { defineConfig } from 'hydration-proof';

export default defineConfig({
  routes: {
    // Example values for dynamic routes
    dynamic: {
      '/products/[id]': ['1', '42'],
    },
    exclude: ['/api/**'],
  },

  // The environments your users have
  scenarios: [
    { name: 'default', exclude: ['/account/**'] },
    { name: 'dark-mobile', colorScheme: 'dark', viewport: 'mobile' },
    { name: 'karachi', locale: 'ur-PK', timezoneId: 'Asia/Karachi' },
    {
      // Signs in once; every /account page is then tested as this user
      name: 'customer',
      include: ['/account/**'],
      login: async ({ page, baseUrl }) => {
        await page.goto(`${baseUrl}/login`);
        await page.fill('#email', process.env.TEST_EMAIL ?? '');
        await page.fill('#password', process.env.TEST_PASSWORD ?? '');
        await page.click('button[type=submit]');
        await page.waitForURL('**/account');
      },
      // Answers for API calls made by the browser
      mocks: [{ url: '**/api/recommendations', body: { items: [] } }],
    },
  ],

  hooks: {
    // Seed test data once the app is up
    setup: async ({ baseUrl }) => {
      await fetch(`${baseUrl}/api/test/seed`, { method: 'POST' });
    },
  },

  ignore: {
    selectors: ['.third-party-widget'],
    issues: [{ code: 'HP1004', route: '/legacy/**', reason: 'Old theme system', expires: '2026-12-31' }],
  },
});
```

All options are described in [docs/configuration.md](https://github.com/re-sohail/hydration-proof/blob/main/docs/configuration.md). The config file is loaded with Node's built-in TypeScript support, so no extra tooling is needed.

## In CI

```yaml
# .github/workflows/hydration.yml
- run: npm ci
- run: npx hydration-proof install --with-deps
- run: npx hydration-proof test
```

Exit codes: `0` passed · `1` issues found · `2` configuration error · `3` the app did not start · `4` the browser is missing. Reports are written to `.hydration-proof/report/`. Split large apps across parallel jobs with `--shard 1/3`, `--shard 2/3`, ... See [docs/ci.md](https://github.com/re-sohail/hydration-proof/blob/main/docs/ci.md).

## How it works

A small script is injected into the page before any of your code runs. It connects to React the same way React DevTools does (React offers this hook in development and production builds) and records:

1. **Server HTML**: the exact bytes of the response the browser received.
2. **Parsed HTML**: the DOM the browser builds from those bytes, before any script runs.
3. **Pre-hydration DOM**: the page right before React's first commit.
4. **Hydrated DOM**: the page inside React's hydration commit, plus the props React renders on the client.
5. **After effects** and **stable** snapshots.

Comparing neighbouring stages tells *where* a difference started: in the markup, in a script that ran before React, or in the React render itself. Your application code is not changed and nothing is added to your build. Details in [docs/how-it-works.md](https://github.com/re-sohail/hydration-proof/blob/main/docs/how-it-works.md).

## Requirements

- Node.js 22.18 or newer
- React 18 or 19 with server rendering (Next.js App Router and Pages Router are detected automatically; other servers work with `server.command` or `--url`)
- A Playwright browser (`npx hydration-proof install`). Browsers live in Playwright's shared cache, so a project that already uses the same Playwright version does not download them again

The only runtime dependency is `playwright-core`.

## License

MIT © [Sohail Khan](https://me.jscrate.dev)
