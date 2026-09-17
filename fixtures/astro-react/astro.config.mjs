import node from '@astrojs/node';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  // The standalone server listens on process.env.HOST ?? server.host
  // (Astro's default, `false`, means "localhost", which can resolve to ::1).
  server: { host: '127.0.0.1' },
});
