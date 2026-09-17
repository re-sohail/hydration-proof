// Installs the packed package into a fresh Next.js app with a real package
// manager and runs the CLI against it.
// Usage: node scripts/smoke-install.ts [npm|pnpm|yarn|bun]

import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const manager = (process.argv[2] ?? 'npm') as 'npm' | 'pnpm' | 'yarn' | 'bun';
const packageDir = new URL('../packages/hydration-proof/', import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), `hp-smoke-${manager}-`));

function sh(command: string, cwd: string): void {
  console.log(`$ ${command}`);
  execSync(command, { cwd, stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } });
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

  const install = { npm: 'npm install --no-audit --no-fund', pnpm: 'pnpm install', yarn: 'yarn install', bun: 'bun install' }[manager];
  const exec = { npm: 'npx hydration-proof', pnpm: 'pnpm exec hydration-proof', yarn: 'yarn hydration-proof', bun: 'bunx hydration-proof' }[manager];
  if (manager === 'yarn') writeFileSync(join(app, 'yarn.lock'), '');
  sh(install, app);
  sh(`${exec} init`, app);
  sh(`${exec} doctor`, app);
  const result = spawnSync(`${exec} test --reporter list,json`, { cwd: app, shell: true, encoding: 'utf8' });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  if (result.status !== 1 || !result.stdout.includes('HP1001') || !result.stdout.includes('/clock')) {
    throw new Error(`Expected exit 1 with HP1001 on /clock, got exit ${result.status}.`);
  }
  console.log(`\nSmoke test with ${manager} passed.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
