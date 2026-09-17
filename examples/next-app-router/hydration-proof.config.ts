import { defineConfig } from 'hydration-proof';

export default defineConfig({
  server: {
    command: 'pnpm start',
    build: 'pnpm build',
    // Build only when there is no build output yet; use `always` in CI.
    buildWhen: 'if-missing',
    url: 'http://localhost:3000',
  },

  routes: {
    discover: true,
    // Routes discovery cannot see: redirects, rewrites, anything behind a flag.
    paths: ['/pricing?plan=team'],
    // One real value per dynamic segment, or the route is skipped.
    dynamic: {
      '/blog/[slug]': ['hello-world'],
      '/products/[id]': ['1', '42'],
    },
    exclude: ['/api/**', '/admin/**'],
  },

  ignore: {
    // Third-party markup that is expected to differ.
    selectors: ['#ad-slot', '[data-chat-widget]'],
    attributes: [/^data-gtm-/],
    issues: [
      {
        code: 'HP4001',
        route: '/checkout',
        reason: 'The payment iframe rewrites its container. Ticket ACME-431.',
        expires: '2026-12-31',
      },
    ],
  },
});
