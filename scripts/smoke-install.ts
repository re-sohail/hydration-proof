// Installs the packed package into a fresh Next.js app with a real package
// manager and runs the CLI against it.
// Usage: node scripts/smoke-install.ts [npm|pnpm|yarn|yarn-pnp|bun]
//
// `yarn` is Yarn Classic (1.x); `yarn-pnp` is Yarn Berry with Plug'n'Play,
// where the package is loaded out of a zip archive and never from disk. Browsers
// are expected to be installed already (`playwright-core install chromium`), so
// each run only needs the shared browser cache.

import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MANAGERS = ['npm', 'pnpm', 'yarn', 'yarn-pnp', 'bun'] as const;
type Manager = (typeof MANAGERS)[number];

const manager = (process.argv[2] ?? 'npm') as Manager;
if (!MANAGERS.includes(manager)) {
  console.error(`Unknown package manager "${manager}". One of: ${MANAGERS.join(', ')}`);
  process.exit(2);
}

/** Yarn Berry's version; pinned so the run is reproducible. */
const YARN_BERRY = '4.10.3';

const packageDir = new URL('../packages/hydration-proof/', import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), `hp-smoke-${manager}-`));

function sh(command: string, cwd: string, env: NodeJS.ProcessEnv = {}): void {
  console.log(`$ ${command}`);
  execSync(command, { cwd, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', ...env } });
}

try {
  sh(`pnpm pack --pack-destination ${work}`, packageDir);
  const tarball = readdirSync(work).find((file) => file.endsWith('.tgz'))!;

  const app = join(work, 'app');
  mkdirSync(join(app, 'app', 'clock'), { recursive: true });
  writeFileSync(
    join(app, 'package.json'),
    JSON.stringify(
      {
        name: 'smoke-app',
        private: true,
        type: 'module',
        ...(manager === 'yarn-pnp' ? { packageManager: `yarn@${YARN_BERRY}` } : {}),
        scripts: { build: 'next build', start: 'next start' },
        dependencies: { next: '16.3.5', react: '19.3.0', 'react-dom': '19.3.0' },
        devDependencies: { 'hydration-proof': `file:../${tarball}` },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(app, 'app', 'layout.jsx'), 'export default function Layout({ children }) { return <html lang="en"><body>{children}</body></html>; }\n');
  writeFileSync(join(app, 'app', 'page.jsx'), 'export default function Page() { return <p id="home">Home</p>; }\n');
  writeFileSync(
    join(app, 'app', 'clock', 'Clock.jsx'),
    "'use client';\nexport function Clock() { return <p id=\"clock\">{Date.now()}</p>; }\n",
  );
  writeFileSync(
    join(app, 'app', 'clock', 'page.jsx'),
    "import { Clock } from './Clock.jsx';\nexport const dynamic = 'force-dynamic';\nexport default function Page() { return <Clock />; }\n",
  );

  const install: Record<Manager, string> = {
    npm: 'npm install --no-audit --no-fund',
    pnpm: 'pnpm install',
    yarn: 'yarn install',
    'yarn-pnp': 'yarn install',
    bun: 'bun install',
  };
  const exec: Record<Manager, string> = {
    npm: 'npx hydration-proof',
    pnpm: 'pnpm exec hydration-proof',
    yarn: 'yarn hydration-proof',
    'yarn-pnp': 'yarn hydration-proof',
    bun: 'bunx hydration-proof',
  };

  if (manager === 'yarn' || manager === 'yarn-pnp') writeFileSync(join(app, 'yarn.lock'), '');
  if (manager === 'yarn-pnp') {
    // Plug'n'Play is the default in Berry; say so anyway, and let Next.js read
    // its own files, which it does outside the PnP resolver.
    writeFileSync(join(app, '.yarnrc.yml'), 'nodeLinker: pnp\nenableGlobalCache: true\ncompressionLevel: 0\n');
    sh('corepack enable', app);
    sh(`corepack prepare yarn@${YARN_BERRY} --activate`, app);
  }

  sh(install[manager], app);
  sh(`${exec[manager]} init`, app);
  sh(`${exec[manager]} doctor`, app);

  const result = spawnSync(`${exec[manager]} test --reporter list,json`, { cwd: app, shell: true, encoding: 'utf8', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.status !== 1 || !result.stdout.includes('HP1001') || !result.stdout.includes('/clock')) {
    throw new Error(`Expected exit 1 with HP1001 on /clock, got exit ${result.status}.`);
  }
  // The static page is a negative control: a false positive there fails the run.
  const report = JSON.parse(readFileSync(join(app, '.hydration-proof', 'report', 'report.json'), 'utf8')) as {
    pages: { route: { pattern: string }; status: string }[];
  };
  const home = report.pages.find((page) => page.route.pattern === '/');
  if (!home) throw new Error('The static page was not tested.');
  if (home.status !== 'passed') throw new Error(`The static page reported ${home.status}.`);
  console.log(`\nSmoke test with ${manager} passed.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
