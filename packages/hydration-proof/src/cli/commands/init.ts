import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { selectAdapter } from '../../adapters/index.ts';
import { ExitCode } from '../../ci/exit-codes.ts';
import { findConfigFile } from '../../config/load.ts';
import { detectPackageManager, installDevCommand, selfCommand } from '../../util/package-manager.ts';
import { palette } from '../style.ts';
import type { CommandContext } from '../context.ts';

export const INIT_HELP = `Usage: hydration-proof init [--force]

Create hydration-proof.config.ts for this project and ignore the report folder in git.

Options:
      --force   Overwrite an existing config
  -h, --help    Show this help
`;

const GITIGNORE_ENTRY = '.hydration-proof/report/';

function configSource(options: { typescript: boolean; nextjs: boolean; dynamic: string[] }): string {
  const dynamicLines =
    options.dynamic.length > 0
      ? options.dynamic.map((pattern) => `      // ${JSON.stringify(pattern)}: ['example-1', 'example-2'],`).join('\n')
      : `      // '/products/[id]': ['1', '42'],`;
  const header = options.typescript
    ? `import { defineConfig } from 'hydration-proof';\n\nexport default defineConfig({`
    : `// @ts-check\n/** @type {import('hydration-proof').HydrationProofConfig} */\nexport default {`;
  const footer = options.typescript ? '});' : '};';
  const serverComment = options.nextjs
    ? `  // hydration-proof builds and starts the app (next build, next start).\n  // To test an app that is already running instead:\n  // server: { url: 'http://localhost:3000' },\n`
    : `  // How to start the app. {port} is replaced with a free port.\n  server: {\n    build: 'npm run build',\n    command: 'npm start -- --port {port}',\n    // or test an app that is already running:\n    // url: 'http://localhost:3000',\n  },\n`;
  return `${header}
${serverComment}
  routes: {${options.nextjs ? '\n    // Static routes are discovered from app/ and pages/.' : "\n    paths: ['/'],"}
    // Example values for dynamic routes:
    dynamic: {
${dynamicLines}
    },
    exclude: ['/api/**'],
  },

  // Browser environments to test in. The default matches this machine's
  // locale and timezone; add the ones your users have.
  scenarios: [
    { name: 'default' },
    // { name: 'dark-mobile', colorScheme: 'dark', viewport: 'mobile' },
    // { name: 'karachi', locale: 'ur-PK', timezoneId: 'Asia/Karachi' },
  ],

  // Test every scenario in more environments (every pair of values is covered):
  // matrix: {
  //   locale: ['en-US', 'de-DE'],
  //   timezoneId: ['UTC', 'Asia/Karachi'],
  //   colorScheme: ['light', 'dark'],
  //   browser: ['chromium', 'firefox', 'webkit'],
  // },

  reporters: ['list', 'json'],
${footer}
`;
}

export async function initCommand(args: string[], context: CommandContext): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: { force: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help) {
    context.out(INIT_HELP);
    return ExitCode.Ok;
  }
  const c = palette();
  const cwd = context.cwd;
  const existing = findConfigFile(cwd);
  if (existing && !values.force) {
    context.err(`${relative(cwd, existing)} already exists. Use --force to overwrite it.\n`);
    return ExitCode.Usage;
  }

  const manager = detectPackageManager(cwd, context.env);
  const adapter = selectAdapter('auto', cwd);
  const nextjs = adapter.name === 'next';
  const routes = adapter.discoverRoutes?.({ rootDir: cwd, packageManager: manager }) ?? [];
  const dynamic = routes.filter((route) => route.dynamic).map((route) => route.pattern);
  const typescript = existsSync(join(cwd, 'tsconfig.json'));
  const file = join(cwd, typescript ? 'hydration-proof.config.ts' : 'hydration-proof.config.mjs');
  writeFileSync(file, configSource({ typescript, nextjs, dynamic }));
  context.out(`${c.green('Created')} ${relative(cwd, file)}\n`);

  const gitignore = join(cwd, '.gitignore');
  if (existsSync(gitignore)) {
    const content = readFileSync(gitignore, 'utf8');
    if (!content.split(/\r?\n/).some((line) => line.trim() === GITIGNORE_ENTRY)) {
      appendFileSync(gitignore, `${content.endsWith('\n') || content === '' ? '' : '\n'}\n# hydration-proof reports\n${GITIGNORE_ENTRY}\n`);
      context.out(`${c.green('Updated')} .gitignore\n`);
    }
  }

  const found = routes.filter((route) => !route.dynamic).length;
  context.out(
    [
      '',
      nextjs ? `Detected Next.js: ${found} static route${found === 1 ? '' : 's'}, ${dynamic.length} dynamic.` : 'No framework detected: edit server and routes in the config.',
      '',
      'Next steps:',
      existsSync(join(cwd, 'node_modules', 'hydration-proof')) ? '' : `  ${installDevCommand(manager, 'hydration-proof')}`,
      `  ${selfCommand(manager, 'install')}      # download Chromium once`,
      `  ${selfCommand(manager, 'test')}`,
      '',
    ]
      .filter((line, index, all) => line !== '' || all[index - 1] !== '')
      .join('\n'),
  );
  return ExitCode.Ok;
}
