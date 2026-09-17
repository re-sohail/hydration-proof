// Adapter fixture (e2e tests).
export default {
  server: { env: { TZ: 'UTC', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } },
  routes: { dynamic: { '/products/[id]': ['1'] } },
  checks: { navigation: { prefetch: false } },
  reporters: ['list', 'json'],
};
