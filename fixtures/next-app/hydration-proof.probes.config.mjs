// Probes prove the causes of value mismatches (e2e tests).
export default {
  server: { env: { TZ: 'UTC', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' } },
  routes: { paths: ['/date-now', '/math-random', '/api-data', '/timezone', '/local-storage'], notFound: false },
  scenarios: [{ name: 'visitor', locale: 'en-US', timezoneId: 'Asia/Karachi', localStorage: { name: 'Sohail' } }],
  probes: { maxPages: 10 },
  reporters: ['list', 'json'],
  outputDir: '.hydration-proof/probes-report',
};
