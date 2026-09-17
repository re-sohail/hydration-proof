// Minimal SSR server used by the browser tests and as the "custom SSR"
// e2e fixture. React modules are injected by the version-specific harness.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { createPages, type ReactLike } from './pages.ts';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface HarnessDeps {
  React: ReactLike;
  ReactDOMServer: {
    renderToString: (element: any, options?: { identifierPrefix?: string }) => string;
    renderToPipeableStream: (element: any, options: any) => { pipe: (destination: NodeJS.WritableStream) => void };
  };
  clientFile: string;
  label: string;
}

function shellStart(page: string, head: string, label: string): string {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${page} (${label})</title>${head}</head><body><div id="root">`;
}

function shellEnd(page: string, bodyEnd = '', second = ''): string {
  return `</div>${second}${bodyEnd}<script>window.__PAGE__=${JSON.stringify(page)}</script><script src="/client.js" defer></script></body></html>`;
}

export async function startHarness(deps: HarnessDeps, port = 0): Promise<{ url: string; server: Server }> {
  const pages = createPages(deps.React);
  const clientSource = readFileSync(deps.clientFile, 'utf8');
  const h = deps.React.createElement;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/client.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
      res.end(clientSource);
      return;
    }
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    const name = url.pathname.slice(1) || 'ok';
    const page = pages[name];
    if (!page) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    pages['reset-suspense']?.App({});
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.write(shellStart(name, page.head ?? '', deps.label));

    if (page.clientOnly) {
      res.end(shellEnd(name, page.bodyEnd));
      return;
    }
    if (!page.stream) {
      const second = page.second
        ? `<div id="root2">${deps.ReactDOMServer.renderToString(h(page.second), page.secondPrefix ? { identifierPrefix: page.secondPrefix } : {})}</div>`
        : '';
      res.end(deps.ReactDOMServer.renderToString(h(page.App)) + shellEnd(name, page.bodyEnd, second));
      return;
    }
    const forward = new Writable({
      write(chunk, _encoding, callback) {
        res.write(chunk, callback);
      },
      final(callback) {
        res.end(shellEnd(name, page.bodyEnd));
        callback();
      },
    });
    const stream = deps.ReactDOMServer.renderToPipeableStream(h(page.App), {
      onShellReady() {
        stream.pipe(forward);
      },
      onShellError(error: unknown) {
        res.statusCode = 500;
        res.end(String(error));
      },
    });
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}`, server };
}
