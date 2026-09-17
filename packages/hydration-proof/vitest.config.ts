import { defineConfig } from 'vitest/config';
import { inlineBrowserBundles } from './scripts/inline-browser-plugin.ts';

export default defineConfig({
  plugins: [inlineBrowserBundles()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          environment: 'node',
          include: ['tests/unit/**/*.test.ts'],
          globalSetup: ['tests/setup/build-browser.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          environment: 'node',
          include: ['tests/browser/**/*.test.ts'],
          globalSetup: ['tests/setup/build-browser.ts', 'tests/setup/harness.ts'],
          testTimeout: 60_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          environment: 'node',
          include: ['tests/e2e/**/*.test.ts'],
          testTimeout: 180_000,
          hookTimeout: 600_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
