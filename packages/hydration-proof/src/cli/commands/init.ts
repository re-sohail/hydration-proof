import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { selectAdapter } from '../../adapters/index.ts';
import { ExitCode } from '../../ci/exit-codes.ts';
import { findConfigFile } from '../../config/load.ts';
import { detectPackageManager, installDevCommand, selfCommand } from '../../util/package-manager.ts';
import { palette } from '../style.ts';
import { ciFile, githubWorkflow, gitlabJob, type CiProvider } from '../ci-templates.ts';
import { UsageError, type CommandContext } from '../context.ts';

export const INIT_HELP = `Usage: hydration-proof init [--ci github|gitlab] [--force]

Create hydration-proof.config.ts for this project and ignore the report folder in git.

Options:
      --ci <provider>   Also write a CI workflow: github (.github/workflows/hydration.yml)
                        or gitlab (.gitlab/hydration-proof.yml)
      --force           Overwrite existing files
  -h, --help            Show this help
`;

const GITIGNORE_ENTRY = '.hydration-proof/report/';

const FRAMEWORKS: Record<string, { label: string; commands: string; routes?: string }> = {
  next: { label: 'Next.js', commands: 'next build, next start', routes: 'app/ and pages/' },
  'react-router': { label: 'React Router', commands: 'react-router build, react-router-serve', routes: 'react-router routes' },
  remix: { label: 'Remix', commands: 'remix vite:build, remix-serve', routes: 'remix routes' },
  astro: { label: 'Astro', commands: 'astro build, then the Node server or astro preview', routes: 'src/pages' },
  vite: { label: 'Vite SSR', commands: 'the build and start scripts of package.json' },
  node: { label: 'a custom React server', commands: 'the build and start scripts of package.json' },
};

function configSource(options: { typescript: boolean; framework: string; dynamic: string[] }): string {
  const known = FRAMEWORKS[options.framework];
  const discovers = known?.routes !== undefined;
  const dynamicLines =
    options.dynamic.length > 0
      ? options.dynamic.map((pattern) => `      // ${JSON.stringify(pattern)}: ['example-1', 'example-2'],`).join('\n')
      : `      // '/products/[id]': ['1', '42'],`;
  const header = options.typescript
    ? `import { defineConfig } from 'hydration-proof';\n\nexport default defineConfig({`
    : `// @ts-check\n/** @type {import('hydration-proof').HydrationProofConfig} */\nexport default {`;
  const footer = options.typescript ? '});' : '};';
  const serverComment = known
    ? `  // hydration-proof builds and starts the app (${known.commands}).\n  // To test an app that is already running instead:\n  // server: { url: 'http://localhost:3000' },\n`
    : `  // How to start the app. {port} is replaced with a free port (also in the PORT variable).\n  server: {\n    build: 'npm run build',\n    command: 'npm start -- --port {port}',\n    // or test an app that is already running:\n    // url: 'http://localhost:3000',\n  },\n`;
  return `${header}
${serverComment}
  routes: {${discovers ? `\n    // Routes are discovered from ${known.routes}.` : "\n    paths: ['/'],"}
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
    options: { force: { type: 'boolean' }, ci: { type: 'string' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help) {
    context.out(INIT_HELP);
    return ExitCode.Ok;
  }
  if (values.ci !== undefined && values.ci !== 'github' && values.ci !== 'gitlab') {
    throw new UsageError(`--ci must be github or gitlab, got "${values.ci}".`);
  }
  const provider = values.ci as CiProvider | undefined;
  const c = palette();
  const cwd = context.cwd;
  const existing = findConfigFile(cwd);
  if (existing && !values.force && !provider) {
    context.err(`${relative(cwd, existing)} already exists. Use --force to overwrite it.\n`);
    return ExitCode.Usage;
  }

  const manager = detectPackageManager(cwd, context.env);
  const adapter = selectAdapter('auto', cwd);
  const framework = adapter.name;
  const routes = adapter.discoverRoutes?.({ rootDir: cwd, packageManager: manager }) ?? [];
  const dynamic = routes.filter((route) => route.dynamic).map((route) => route.pattern);
  if (existing && !values.force) {
    context.out(`${c.gray('Kept')} ${relative(cwd, existing)}\n`);
  } else {
    const typescript = existsSync(join(cwd, 'tsconfig.json'));
    const file = join(cwd, typescript ? 'hydration-proof.config.ts' : 'hydration-proof.config.mjs');
    writeFileSync(file, configSource({ typescript, framework, dynamic }));
    context.out(`${c.green('Created')} ${relative(cwd, file)}\n`);
  }

  if (provider) {
    const target = join(cwd, ciFile(provider));
    if (existsSync(target) && !values.force) {
      context.err(`${relative(cwd, target)} already exists. Use --force to overwrite it.\n`);
      return ExitCode.Usage;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, provider === 'github' ? githubWorkflow(manager, cwd) : gitlabJob(manager, cwd));
    context.out(`${c.green('Created')} ${relative(cwd, target)}\n`);
    if (provider === 'gitlab') context.out(`  Include it from .gitlab-ci.yml:  include: [{ local: ${ciFile(provider)} }]\n`);
  }

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
      FRAMEWORKS[framework]?.routes !== undefined
        ? `Detected ${FRAMEWORKS[framework]!.label}: ${found} static route${found === 1 ? '' : 's'}, ${dynamic.length} dynamic.`
        : FRAMEWORKS[framework]
          ? `Detected ${FRAMEWORKS[framework]!.label}: list the routes to test in the config.`
          : 'No framework detected: edit server and routes in the config.',
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
