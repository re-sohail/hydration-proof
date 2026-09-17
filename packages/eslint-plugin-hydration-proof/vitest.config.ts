import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'eslint-plugin',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
