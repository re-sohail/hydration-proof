// Custom node:http server (the `node` adapter) with React 19 streaming (e2e tests).
export default {
  server: { env: { NODE_ENV: 'production' }, build: false },
  routes: { paths: ['/ok', '/text-mismatch', '/suspense', '/two-roots', '/two-roots-prefixed'] },
  reporters: ['json'],
};
