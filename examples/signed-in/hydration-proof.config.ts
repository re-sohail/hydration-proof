import { defineConfig } from 'hydration-proof';

export default defineConfig({
  server: { command: 'pnpm start', build: 'pnpm build', url: 'http://localhost:3000' },

  routes: {
    discover: true,
    // Discovery finds /admin, but only the admin scenario may open it.
    dynamic: { '/account/orders/[id]': ['1001'] },
  },

  scenarios: [
    // Everything that is not behind a login.
    { name: 'guest', exclude: ['/account/**', '/admin/**'] },

    // A real sign-in, once, then reused for every page of this scenario.
    {
      name: 'customer',
      include: ['/account/**'],
      login: async ({ page, baseUrl }) => {
        await page.goto(`${baseUrl}/login`);
        await page.fill('#email', process.env.TEST_USER_EMAIL ?? '');
        await page.fill('#password', process.env.TEST_USER_PASSWORD ?? '');
        await page.click('button[type=submit]');
        await page.waitForURL('**/account');
      },
    },

    // A session the test environment hands out: no browser work at all.
    {
      name: 'admin',
      include: ['/admin/**'],
      cookies: [{ name: 'session', value: process.env.ADMIN_SESSION ?? '' }],
      // Admin pages often show data that changes between requests; pin it.
      mocks: [{ url: '**/api/metrics', body: { signups: 12, revenue: 3400 } }],
    },
  ],
});
