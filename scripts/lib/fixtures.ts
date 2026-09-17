// Starting the Next.js fixtures (and the CDN proxy in front of them).

import { fileURLToPath } from 'node:url';
import { startServer, type RunningServer } from '../../packages/hydration-proof/src/engine/server.ts';
import { startProxy } from '../../fixtures/cdn-proxy/server.ts';
import { PORTS, SERVER_ENV, type FixtureApp } from '../../fixtures/cases.ts';

export type FixtureMode = 'prod' | 'dev';

export const fixturesDir = fileURLToPath(new URL('../../fixtures/', import.meta.url));

export interface RunningFixture {
  app: FixtureApp;
  mode: FixtureMode;
  url: string;
  proxyUrl: string;
  server: RunningServer;
  stop(): Promise<void>;
}

export async function startFixture(app: FixtureApp, mode: FixtureMode): Promise<RunningFixture> {
  const port = mode === 'prod' ? PORTS[app].prod : PORTS[app].dev;
  // Next.js blocks dev resources for origins other than localhost.
  const url = mode === 'dev' ? `http://localhost:${port}` : `http://127.0.0.1:${port}`;
  const server = await startServer({
    name: `${app} (${mode})`,
    command: mode === 'prod' ? `pnpm exec next start -p ${port}` : `pnpm exec next dev -p ${port}`,
    cwd: `${fixturesDir}${app}`,
    env: { ...SERVER_ENV, PORT: String(port) },
    url,
    timeout: 120_000,
    reuseExisting: false,
  });
  const proxy = await startProxy({ origin: url, port: PORTS[app].proxy + (mode === 'dev' ? 10 : 0) });
  return {
    app,
    mode,
    url,
    proxyUrl: proxy.url,
    server,
    async stop() {
      proxy.close();
      await server.stop();
    },
  };
}
