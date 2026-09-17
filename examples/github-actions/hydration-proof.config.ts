import { defineConfig } from 'hydration-proof';

export default defineConfig({
  server: {
    command: 'pnpm start',
    build: 'pnpm build',
    // Always build in CI: there is no build output to reuse.
    buildWhen: 'always',
    url: 'http://localhost:3000',
  },
  routes: { discover: true, exclude: ['/api/**'] },

  // The github reporter is added automatically when GITHUB_ACTIONS is set.
  reporters: ['list', 'json', 'html', 'sarif'],

  ci: {
    failOn: 'error',
    // Green from day one: only findings that are not in the baseline fail.
    newIssuesOnly: true,
    baseline: '.hydration-proof/baseline.json',
    // The ratchet: the numbers may only go down.
    budget: {
      error: 0,
      warning: 12,
      routes: { '/checkout/**': { error: 0, warning: 0 } },
      codes: { HP1004: 3 },
    },
    history: true,
  },

  // Who gets pinged, from CODEOWNERS unless the route says otherwise.
  owners: {
    routes: { '/checkout/**': ['@acme/payments'] },
    codeowners: true,
  },
});
