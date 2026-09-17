import { parseArgs } from 'node:util';
import type { CliOverrides } from '../../config/resolve.ts';
import type { BrowserName, BuildMode, ReporterName } from '../../config/types.ts';
import { ExitCode } from '../../ci/exit-codes.ts';
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
      --mode <mode>         production (default) or development
      --build / --no-build  Always rebuild / never build before testing
      --browser <name>      chromium (default), firefox or webkit
      --channel <name>      Use an installed browser, e.g. chrome
      --reporter <list>     Comma-separated: list,json
  -o, --output <dir>        Report directory (default: .hydration-proof/report)
  -w, --workers <n>         Pages tested in parallel
      --timeout <ms>        Per-page timeout
      --retries <n>         Retries for pages that fail to load
      --fail-on <level>     error (default), warning, info or never
      --headed              Show the browser
  -h, --help                Show this help
`;

const BROWSERS = new Set(['chromium', 'firefox', 'webkit']);
const MODES = new Set(['production', 'development', 'prod', 'dev']);
const REPORTERS = new Set(['list', 'json', 'html', 'junit', 'sarif', 'github', 'gitlab']);
const FAIL_ON = new Set(['error', 'warning', 'info', 'never']);

function positiveInt(value: string | undefined, flag: string, min = 1): number | undefined {
  if (value === undefined) return undefined;
  const number = Number(value);
  if (!Number.isInteger(number) || number < min) throw new UsageError(`${flag} must be an integer >= ${min}, got "${value}".`);
  return number;
}

export function parseTestArgs(args: string[]): { overrides: CliOverrides; config?: string; help: boolean } {
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
      headed: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  const overrides: CliOverrides = {};
  if (values.url !== undefined) overrides.url = values.url;
  if (values.route?.length) overrides.routes = values.route.map((route) => (route.startsWith('/') ? route : `/${route}`));
  if (values.grep !== undefined) overrides.grep = values.grep;
  if (values.scenario?.length) overrides.scenarios = values.scenario;
  if (values.mode !== undefined) {
    if (!MODES.has(values.mode)) throw new UsageError(`--mode must be production or development, got "${values.mode}".`);
    overrides.mode = (values.mode.startsWith('dev') ? 'development' : 'production') as BuildMode;
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

  const result: { overrides: CliOverrides; config?: string; help: boolean } = { overrides, help: values.help === true };
  if (values.config !== undefined) result.config = values.config;
  return result;
}

export async function testCommand(args: string[], context: CommandContext): Promise<number> {
  const parsed = parseTestArgs(args);
  if (parsed.help) {
    context.out(TEST_HELP);
    return ExitCode.Ok;
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
