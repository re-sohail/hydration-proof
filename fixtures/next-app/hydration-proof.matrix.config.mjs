// Environment matrix and probes against the App Router fixture (e2e tests).
const SERVER_ENV = { TZ: 'UTC', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' };

export default {
  server: { env: SERVER_ENV },
  routes: { paths: ['/locale', '/timezone', '/static'], notFound: false },
  scenarios: [{ name: 'visitor' }],
  matrix: {
    locale: ['en-US', 'de-DE'],
    timezoneId: ['UTC', 'Asia/Karachi'],
    browser: ['chromium', 'firefox'],
  },
  reporters: ['list', 'json', 'html'],
  outputDir: '.hydration-proof/matrix-report',
};
