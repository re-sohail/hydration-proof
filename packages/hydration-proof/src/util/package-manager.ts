import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

const LOCKFILES: [string, PackageManager][] = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm'],
];

function fromUserAgent(agent: string | undefined): PackageManager | undefined {
  const name = agent?.split('/')[0];
  return name === 'pnpm' || name === 'yarn' || name === 'bun' || name === 'npm' ? name : undefined;
}

function fromPackageJson(dir: string): PackageManager | undefined {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { packageManager?: string };
    return fromUserAgent(pkg.packageManager?.replace('@', '/'));
  } catch {
    return undefined;
  }
}

/** The package manager a project uses: lockfile, then `packageManager`, then the invoking tool. */
export function detectPackageManager(cwd: string, env: NodeJS.ProcessEnv = process.env): PackageManager {
  let dir = cwd;
  while (true) {
    for (const [file, manager] of LOCKFILES) if (existsSync(join(dir, file))) return manager;
    const declared = fromPackageJson(dir);
    if (declared) return declared;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return fromUserAgent(env['npm_config_user_agent']) ?? 'npm';
}

/** Run a binary from the project's dependencies. */
export function execCommand(manager: PackageManager, bin: string, args = ''): string {
  const tail = args ? ` ${args}` : '';
  switch (manager) {
    case 'pnpm':
      return `pnpm exec ${bin}${tail}`;
    case 'yarn':
      return `yarn ${bin}${tail}`;
    case 'bun':
      return `bunx ${bin}${tail}`;
    default:
      return `npx --no-install ${bin}${tail}`;
  }
}

/** Run a package.json script. */
export function runScript(manager: PackageManager, script: string): string {
  return manager === 'yarn' ? `yarn ${script}` : `${manager} run ${script}`;
}

/** How a user runs hydration-proof itself (for messages). */
export function selfCommand(manager: PackageManager, args: string): string {
  switch (manager) {
    case 'pnpm':
      return `pnpm exec hydration-proof ${args}`;
    case 'yarn':
      return `yarn hydration-proof ${args}`;
    case 'bun':
      return `bunx hydration-proof ${args}`;
    default:
      return `npx hydration-proof ${args}`;
  }
}

export function installDevCommand(manager: PackageManager, pkg: string): string {
  switch (manager) {
    case 'pnpm':
      return `pnpm add -D ${pkg}`;
    case 'yarn':
      return `yarn add -D ${pkg}`;
    case 'bun':
      return `bun add -d ${pkg}`;
    default:
      return `npm install -D ${pkg}`;
  }
}
