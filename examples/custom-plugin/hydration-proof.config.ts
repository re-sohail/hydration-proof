import { defineConfig, definePlugin } from 'hydration-proof';

const acme = definePlugin({
  name: 'acme',

  normalizers: [
    // The support widget injects itself after load: never compare it.
    {
      name: 'support-chat',
      match: (node) => (node.k === 1 && node.tag === 'acme-chat' ? 'drop' : undefined),
    },
    // The experiment script's body changes per request, but the tag has to be
    // in the right place, so keep the element and ignore its contents.
    {
      name: 'experiment-script',
      match: (node) =>
        node.k === 1 && node.tag === 'script' && node.attrs.some(([name, value]) => name === 'data-acme' && value === 'experiments')
          ? 'opaque'
          : undefined,
    },
  ],
  // Analytics writes these in an effect; they are never a mismatch.
  ignoreAttributes: [/^data-track-/],

  detectors: [
    {
      name: 'geo-header',
      detect: (issue) =>
        issue.selector?.includes('[data-region]') && issue.server !== issue.client
          ? {
              id: 'geo-header',
              title: 'Region resolved from a header on the server',
              confidence: 0.9,
              reason: 'The server reads x-acme-region; the browser falls back to the default region.',
              fixes: ['Pass the region from the server as a prop instead of resolving it again on the client.'],
              docsUrl: 'https://wiki.acme.test/geo',
            }
          : undefined,
    },
  ],

  routes: [
    {
      name: 'cms',
      // The app is already running, so ask it which pages exist.
      routes: async ({ baseUrl }) => {
        const response = await fetch(`${baseUrl}/api/pages`);
        if (!response.ok) throw new Error(`The CMS route list failed: ${response.status}`);
        return ((await response.json()) as { path: string }[]).map((page) => page.path);
      },
    },
  ],

  reporters: [
    {
      name: 'slack',
      onEnd: async (report) => {
        if (report.summary.failed === 0 || !process.env.SLACK_WEBHOOK) return;
        await fetch(process.env.SLACK_WEBHOOK, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: `${report.summary.failed} pages have hydration problems on ${report.run.branch ?? 'unknown'}` }),
        });
      },
    },
  ],
});

export default defineConfig({
  server: { command: 'pnpm start', build: 'pnpm build', url: 'http://localhost:3000' },
  routes: { discover: true },
  plugins: [acme],
});
