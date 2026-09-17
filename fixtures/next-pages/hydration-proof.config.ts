import { defineConfig } from 'hydration-proof';

export default defineConfig({
  routes: {
    exclude: ['/api/**'],
  },
  scenarios: [{ name: 'default' }],
});
