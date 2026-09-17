// Adapter fixture (e2e tests).
export default {
  routes: { dynamic: { '/products/[id]': ['1'] } },
  reporters: ['list', 'json'],
};
