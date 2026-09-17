---
'hydration-proof': minor
---

Framework adapters, developer tools and plugins.

- **Adapters** for React Router (framework mode), Remix, Astro (every island is its own root; pages without React are fine), Vite SSR and custom Node servers, next to Next.js. They build and start the app, discover routes (`react-router routes`, `remix routes`, `src/pages`), ignore framework markup and navigate with the app's router for navigation checks. `adapter` accepts their names.
- **`defineAdapter`** (public adapter API) for any other framework: commands, route discovery, normalizers, ignored attributes, client navigation.
- **Plugins** (`plugins`, `definePlugin`): normalizers, cause detectors, route providers, reporters and adapters.
- **`hydration-proof dev`**: a browser window with an overlay that checks every page you open; highlight the element, open the source line in your editor, copy a Markdown report, re-run.
- **`hydration-proof test --watch`**: keeps the development server running and re-tests the routes each change affects.
- **`hydration-proof ui`**: a local dashboard (127.0.0.1, token-protected) to run tests, follow their output and read the latest report.
- `init` recognizes the new frameworks.
- Inline script contents are no longer compared (frameworks render different code on each side), and inserted or removed scripts are not reported.
- Card numbers are only redacted when they have a card network prefix and length (timestamps were redacted before).
