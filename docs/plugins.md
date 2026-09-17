# Plugins

Plugins add knowledge about your app, your libraries or your infrastructure:

```ts
import { defineConfig, definePlugin } from 'hydration-proof';

const acme = definePlugin({
  name: 'acme',

  // Markup to leave out of every comparison.
  normalizers: [
    { name: 'support-chat', match: (node) => (node.k === 1 && node.tag === 'acme-chat' ? 'drop' : undefined) },
  ],
  ignoreAttributes: [/^data-track-/],

  // Explain findings with knowledge about the app.
  detectors: [
    {
      name: 'feature-flags',
      detect: (issue) =>
        issue.client?.includes('beta')
          ? { id: 'feature-flag', title: 'Feature flag read on the client', confidence: 0.85, reason: 'Beta text only appears in the browser.', fixes: ['Read flags on the server and pass them down.'] }
          : undefined,
    },
  ],

  // More routes, from anywhere.
  routes: [
    {
      name: 'cms',
      routes: async ({ baseUrl }) => {
        const response = await fetch(`${baseUrl}/api/pages`);
        return ((await response.json()) as { path: string }[]).map((page) => page.path);
      },
    },
  ],

  // Send results somewhere.
  reporters: [
    {
      name: 'slack',
      onEnd: async (report) => {
        if (report.summary.failed === 0) return;
        await fetch(process.env.SLACK_WEBHOOK!, { method: 'POST', body: JSON.stringify({ text: `${report.summary.failed} pages have hydration problems` }) });
      },
    },
  ],

  // Frameworks (see Adapters).
  adapters: [],
});

export default defineConfig({ plugins: [acme] });
```

| Field | Called with | Returns |
| --- | --- | --- |
| `normalizers[].match` | a serialized DOM node (`k` 1 element, 3 text, 8 comment; elements have `tag`, `attrs`, `children`) and its parent | `'drop'`, `'opaque'` or `undefined` |
| `detectors[].detect` | the finding (read only) and `{ source, scenario }` | `{ id, title, confidence, reason?, fixes?, docsUrl? }` or `undefined`. The most confident cause wins; causes proven by probes are kept. A detector that throws is reported as evidence, not as a failure |
| `routes[].routes` | `{ rootDir, baseUrl }` (the app is running) | paths or route objects. Routes a provider adds have `source: 'plugin'`. A provider that fails adds a note |
| `reporters[]` | `onBegin(context)`, `onPage(page, issues, context)`, `onEnd(report, context)` | `onEnd` may return the files it wrote |
| `adapters[]` | see [Adapters](adapters.md) | |

Plugins run in the order they are listed. Plugin names must be unique.
