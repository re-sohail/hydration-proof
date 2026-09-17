// Navigation into an intercepting route (a modal) is expected to differ (e2e tests).
export default {
  server: { env: { TZ: 'UTC', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } },
  routes: {
    discover: true,
    include: ['/gallery/photo/**'],
    dynamic: { '/gallery/photo/[id]': ['1'] },
    paths: [{ path: '/gallery/photo/1', pattern: '/gallery/photo/[id]', navigateFrom: '/gallery' }],
    notFound: false,
  },
  checks: { navigation: { prefetch: false } },
  reporters: ['json'],
  outputDir: '.hydration-proof/intercept-report',
};
