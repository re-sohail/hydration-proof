// Adapter fixture (e2e tests): Vite SSR has no route discovery.
export default {
  routes: { paths: ['/', '/static', '/date-now', '/math-random', '/products/1', '/counter'] },
  reporters: ['list', 'json'],
};
