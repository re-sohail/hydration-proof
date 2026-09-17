import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Used by the e2e suite: setup/teardown hooks and browser request mocks.
const marker = (rootDir, name, text) => {
  mkdirSync(join(rootDir, '.hydration-proof', 'hooks'), { recursive: true });
  writeFileSync(join(rootDir, '.hydration-proof', 'hooks', name), text);
};

export default {
  routes: { paths: ['/static', '/api-data'], notFound: false },
  reporters: ['json'],
  outputDir: '.hydration-proof/hooks-report',
  scenarios: [{ name: 'mocked', mocks: [{ url: '**/api/counter?*', body: { count: 42 } }] }],
  hooks: {
    setup: ({ baseUrl, rootDir }) => {
      marker(rootDir, 'setup.txt', baseUrl);
      return () => marker(rootDir, 'returned-teardown.txt', 'done');
    },
    teardown: ({ rootDir }) => marker(rootDir, 'teardown.txt', 'done'),
  },
};
