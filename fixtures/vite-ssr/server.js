// SSR server on node:http. Development: Vite in middleware mode.
// Production (NODE_ENV=production): serves dist/client and streams HTML
// rendered by the built dist/server/entry-server.js.

import { createServer } from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const isProduction = process.env.NODE_ENV === 'production';
const port = Number(process.env.PORT ?? 5175);
const root = fileURLToPath(new URL('.', import.meta.url));
const clientDir = join(root, 'dist', 'client');
const ABORT_DELAY = 10_000;

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
};

const server = createServer();

let vite;
let productionTemplate;
if (isProduction) {
  productionTemplate = readFileSync(join(clientDir, 'index.html'), 'utf8');
} else {
  const { createServer: createViteServer } = await import('vite');
  vite = await createViteServer({
    root,
    appType: 'custom',
    // Attach the HMR websocket to this server instead of a fixed extra port.
    server: { middlewareMode: true, hmr: { server } },
  });
}

/** Serves a built asset from dist/client; returns false when there is none. */
function serveStatic(pathname, res) {
  if (pathname === '/' || pathname === '/index.html') return false;
  const file = normalize(join(clientDir, decodeURIComponent(pathname)));
  if (!file.startsWith(clientDir + sep) || !existsSync(file) || !statSync(file).isFile()) return false;
  res.writeHead(200, {
    'content-type': contentTypes[extname(file)] ?? 'application/octet-stream',
    'cache-control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(file).pipe(res);
  return true;
}

async function renderPage(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let template;
  let entry;
  if (isProduction) {
    template = productionTemplate;
    entry = await import('./dist/server/entry-server.js');
  } else {
    template = await vite.transformIndexHtml(url.pathname, readFileSync(join(root, 'index.html'), 'utf8'));
    entry = await vite.ssrLoadModule('/src/entry-server.jsx');
  }

  const status = entry.matchRoute(url.pathname) ? 200 : 404;
  const [htmlStart, htmlEnd] = template.split('<!--app-html-->');
  let failed = false;

  const { pipe, abort } = entry.render(url.pathname, {
    onShellReady() {
      res.writeHead(failed ? 500 : status, { 'content-type': 'text/html; charset=utf-8' });
      res.write(htmlStart);
      // Forward React's chunks as they come, then close the document.
      const body = new Writable({
        write(chunk, _encoding, callback) {
          res.write(chunk, callback);
        },
        final(callback) {
          res.end(htmlEnd);
          callback();
        },
      });
      pipe(body);
    },
    onShellError(error) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(String(error?.stack ?? error));
    },
    onError(error) {
      failed = true;
      console.error(error);
    },
  });
  setTimeout(abort, ABORT_DELAY).unref();
}

server.on('request', (req, res) => {
  const handle = async () => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (isProduction && serveStatic(pathname, res)) return;
    await renderPage(req, res);
  };
  const fail = (error) => {
    vite?.ssrFixStacktrace(error);
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(error?.stack ?? error));
  };
  if (vite) {
    vite.middlewares(req, res, () => handle().catch(fail));
  } else {
    handle().catch(fail);
  }
});

server.listen(port, () => {
  console.log(`vite-ssr (${isProduction ? 'production' : 'development'}) listening on http://localhost:${port}`);
});
