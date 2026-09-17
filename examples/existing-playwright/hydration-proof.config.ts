import { defineConfig } from 'hydration-proof';

export default defineConfig({
  // No `server` block: the app is already running (CI starts it, or Playwright's
  // webServer does). Pass --url, or set it here.
  server: { url: process.env.BASE_URL ?? 'http://localhost:3000', reuseExisting: true },

  routes: { discover: true },

  scenarios: [
    {
      name: 'signed-in',
      // The file Playwright's global setup already wrote.
      storageState: 'playwright/.auth/user.json',
    },
  ],

  // Wait for the same thing the e2e suite waits for, instead of guessing.
  ready: {
    selector: '[data-app-ready]',
    // Nothing may change the DOM for this long before a page counts as stable.
    quietMs: 200,
    timeout: 15_000,
  },
});
