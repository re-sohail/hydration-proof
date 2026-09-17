// Usage: ORIGIN=http://127.0.0.1:3100 PORT=3101 REWRITE=whitespace node server.ts
// Prints "ready <url>" once listening.
//
// Like CDN "auto minify" features, the proxy buffers HTML responses and
// rewrites them before they reach the browser. Other responses pass through.

import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http';
import { connect, type AddressInfo } from 'node:net';

export type Rewrite = 'whitespace' | 'email';

export function rewriteHtml(html: string, rewrites: readonly Rewrite[]): string {
  let out = html;
  if (rewrites.includes('whitespace')) {
    // Collapse whitespace between tags, including React's text separators.
    out = out.replace(/>\s+</g, '><');
  }
  if (rewrites.includes('email')) {
    out = out.replace(
      /([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
      '<a href="/cdn-cgi/l/email-protection" class="__cf_email__" data-cfemail="0">[email&#160;protected]</a>',
    );
  }
  return out;
}

export interface ProxyOptions {
  origin: string;
  port?: number;
  rewrites?: Rewrite[];
}

export async function startProxy(options: ProxyOptions): Promise<{ url: string; close(): void }> {
  const origin = new URL(options.origin);
  const rewrites = options.rewrites ?? ['whitespace'];
  const server = createServer((req, res) => {
    const headers: IncomingHttpHeaders = { ...req.headers, host: origin.host, 'accept-encoding': 'identity' };
    const upstream = httpRequest(
      { hostname: origin.hostname, port: origin.port, path: req.url, method: req.method, headers },
      (response) => {
        const type = String(response.headers['content-type'] ?? '');
        const responseHeaders = { ...response.headers, 'x-cdn-proxy': 'hydration-proof-fixture', server: 'fixture-cdn' };
        if (!type.includes('text/html')) {
          res.writeHead(response.statusCode ?? 502, responseHeaders);
          response.pipe(res);
          return;
        }
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          const body = rewriteHtml(Buffer.concat(chunks).toString('utf8'), rewrites);
          delete responseHeaders['content-length'];
          delete responseHeaders['transfer-encoding'];
          res.writeHead(response.statusCode ?? 502, responseHeaders);
          res.end(body);
        });
      },
    );
    upstream.on('error', (error) => {
      res.writeHead(502, { 'content-type': 'text/plain' });
      res.end(String(error));
    });
    req.pipe(upstream);
  });
  // WebSocket upgrades (Next.js dev HMR) are tunnelled unchanged.
  server.on('upgrade', (req, socket, head) => {
    const upstream = connect(Number(origin.port || 80), origin.hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const name = req.rawHeaders[i] ?? '';
        const value = name.toLowerCase() === 'host' ? origin.host : req.rawHeaders[i + 1];
        lines.push(`${name}: ${value}`);
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`);
      if (head.length > 0) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    const close = (): void => {
      socket.destroy();
      upstream.destroy();
    };
    upstream.on('error', close);
    socket.on('error', close);
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}`, close: () => server.close() };
}

if (import.meta.main) {
  const origin = process.env.ORIGIN;
  if (!origin) throw new Error('Set ORIGIN to the upstream server URL.');
  const rewrites = (process.env.REWRITE ?? 'whitespace').split(',') as Rewrite[];
  const proxy = await startProxy({ origin, port: Number(process.env.PORT ?? 0), rewrites });
  console.log(`ready ${proxy.url}`);
}
