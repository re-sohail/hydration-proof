// apps/admin/hydration-proof.config.ts — a project config is an ordinary
// config. The only thing to keep in mind is that each app needs its own port,
// because the projects run one after another.
import { defineConfig } from 'hydration-proof';

export default defineConfig({
  server: {
    command: 'pnpm start --port 3002',
    build: 'pnpm build',
    url: 'http://localhost:3002',
  },
  routes: { discover: true, dynamic: { '/users/[id]': ['1'] } },
  scenarios: [
    { name: 'admin', cookies: [{ name: 'session', value: process.env.ADMIN_SESSION ?? '' }] },
  ],
  // The legacy app is allowed a shrinking number of warnings while the new one
  // stays at zero.
  ci: { budget: { error: 0, warning: 8 } },
});
