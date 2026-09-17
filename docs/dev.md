# Development tools

## Overlay: `hydration-proof dev`

```bash
npx hydration-proof dev
```

Starts the development server and opens a browser window. Every page you open is checked the same way `hydration-proof test` checks it, and the result appears in a small panel in the corner of the page and in the terminal:

- the findings of the page, with the server and client values, the likely cause and the fix;
- **Highlight** scrolls to the element and outlines it;
- **Open file:line** opens the source in your editor;
- **Copy** and **Copy report** put a Markdown summary on the clipboard (for an issue or a pull request);
- **Re-run** reloads the page and checks it again.

The overlay is injected by the browser: your app is not changed, nothing is added to its bundle, and the overlay is ignored by the checks. Client-side navigations keep the result of the last loaded page; reload to check the page you navigated to.

The editor comes from `HYDRATION_PROOF_EDITOR`, `VISUAL` or `EDITOR` (for example `code`, `cursor`, `zed`, `webstorm`, `subl`, `nvim`), or the first of Cursor, VS Code, Windsurf, Zed, WebStorm, IntelliJ IDEA or Sublime Text found on `PATH`. Only files inside the repository are opened.

Options: `--url` (use a running server), `--route` (first page), `--scenario`, `--mode production`, `--browser`, `--channel`.

## Watch mode: `hydration-proof test --watch`

```bash
npx hydration-proof test --watch
```

Starts the development server once, tests every route, then waits for changes. After each change only the routes the changed files can affect are tested (see [`--changed`](ci.md#testing-only-what-changed)); changes to `package.json`, configs or environment files test every route. Add `--mode production` to test the production server instead (it is not rebuilt on changes).

## Dashboard: `hydration-proof ui`

```bash
npx hydration-proof ui --open
```

A local page to start test runs (all routes or some, with probes, interaction or navigation checks), follow their output live and read the latest HTML report. The dashboard listens on `127.0.0.1` only, and the printed URL contains a random access token that every request needs. It refuses requests for other host names and cross-site requests. Stop it with Ctrl+C.
