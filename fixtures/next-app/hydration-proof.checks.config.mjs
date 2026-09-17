// Streaming, head, duplicate ids, navigation and interaction checks (e2e tests).
export default {
  server: { env: { TZ: 'UTC', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } },
  routes: {
    include: ['/nav/**', '/dashboard/**', '/gallery/**', '/static', '/suspense-mismatch', '/head-meta', '/duplicate-id', '/counter'],
    dynamic: { '/gallery/photo/[id]': ['1'] },
    notFound: false,
  },
  checks: { navigation: { from: '/nav/source' }, interactions: true },
  interactions: [
    {
      route: '/counter',
      name: 'count to two',
      steps: async ({ page }) => {
        await page.click('#counter');
        await page.click('#counter');
        await page.waitForSelector('text=Clicked 2 times', { timeout: 5000 });
      },
    },
    {
      route: '/static',
      name: 'find a missing button',
      steps: async ({ page }) => {
        await page.click('#does-not-exist', { timeout: 1000 });
      },
    },
  ],
  reporters: ['list', 'json', 'html'],
  outputDir: '.hydration-proof/checks-report',
};
