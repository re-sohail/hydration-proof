import { defineConfig } from 'hydration-proof';

// The fixture of a small SaaS app: public pages, a customer area behind a
// login form, and an admin area reached with a session cookie.
export default defineConfig({
  routes: {
    exclude: ['/api/**'],
    sitemap: true,
  },
  scenarios: [
    { name: 'guest', exclude: ['/customer/**', '/admin/**'] },
    {
      name: 'customer',
      include: ['/customer/**'],
      login: async ({ page, baseUrl }) => {
        await page.goto(`${baseUrl}/login`);
        await page.selectOption('#role', 'customer');
        await Promise.all([page.waitForURL('**/customer'), page.click('#sign-in')]);
      },
    },
    {
      name: 'admin',
      include: ['/admin/**'],
      cookies: [{ name: 'session', value: 'admin' }],
    },
  ],
});
