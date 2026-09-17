import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ExitCode } from '../../ci/exit-codes.ts';
import { loadPlaywright } from '../../engine/playwright.ts';
import { detectPackageManager, execCommand } from '../../util/package-manager.ts';
import { UsageError, type CommandContext } from '../context.ts';

export const INSTALL_HELP = `Usage: hydration-proof install [browser...] [--with-deps]

Download the browsers hydration-proof drives (Chromium by default), using the
same Playwright version hydration-proof runs with.

Options:
      --with-deps   Also install system dependencies (Linux CI)
  -h, --help        Show this help
`;

const KNOWN = new Set(['chromium', 'firefox', 'webkit', 'chrome', 'msedge', 'chromium-headless-shell']);

export async function installCommand(args: string[], context: CommandContext): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: { 'with-deps': { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help) {
    context.out(INSTALL_HELP);
    return ExitCode.Ok;
  }
  const browsers = positionals.length > 0 ? positionals : ['chromium'];
  for (const name of browsers) if (!KNOWN.has(name)) throw new UsageError(`Unknown browser "${name}".`);

  const playwright = await loadPlaywright(context.cwd);
  const cli = join(playwright.root, 'cli.js');
  const installArgs = ['install', ...(values['with-deps'] ? ['--with-deps'] : []), ...browsers];
  if (!existsSync(cli)) {
    const manager = detectPackageManager(context.cwd);
    context.err(
      `Could not locate Playwright's installer on disk (Plug'n'Play install?). Run:\n  ${execCommand(manager, 'playwright-core', installArgs.join(' '))}\n`,
    );
    return ExitCode.Browser;
  }
  context.out(`Installing ${browsers.join(', ')} for Playwright ${playwright.version}…\n`);
  const code = await new Promise<number | null>((resolve) => {
    const child = spawn(process.execPath, [cli, ...installArgs], { stdio: 'inherit', cwd: context.cwd });
    child.on('exit', resolve);
    child.on('error', () => resolve(null));
  });
  return code === 0 ? ExitCode.Ok : ExitCode.Browser;
}
