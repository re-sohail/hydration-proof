# Frameworks and adapters

An adapter tells hydration-proof how to build and start an app, where its routes are, and which markup the framework adds that is not page content. The adapter is chosen from `package.json` (`adapter: 'auto'`, the default), or set it yourself:

```ts
export default defineConfig({ adapter: 'react-router' });
```

| Adapter | Detected by | Build / start / dev | Routes | Client navigation |
| --- | --- | --- | --- | --- |
| `next` | `next` dependency or `next.config.*` | `next build` / `next start` / `next dev` | `app/` and `pages/`, plus pages the build pre-rendered | `router.push` (App and Pages Router) |
| `react-router` | `@react-router/dev` or `react-router.config.*` | `react-router build` / `react-router-serve ./build/server/index.js` / `react-router dev` | `react-router routes --json` | `window.__reactRouterDataRouter.navigate` |
| `remix` | `@remix-run/dev` | `remix vite:build` / `remix-serve ./build/server/index.js` / `remix vite:dev` (the classic compiler is supported too) | `remix routes --json` | `window.__remixRouter.navigate` |
| `astro` | `astro` or `astro.config.*` | `astro build` / `node ./dist/server/entry.mjs` with `@astrojs/node`, otherwise `astro preview` / `astro dev` | `src/pages` | — |
| `vite` | `vite` and `react-dom`, plus `server.js` or `src/entry-server.*` | the `build`, `start` (or `serve`, `preview`) and `dev` scripts | from the config | — |
| `node` | `react-dom` and a `start` script (Express, Fastify, `node:http`, streaming or not) | the `build`, `start` and `dev` scripts | from the config | — |
| `none` | fallback | `server.command` / `server.build` | from the config | — |

Every adapter can be overridden: `server.command`, `server.build`, `server.devCommand` and `routes` always win.

Dynamic routes use one syntax for all frameworks: `[id]`, `[...slug]` (catch-all) and `[[lang]]` (optional). React Router's `:id`, `*` and `:lang?` and Astro's `[id]` and `[...slug]` are converted, so `routes.dynamic` looks the same everywhere:

```ts
routes: { dynamic: { '/products/[id]': ['1', '42'] } }
```

## Astro islands

Each `<astro-island>` hydrates as its own React root, so findings are reported per island. Astro changes island attributes (`ssr`, `props`, `client`, ...) while it loads them; these are never compared. Islands that use `useId` need an `identifierPrefix` (Astro sets one); without it hydration-proof reports HP3004.

## Custom React servers

For Express or any other server that renders React, use the `node` adapter (or `none`) with your own commands:

```ts
export default defineConfig({
  adapter: 'node',
  server: {
    build: 'npm run build',
    command: 'node server.js',   // listens on process.env.PORT
    devCommand: 'node --watch server.js',
  },
  routes: { paths: ['/', '/pricing', '/products/1'] },
});
```

Streaming servers (`renderToPipeableStream`, `renderToReadableStream`) are supported: Suspense boundaries that hydrate later are compared on their own.

## Writing an adapter

Frameworks hydration-proof does not know can be added with `defineAdapter`, directly in the config or in a plugin:

```ts
import { defineAdapter, defineConfig } from 'hydration-proof';

const waku = defineAdapter({
  name: 'waku',
  detect: (rootDir) => existsSync(join(rootDir, 'waku.config.ts')),
  commands: ({ packageManager }) => ({
    build: 'waku build',
    start: 'waku start --port {port}',
    dev: 'waku dev --port {port}',
    buildOutput: 'dist/index.js',
  }),
  discoverRoutes: ({ rootDir }) => [
    { pattern: '/', dynamic: false, router: 'app', file: 'src/pages/index.tsx' },
  ],
  normalizers: [
    { name: 'waku-data', match: (node) => (node.k === 1 && node.tag === 'script' && node.attrs.some(([name]) => name === 'data-waku') ? 'drop' : undefined) },
  ],
  navigation: { navigate: `(url) => { window.__WAKU_ROUTER__?.push(url); return Boolean(window.__WAKU_ROUTER__); }` },
  notFound: true,
});

export default defineConfig({ adapter: waku });
```

| Field | Description |
| --- | --- |
| `name` | Shown in reports; `adapter: '<name>'` selects a plugin adapter |
| `detect(rootDir)` | Used by `adapter: 'auto'` (plugin adapters are tried before the built-in ones) |
| `commands({ rootDir, packageManager })` | `build`, `start`, `dev`, `buildOutput` (a file that exists after a build) and `env`. `{port}` is replaced and `PORT` is set |
| `discoverRoutes({ rootDir, packageManager })` | Routes with `pattern`, `dynamic`, `file` (relative to the project) and optionally `wrappers` (layout files, used by `--changed`) |
| `normalizers` | Markup to ignore: return `'drop'` to remove a node, `'opaque'` to keep an element but not compare its content |
| `ignoreAttributes`, `elementAttributes` | Attributes never compared, everywhere or only on some elements (`{ 'astro-island': ['ssr'] }`) |
| `devHost` | Host for the development server (Next.js needs `localhost`) |
| `navigation` | Page function sources that start a client navigation (`navigate`) and a prefetch (`prefetch`); return `false` when the router is missing |
| `notFound` | Also load a URL that does not exist and check the not-found page |

The adapter API is stable from 1.0; until then it can change in minor versions, with notes in the changelog.
