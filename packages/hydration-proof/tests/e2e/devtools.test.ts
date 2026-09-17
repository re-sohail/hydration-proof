import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startDashboard } from '../../src/dev/dashboard.ts';
import type { Report } from '../../src/report/model.ts';
import { fixturesDir } from '../../../../scripts/lib/fixtures.ts';

// 0.8 developer tools with the Vite SSR fixture: watch mode (built CLI) and a
// dashboard run.

const cli = new URL('../../dist/cli.js', import.meta.url).pathname;
const app = join(fixturesDir, 'vite-ssr');
const ready = existsSync(cli) && existsSync(join(app, 'dist', 'server', 'entry-server.js'));

async function waitFor(check: () => boolean, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe.skipIf(!ready)('developer tools', () => {
  it('re-tests after a change in watch mode and stops cleanly', async () => {
    const child = spawn(process.execPath, [cli, 'test', '--watch', '--route', '/static', '--route', '/date-now', '--reporter', 'list'], {
      cwd: app,
      env: { ...process.env, CI: '', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    const exited = new Promise<number | null>((resolve) => child.on('exit', resolve));
    const file = join(app, 'src', 'pages.jsx');
    const original = readFileSync(file, 'utf8');
    try {
      await waitFor(() => output.includes('Watching for changes'), 120_000);
      expect(output).toContain('── ');
      expect(output).toMatch(/\/date-now .*1 error/);
      writeFileSync(file, `${original}\n// touched by the watch test\n`);
      await waitFor(() => /pages\.jsx changed: all routes/.test(output), 30_000);
      await waitFor(() => (output.match(/\/date-now .*1 error/g) ?? []).length >= 2, 60_000);
    } finally {
      writeFileSync(file, original);
      child.kill('SIGINT');
    }
    expect(await exited).toBe(0);
  });

  it('runs tests from the dashboard and serves the new report', async () => {
    const outputDir = join(app, '.hydration-proof', 'report');
    let log = '';
    const dashboard = await startDashboard({ cwd: app, outputDir, write: (text) => (log += text) });
    try {
      const url = new URL(dashboard.url);
      const token = url.searchParams.get('token')!;
      const events = await fetch(`${url.origin}/events?token=${token}`);
      const reader = events.body!.getReader();
      let stream = '';
      const response = await fetch(`${url.origin}/api/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hydration-proof-token': token },
        body: JSON.stringify({ routes: ['/math-random'] }),
      });
      expect(response.status).toBe(202);
      const busy = await fetch(`${url.origin}/api/run`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hydration-proof-token': token },
        body: '{}',
      });
      expect(busy.status).toBe(409);
      const decoder = new TextDecoder();
      while (!stream.includes('event: done')) {
        const { value, done } = await reader.read();
        if (done) break;
        stream += decoder.decode(value);
      }
      await reader.cancel();
      expect(stream).toContain('event: log');
      expect(stream).toMatch(/event: done\ndata: \{"exitCode":1,"message":"1 page: 1 failed/);
      expect(log).toContain('/math-random');
      const report = JSON.parse(readFileSync(join(outputDir, 'report.json'), 'utf8')) as Report;
      expect(report.pages.map((page) => page.route.pattern)).toEqual(['/math-random']);
    } finally {
      await dashboard.close();
    }
  });
});
