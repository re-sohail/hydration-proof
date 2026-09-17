// At the repository root. It lists the apps; each one keeps its own config.
import { defineConfig } from 'hydration-proof';

export default defineConfig({
  projects: [
    // A path is enough when the folder has a hydration-proof config.
    'apps/web',
    // A name makes `--project admin` and the report grouping read better.
    { path: 'apps/admin', name: 'admin' },
    // Or point at a config that is not in the default place.
    { path: 'apps/docs', name: 'docs', config: 'config/hydration-proof.ts' },
  ],

  // Applies to every project unless its own config says otherwise.
  ci: { failOn: 'error', history: true },
  owners: { codeowners: true },
});
