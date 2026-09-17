import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, normalize, relative, resolve, sep } from 'node:path';
import type { CliOverrides } from '../config/resolve.ts';
import type { BuildMode } from '../config/types.ts';
import type { Report } from '../report/model.ts';
import { run, RunError } from '../run.ts';

// `hydration-proof ui`: a local dashboard. It runs tests in this process,
// streams their output, and shows the latest HTML report. It listens on
// 127.0.0.1 only and every request needs the random token from the URL.

export interface DashboardOptions {
  cwd: string;
  config?: string;
  port?: number;
  /** Where the latest report is read from (the config's outputDir). */
  outputDir: string;
  write(text: string): void;
}

export interface Dashboard {
  url: string;
  close(): Promise<void>;
}

export interface RunRequest {
  routes?: string[];
  mode?: BuildMode | 'both';
  scenarios?: string[];
  probe?: boolean;
  interactions?: boolean;
  navigation?: boolean;
  grep?: string;
}

const ANSI = /\x1b\[[0-9;]*m/g;
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

function same(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Validate a run request from the page; unknown fields are rejected. */
export function parseRunRequest(body: unknown): CliOverrides {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new Error('Expected a JSON object.');
  const input = body as Record<string, unknown>;
  const allowed = new Set(['routes', 'mode', 'scenarios', 'probe', 'interactions', 'navigation', 'grep']);
  for (const key of Object.keys(input)) if (!allowed.has(key)) throw new Error(`Unknown option "${key}".`);
  const overrides: CliOverrides = {};
  const strings = (key: string): string[] | undefined => {
    const value = input[key];
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.length > 500)) throw new Error(`"${key}" must be a list of strings.`);
    return (value as string[]).map((entry) => entry.trim()).filter(Boolean);
  };
  const routes = strings('routes');
  if (routes?.length) overrides.routes = routes.map((route) => (route.startsWith('/') ? route : `/${route}`));
  const scenarios = strings('scenarios');
  if (scenarios?.length) overrides.scenarios = scenarios;
  if (input['mode'] !== undefined) {
    if (input['mode'] !== 'production' && input['mode'] !== 'development' && input['mode'] !== 'both') throw new Error('"mode" must be production, development or both.');
    overrides.mode = input['mode'];
  }
  for (const flag of ['probe', 'interactions', 'navigation'] as const) {
    if (input[flag] === undefined) continue;
    if (typeof input[flag] !== 'boolean') throw new Error(`"${flag}" must be true or false.`);
    if (flag === 'probe') overrides.probes = input[flag];
    else overrides[flag] = input[flag];
  }
  if (input['grep'] !== undefined) {
    if (typeof input['grep'] !== 'string' || input['grep'].length > 200) throw new Error('"grep" must be a short string.');
    if (input['grep']) overrides.grep = input['grep'];
  }
  return overrides;
}

function page(token: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self'; img-src 'self' data:">
<meta name="color-scheme" content="light dark">
<title>Hydration Proof dashboard</title>
<style>
:root { --bg: #f7f7f8; --panel: #fff; --text: #1b1d22; --muted: #5f6570; --border: #dfe1e6; --accent: #2d6cdf; --ok: #1d7a46; --error: #c62a2a; }
@media (prefers-color-scheme: dark) { :root { --bg: #111317; --panel: #1a1d22; --text: #e7e9ee; --muted: #9aa1ad; --border: #2e333b; --accent: #6c9cff; --ok: #5fd08f; --error: #ff7a7a; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; display: grid; grid-template-rows: auto auto 1fr; height: 100vh; }
header { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 12px 16px; background: var(--panel); border-bottom: 1px solid var(--border); }
header h1 { font-size: 16px; margin: 0 12px 0 0; }
input, select, button { font: inherit; color: inherit; background: var(--bg); border: 1px solid var(--border); border-radius: 6px; padding: 5px 9px; }
input[type=text] { min-width: 220px; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button:disabled { opacity: .5; }
label { display: inline-flex; gap: 5px; align-items: center; color: var(--muted); }
#status { margin-left: auto; color: var(--muted); }
#status.ok { color: var(--ok); } #status.failed { color: var(--error); }
pre { margin: 0; max-height: 28vh; overflow: auto; padding: 10px 16px; background: var(--panel); border-bottom: 1px solid var(--border); font: 12px/1.45 ui-monospace, Menlo, monospace; white-space: pre-wrap; }
pre:empty { display: none; }
iframe { width: 100%; height: 100%; border: 0; background: var(--bg); }
</style>
</head>
<body>
<header>
  <h1>Hydration Proof</h1>
  <input type="text" id="routes" placeholder="Routes (e.g. /pricing /blog/1), empty for all" aria-label="Routes">
  <select id="mode" aria-label="Build"><option value="">Build from config</option><option value="production">Production</option><option value="development">Development</option><option value="both">Both</option></select>
  <label><input type="checkbox" id="probe"> Prove causes</label>
  <label><input type="checkbox" id="interactions"> Interactions</label>
  <label><input type="checkbox" id="navigation"> Navigation</label>
  <button class="primary" id="run" type="button">Run</button>
  <button id="stop" type="button" disabled>Stop</button>
  <span id="status" role="status">Idle</span>
</header>
<pre id="log" aria-live="polite"></pre>
<iframe id="report" title="Latest report" src="/report/${token}/report.html"></iframe>
<script>
const token = ${JSON.stringify(token)};
const $ = (id) => document.getElementById(id);
const log = $('log');
const setRunning = (running) => { $('run').disabled = running; $('stop').disabled = !running; };
const post = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hydration-proof-token': token }, body: JSON.stringify(body ?? {}) });
$('run').addEventListener('click', async () => {
  const body = {};
  const routes = $('routes').value.split(/[\\s,]+/).filter(Boolean);
  if (routes.length) body.routes = routes;
  if ($('mode').value) body.mode = $('mode').value;
  for (const flag of ['probe', 'interactions', 'navigation']) if ($(flag).checked) body[flag] = true;
  log.textContent = '';
  const response = await post('/api/run', body);
  if (!response.ok) { $('status').textContent = await response.text(); $('status').className = 'failed'; }
});
$('stop').addEventListener('click', () => post('/api/stop'));
const events = new EventSource('/events?token=' + encodeURIComponent(token));
events.addEventListener('log', (event) => { log.textContent += JSON.parse(event.data); log.scrollTop = log.scrollHeight; });
events.addEventListener('state', (event) => {
  const state = JSON.parse(event.data);
  setRunning(state.running);
  const status = $('status');
  if (state.running) { status.textContent = 'Running…'; status.className = ''; return; }
  if (!state.last) { status.textContent = 'Idle'; status.className = ''; return; }
  status.textContent = state.last.message;
  status.className = state.last.exitCode === 0 ? 'ok' : 'failed';
});
events.addEventListener('done', () => { $('report').src = '/report/' + token + '/report.html?' + Date.now(); });
</script>
</body>
</html>`;
}

const PLACEHOLDER = `<!doctype html><meta charset="utf-8"><meta name="color-scheme" content="light dark"><body style="font:14px system-ui;padding:24px;color:#888">No report yet. Press Run.</body>`;

export async function startDashboard(options: DashboardOptions): Promise<Dashboard> {
  const token = randomBytes(18).toString('base64url');
  const clients = new Set<ServerResponse>();
  let controller: AbortController | undefined;
  let last: { exitCode: number; message: string } | undefined;
  let port = 0;

  const broadcast = (event: string, data: unknown): void => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) client.write(payload);
  };
  const state = (): { running: boolean; last?: { exitCode: number; message: string } } => ({ running: controller !== undefined, ...(last ? { last } : {}) });

  const startRun = (overrides: CliOverrides): void => {
    controller = new AbortController();
    const signal = controller.signal;
    broadcast('state', state());
    const write = (text: string): void => {
      options.write(text);
      broadcast('log', text.replace(ANSI, ''));
    };
    void run({ cwd: options.cwd, ...(options.config !== undefined ? { config: options.config } : {}), overrides, write, signal })
      .then((result) => {
        const summary = (result.report as Report).summary;
        last = {
          exitCode: result.exitCode,
          message: `${summary.pages} page${summary.pages === 1 ? '' : 's'}: ${summary.failed + summary.errored} failed, ${summary.warnings} with warnings, ${summary.passed} passed`,
        };
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        last = { exitCode: error instanceof RunError ? error.exitCode : 70, message: signal.aborted ? 'Stopped' : message.split('\n')[0]! };
        write(`\nError: ${message}\n`);
      })
      .finally(() => {
        controller = undefined;
        broadcast('state', state());
        broadcast('done', last);
      });
  };

  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
    const host = request.headers.host ?? '';
    // DNS rebinding protection: only our own host names.
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) {
      response.writeHead(403).end('Forbidden host');
      return;
    }
    const send = (status: number, body: string, type = 'text/plain; charset=utf-8'): void => {
      response.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
      response.end(body);
    };

    const reportPrefix = `/report/${token}/`;
    if (request.method === 'GET' && url.pathname.startsWith('/report/')) {
      if (!url.pathname.startsWith(reportPrefix)) return send(403, 'Forbidden');
      const name = decodeURIComponent(url.pathname.slice(reportPrefix.length));
      const root = resolve(options.outputDir);
      const file = normalize(join(root, name));
      if (relative(root, file).startsWith('..') || !file.startsWith(root + sep)) return send(403, 'Forbidden');
      if (!existsSync(file) || !statSync(file).isFile()) return name === 'report.html' ? send(200, PLACEHOLDER, MIME['.html']) : send(404, 'Not found');
      const type = MIME[extname(file).toLowerCase()];
      if (!type) return send(403, 'Forbidden');
      response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      response.end(readFileSync(file));
      return;
    }

    const queryToken = url.searchParams.get('token') ?? '';
    if (request.method === 'GET' && url.pathname === '/') {
      if (!same(queryToken, token)) return send(403, 'Open the URL printed in the terminal (it contains the access token).');
      return send(200, page(token), MIME['.html']);
    }
    if (request.method === 'GET' && url.pathname === '/events') {
      if (!same(queryToken, token)) return send(403, 'Forbidden');
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      response.write(`event: state\ndata: ${JSON.stringify(state())}\n\n`);
      clients.add(response);
      request.on('close', () => clients.delete(response));
      return;
    }
    if (request.method === 'POST' && url.pathname.startsWith('/api/')) {
      const header = request.headers['x-hydration-proof-token'];
      if (typeof header !== 'string' || !same(header, token)) return send(403, 'Forbidden');
      const origin = request.headers.origin;
      if (origin !== undefined && origin !== `http://${host}`) return send(403, 'Forbidden origin');
      if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) return send(415, 'JSON expected');
      let raw = '';
      for await (const chunk of request) {
        raw += String(chunk);
        if (raw.length > 10_000) return send(413, 'Too large');
      }
      if (url.pathname === '/api/stop') {
        controller?.abort();
        return send(202, 'Stopping');
      }
      if (url.pathname === '/api/run') {
        if (controller) return send(409, 'A run is already in progress.');
        let overrides: CliOverrides;
        try {
          overrides = parseRunRequest(raw ? JSON.parse(raw) : {});
        } catch (error) {
          return send(400, error instanceof Error ? error.message : 'Bad request');
        }
        startRun(overrides);
        return send(202, 'Started');
      }
    }
    send(404, 'Not found');
  };

  const server = createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      if (!response.headersSent) response.writeHead(500).end(error instanceof Error ? error.message : 'Error');
    });
  });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(options.port ?? 0, '127.0.0.1', () => done());
  });
  port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/?token=${token}`,
    async close() {
      controller?.abort();
      for (const client of clients) client.end();
      await new Promise<void>((done) => server.close(() => done()));
    },
  };
}
