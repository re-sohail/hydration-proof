import { defineConfig } from 'hydration-proof';

export default defineConfig({
  server: { command: 'pnpm start', build: 'pnpm build', url: 'http://localhost:3000' },
  routes: { discover: true },

  matrix: {
    // Pick values that differ in ways the code cares about: a right-to-left
    // locale, a half-hour timezone offset, the two themes.
    locale: ['en-US', 'de-DE', 'ar-EG'],
    timezoneId: ['UTC', 'Asia/Karachi', 'America/Los_Angeles'],
    colorScheme: ['light', 'dark'],
    viewport: ['desktop', 'mobile'],
    browser: ['chromium', 'firefox', 'webkit'],
    // A returning visitor: scripts arrive in a different order.
    cache: ['cold', 'warm'],
    // Chromium only; other browsers skip it with a note.
    cpu: [1, 4],

    // Anything the tool cannot guess. Each value is scenario settings.
    axes: {
      flags: {
        'new-checkout': { cookies: [{ name: 'flag_checkout', value: 'new' }] },
        'old-checkout': {},
      },
      currency: {
        eur: { localStorage: { currency: 'EUR' } },
        jpy: { localStorage: { currency: 'JPY' } },
      },
    },

    strategy: 'pairwise',
    max: 16,
  },

  // A page that fails in one environment out of twelve is usually a real bug
  // that happens to need that environment, not flakiness. `--repeat` tells the
  // difference: it scores how often each finding comes back.
  repeat: 1,
});
