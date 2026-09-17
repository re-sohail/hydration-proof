import { parseArgs } from 'node:util';
import type { CliOverrides } from '../../config/resolve.ts';
import type { BrowserName, BuildMode, ReporterName } from '../../config/types.ts';
import { ExitCode } from '../../ci/exit-codes.ts';
import { watchTests } from '../../dev/watch.ts';
import { run } from '../../run.ts';
import { UsageError, type CommandContext } from '../context.ts';

export const TEST_HELP = `Usage: hydration-proof test [options]

Load every route in a real browser and report hydration problems.

Options:
  -c, --config <file>       Config file (default: hydration-proof.config.*)
  -u, --url <url>           Test an app that is already running
  -r, --route <path>        Test only this route (repeatable)
      --grep <regex>        Only routes whose path matches
  -s, --scenario <name>     Only this scenario (repeatable)
      --mode <mode>         production (default), development, or both
      --build / --no-build  Always rebuild / never build before testing
      --browser <name>      chromium (default), firefox or webkit
      --channel <name>      Use an installed browser, e.g. chrome
      --no-matrix           Test the scenarios without the environment matrix
      --probe               Prove causes by reloading pages with one thing changed
      --interactions        Type, click and scroll while pages load; check nothing is lost
      --navigation          Compare client-side navigation with direct loads (Next.js)
      --repeat <n>          Load every page n times and report flaky findings
      --reporter <list>     Comma-separated: list,json,html,junit,sarif,github,gitlab
  -o, --output <dir>        Report directory (default: .hydration-proof/report)
  -w, --workers <n>         Pages tested in parallel
      --timeout <ms>        Per-page timeout
      --retries <n>         Retries for pages that fail to load
      --fail-on <level>     error (default), warning, info or never
      --shard <i/n>         Run part i of n (for parallel CI jobs)
      --changed [ref]       Only routes affected by files changed since ref
                            (default: the pull request base or main)
      --new-only            Fail only on findings that are not in the baseline
      --update-baseline     Write the baseline from this run's findings
      --project <name>      Only this monorepo project (repeatable)
      --crawl               Also test same-origin links found on pages
      --sitemap             Also test routes listed in /sitemap.xml
      --no-cache            Discover routes again instead of using the cache
      --watch               Keep the app running and test the routes each change affects
      --headed              Show the browser
  -h, --help                Show this help
`;

const BROWSERS = new Set(['chromium', 'firefox', 'webkit']);
const MODES = new Set(['production', 'development', 'prod', 'dev', 'both']);
const REPORTERS = new Set(['list', 'json', 'html', 'junit', 'sarif', 'github', 'gitlab']);
const FAIL_ON = new Set(['error', 'warning', 'info', 'never']);

function positiveInt(value: string | undefined, flag: string, min = 1): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min) throw new UsageError(`${flag} must be an integer >= ${min}, got "${value}".`);
  return number;
}

/** `--changed` takes an optional value: `--changed`, `--changed main`, `--changed=main`. */
function extractChanged(args: string[]): { rest: string[]; changed?: string | true } {
  const rest: string[] = [];
  let changed: string | true | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--changed') {
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        changed = next;
        i++;
      } else {
        changed = true;
      }
    } else if (arg.startsWith('--changed=')) {
      changed = arg.slice('--changed='.length) || true;
    } else {
      rest.push(arg);
    }
  }
  return changed === undefined ? { rest } : { rest, changed };
}

export function parseTestArgs(argv: string[]): { overrides: CliOverrides; config?: string; help: boolean; watch?: boolean } {
  const { rest: args, changed } = extractChanged(argv);
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    allowNegative: true,
    strict: true,
    options: {
      config: { type: 'string', short: 'c' },
      url: { type: 'string', short: 'u' },
      route: { type: 'string', short: 'r', multiple: true },
      grep: { type: 'string' },
      scenario: { type: 'string', short: 's', multiple: true },
      mode: { type: 'string' },
      build: { type: 'boolean' },
      browser: { type: 'string' },
      channel: { type: 'string' },
      reporter: { type: 'string', multiple: true },
      output: { type: 'string', short: 'o' },
      workers: { type: 'string', short: 'w' },
      timeout: { type: 'string' },
      retries: { type: 'string' },
      'fail-on': { type: 'string' },
      shard: { type: 'string' },
      crawl: { type: 'boolean' },
      sitemap: { type: 'boolean' },
      cache: { type: 'boolean' },
      matrix: { type: 'boolean' },
      probe: { type: 'boolean' },
      interactions: { type: 'boolean' },
      navigation: { type: 'boolean' },
      'new-only': { type: 'boolean' },
      'update-baseline': { type: 'boolean' },
      project: { type: 'string', multiple: true },
      repeat: { type: 'string' },
      headed: { type: 'boolean' },
      watch: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const overrides: CliOverrides = {};
  if (values.url !== undefined) overrides.url = values.url;
  if (values.route?.length) overrides.routes = values.route.map((route) => (route.startsWith('/') ? route : `/${route}`));
  if (values.grep !== undefined) overrides.grep = values.grep;
  if (values.scenario?.length) overrides.scenarios = values.scenario;
  if (values.mode !== undefined) {
    if (!MODES.has(values.mode)) throw new UsageError(`--mode must be production, development or both, got "${values.mode}".`);
    overrides.mode = values.mode === 'both' ? 'both' : ((values.mode.startsWith('dev') ? 'development' : 'production') as BuildMode);
  }
  if (values.build !== undefined) overrides.build = values.build;
  if (values.browser !== undefined) {
    if (!BROWSERS.has(values.browser)) throw new UsageError(`--browser must be chromium, firefox or webkit, got "${values.browser}".`);
    overrides.browser = values.browser as BrowserName;
  }
  if (values.channel !== undefined) overrides.channel = values.channel;
  if (values.reporter?.length) {
    const names = values.reporter.flatMap((entry) => entry.split(',')).map((name) => name.trim()).filter(Boolean);
    for (const name of names) if (!REPORTERS.has(name)) throw new UsageError(`Unknown reporter "${name}".`);
    overrides.reporters = names as ReporterName[];
  }
  if (values.output !== undefined) overrides.outputDir = values.output;
  const workers = positiveInt(values.workers, '--workers');
  if (workers !== undefined) overrides.workers = workers;
  const timeout = positiveInt(values.timeout, '--timeout');
  if (timeout !== undefined) overrides.timeout = timeout;
  const retries = positiveInt(values.retries, '--retries', 0);
  if (retries !== undefined) overrides.retries = retries;
  if (values['fail-on'] !== undefined) {
    if (!FAIL_ON.has(values['fail-on'])) throw new UsageError(`--fail-on must be error, warning, info or never.`);
    overrides.failOn = values['fail-on'] as CliOverrides['failOn'] & string;
  }
  if (values.headed) overrides.headed = true;
  if (values.shard !== undefined) {
    const match = /^(\d+)\/(\d+)$/.exec(values.shard);
    if (!match) throw new UsageError(`--shard must look like 2/4, got "${values.shard}".`);
    const index = Number(match[1]);
    const total = Number(match[2]);
    if (total < 1 || index < 1 || index > total) throw new UsageError(`--shard ${values.shard} is out of range.`);
    overrides.shard = { index, total };
  }
  if (values.crawl !== undefined) overrides.crawl = values.crawl;
  if (values.sitemap !== undefined) overrides.sitemap = values.sitemap;
  if (values.cache !== undefined) overrides.cache = values.cache;
  if (values.matrix !== undefined) overrides.matrix = values.matrix;
  if (values.probe !== undefined) overrides.probes = values.probe;
  if (values.interactions !== undefined) overrides.interactions = values.interactions;
  if (values['new-only'] !== undefined) overrides.newOnly = values['new-only'];
  if (values['update-baseline'] !== undefined) overrides.updateBaseline = values['update-baseline'];
  if (values.project?.length) overrides.projects = values.project;
  if (changed !== undefined) overrides.changed = changed;
  if (values.navigation !== undefined) overrides.navigation = values.navigation;
  const repeat = positiveInt(values.repeat, '--repeat');
  if (repeat !== undefined) {
    if (repeat > 100) throw new UsageError('--repeat must be at most 100.');
    overrides.repeat = repeat;
  }

  const result: { overrides: CliOverrides; config?: string; help: boolean; watch?: boolean } = { overrides, help: values.help === true };
  if (values.config !== undefined) result.config = values.config;
  if (values.watch) result.watch = true;
  return result;
}

export async function testCommand(args: string[], context: CommandContext): Promise<number> {
  const parsed = parseTestArgs(args);
  if (parsed.help) {
    context.out(TEST_HELP);
    return ExitCode.Ok;
  }
  if (parsed.watch) {
    return watchTests({
      cwd: context.cwd,
      ...(parsed.config !== undefined ? { config: parsed.config } : {}),
      overrides: parsed.overrides,
      write: context.out,
      signal: context.signal,
    });
  }
  const result = await run({
    cwd: context.cwd,
    ...(parsed.config !== undefined ? { config: parsed.config } : {}),
    overrides: parsed.overrides,
    write: context.out,
    signal: context.signal,
  });
  return result.exitCode;
}
