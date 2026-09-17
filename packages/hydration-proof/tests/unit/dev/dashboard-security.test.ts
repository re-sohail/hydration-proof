import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startDashboard, type Dashboard } from '../../../src/dev/dashboard.ts';

// The dashboard is only meant for the machine it runs on, so a page the user
// happens to have open must not be able to reach it. Nothing here starts a run.

describe('dashboard access control', () => {
  let dir: string;
  let dashboard: Dashboard;
  let origin: string;
  let token: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'hp-dashboard-'));
    const outputDir = join(dir, 'report');
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, 'report.html'), '<!doctype html>report');
    writeFileSync(join(outputDir, 'report.json'), '{}');
    writeFileSync(join(outputDir, 'notes.txt'), 'not served');
    writeFileSync(join(dir, 'secret.txt'), 'outside the output folder');
    dashboard = await startDashboard({ cwd: dir, outputDir, write: () => {} });
    const url = new URL(dashboard.url);
    origin = url.origin;
    token = url.searchParams.get('token')!;
  });

  afterAll(async () => {
    await dashboard.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** A raw request, because `fetch` refuses to send a `Host` header. */
  const raw = (path: string, host: string): Promise<{ status: number; body: string }> =>
    new Promise((done, fail) => {
      const url = new URL(dashboard.url);
      const call = httpRequest({ host: '127.0.0.1', port: url.port, path, headers: { host } }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => (body += chunk));
        response.on('end', () => done({ status: response.statusCode ?? 0, body }));
      });
      call.on('error', fail);
      call.end();
    });

  it('binds to the loopback address with a token in the URL', () => {
    expect(new URL(dashboard.url).hostname).toBe('127.0.0.1');
    // 18 random bytes, base64url.
    expect(token).toMatch(/^[A-Za-z0-9_-]{24}$/);
  });

  it('serves the page only with the right token', async () => {
    expect((await fetch(`${origin}/`)).status).toBe(403);
    expect((await fetch(`${origin}/?token=wrong`)).status).toBe(403);
    // A prefix of the real token is not enough.
    expect((await fetch(`${origin}/?token=${token.slice(0, -1)}`)).status).toBe(403);
    const ok = await fetch(`${origin}/?token=${token}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toContain('text/html');
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(ok.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('refuses a Host header that is not its own (DNS rebinding)', async () => {
    const port = new URL(dashboard.url).port;
    for (const host of ['attacker.example', `attacker.example:${port}`, '127.0.0.1', `127.0.0.1:${Number(port) + 1}`]) {
      const response = await raw(`/?token=${token}`, host);
      expect(response.status, host).toBe(403);
      expect(response.body).toBe('Forbidden host');
    }
    // Its own two names are the only ones it answers to, and the host is checked
    // before the token, so even a valid token does not get past it.
    expect((await raw(`/?token=${token}`, `127.0.0.1:${port}`)).status).toBe(200);
    expect((await raw(`/?token=${token}`, `localhost:${port}`)).status).toBe(200);
    expect((await raw('/report/x/report.html', 'attacker.example')).status).toBe(403);
  });

  it('requires the token in a header for POST /api/*, and refuses a foreign Origin', async () => {
    const post = (headers: Record<string, string>, body = '{}'): Promise<Response> =>
      fetch(`${origin}/api/stop`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
    // The token in the query string does not authorize a state change.
    expect((await fetch(`${origin}/api/stop?token=${token}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status).toBe(403);
    expect((await post({})).status).toBe(403);
    expect((await post({ 'x-hydration-proof-token': 'wrong' })).status).toBe(403);
    const foreign = await post({ 'x-hydration-proof-token': token, origin: 'http://evil.example' });
    expect(foreign.status).toBe(403);
    expect(await foreign.text()).toBe('Forbidden origin');
    // A form post cannot set the header, and would not be JSON either.
    const form = await post({ 'x-hydration-proof-token': token, 'content-type': 'application/x-www-form-urlencoded' });
    expect(form.status).toBe(415);
    // With the header and its own origin it is accepted (no run is in progress, so this is a no-op).
    expect((await post({ 'x-hydration-proof-token': token, origin })).status).toBe(202);
  });

  it('rejects an oversized body', async () => {
    const response = await fetch(`${origin}/api/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hydration-proof-token': token },
      body: JSON.stringify({ routes: ['/'.padEnd(20_000, 'a')] }),
    });
    expect(response.status).toBe(413);
  });

  it('serves report files from the output folder only', async () => {
    expect((await fetch(`${origin}/report/${token}/report.html`)).status).toBe(200);
    // Wrong token, no files.
    expect((await fetch(`${origin}/report/wrong/report.html`)).status).toBe(403);
    expect((await fetch(`${origin}/report/report.html`)).status).toBe(403);
    // No escaping the folder, encoded or not.
    for (const path of ['../secret.txt', '..%2Fsecret.txt', '%2e%2e%2fsecret.txt', 'a/../../secret.txt']) {
      const response = await fetch(`${origin}/report/${token}/${path}`, { redirect: 'manual' });
      expect([403, 404]).toContain(response.status);
      expect(await response.text()).not.toContain('outside the output folder');
    }
    // Only known media types, even inside the folder.
    expect((await fetch(`${origin}/report/${token}/notes.txt`)).status).toBe(403);
    expect((await fetch(`${origin}/report/${token}/missing.json`)).status).toBe(404);
  });

  it('streams events only with the token', async () => {
    expect((await fetch(`${origin}/events`)).status).toBe(403);
    const events = await fetch(`${origin}/events?token=${token}`);
    expect(events.status).toBe(200);
    expect(events.headers.get('content-type')).toContain('text/event-stream');
    await events.body!.cancel();
  });

  it('has no other routes', async () => {
    expect((await fetch(`${origin}/index.php?token=${token}`)).status).toBe(404);
    expect((await fetch(`${origin}/api/run?token=${token}`)).status).toBe(404);
  });
});
