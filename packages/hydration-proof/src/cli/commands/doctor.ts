import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { selectAdapter } from '../../adapters/index.ts';
import { ExitCode } from '../../ci/exit-codes.ts';
import { ConfigError, loadConfig } from '../../config/load.ts';
import { isCI } from '../../config/resolve.ts';
import { isSupportedVersion, loadPlaywright } from '../../engine/playwright.ts';
import { detectPackageManager, selfCommand } from '../../util/package-manager.ts';
import { VERSION } from '../../util/version.ts';
import { palette, symbols } from '../style.ts';
import type { CommandContext } from '../context.ts';

export const DOCTOR_HELP = `Usage: hydration-proof doctor

Check Node.js, Playwright, browsers, the config file and framework detection.
`;

export function nodeSupported(version: string = process.versions.node): boolean {
  const [major = 0, minor = 0] = version.split('.').map(Number);
  return major > 22 || (major === 22 && minor >= 18);
}

export async function doctorCommand(args: string[], context: CommandContext): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) {
    context.out(DOCTOR_HELP);
    return ExitCode.Ok;
  }
  const c = palette();
  let ok = true;
  const line = (good: boolean | 'warn', label: string, detail: string): void => {
    const icon = good === true ? c.green(symbols.pass) : good === 'warn' ? c.yellow(symbols.warn) : c.red(symbols.fail);
    if (good === false) ok = false;
    context.out(`  ${icon} ${label.padEnd(16)} ${detail}\n`);
  };

  context.out(`\n${c.bold('hydration-proof')} ${VERSION}\n\n`);
  line(nodeSupported(), 'Node.js', `${process.versions.node}${nodeSupported() ? '' : ' (22.18 or newer is required)'}`);
  const manager = detectPackageManager(context.cwd, context.env);
  line(true, 'Package manager', manager);
  line(true, 'CI', isCI(context.env) ? 'yes' : 'no');

  try {
    const playwright = await loadPlaywright(context.cwd);
    line(isSupportedVersion(playwright.version), 'Playwright', `${playwright.version} (${playwright.source})`);
    for (const name of ['chromium', 'firefox', 'webkit'] as const) {
      let installed = false;
      try {
        installed = existsSync(playwright.module[name].executablePath());
      } catch {
        installed = false;
      }
      line(installed || name !== 'chromium' ? (installed ? true : 'warn') : false, name, installed ? 'installed' : `not installed — ${selfCommand(manager, `install ${name}`)}`);
    }
  } catch (error) {
    line(false, 'Playwright', error instanceof Error ? error.message : String(error));
  }

  try {
    const loaded = await loadConfig({ cwd: context.cwd });
    line(loaded.file ? true : 'warn', 'Config', loaded.file ? relative(context.cwd, loaded.file) : `none — run ${selfCommand(manager, 'init')}`);
    const adapter = selectAdapter(loaded.config.adapter ?? 'auto', loaded.rootDir);
    const routes = adapter.discoverRoutes?.({ rootDir: loaded.rootDir, packageManager: manager });
    line(adapter.name !== 'none' ? true : 'warn', 'Framework', adapter.name === 'none' ? 'not detected (set server.command)' : adapter.name);
    if (routes) line(true, 'Routes', `${routes.filter((r) => !r.dynamic).length} static, ${routes.filter((r) => r.dynamic).length} dynamic`);
  } catch (error) {
    line(false, 'Config', error instanceof ConfigError ? error.message : String(error));
  }
  context.out('\n');
  return ok ? ExitCode.Ok : ExitCode.Usage;
}
