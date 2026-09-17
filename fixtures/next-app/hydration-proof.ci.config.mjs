// Team workflow checks (e2e tests): baseline, owners, redaction, history.
export default {
  server: { env: { TZ: 'UTC', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } },
  routes: { paths: ['/date-now', '/api-data', '/static'], notFound: false },
  owners: { routes: { '/date-now': ['@acme/time'] }, codeowners: false },
  redact: { patterns: [/Visits/] },
  ci: {
    baseline: '.hydration-proof/ci/baseline.json',
    history: '.hydration-proof/ci/history.ndjson',
  },
  reporters: ['list', 'json', 'html'],
  outputDir: '.hydration-proof/ci/report',
};
