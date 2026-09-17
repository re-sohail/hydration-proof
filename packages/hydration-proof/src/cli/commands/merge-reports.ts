import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import type { ExpiredEntry } from '../../ci/baseline.ts';
import { ExitCode } from '../../ci/exit-codes.ts';
import { expiredRules } from '../../analyze/ignore.ts';
import { loadConfig } from '../../config/load.ts';
import { resolveConfig, type CliOverrides } from '../../config/resolve.ts';
import type { ReporterName } from '../../config/types.ts';
import { copyScreenshots, MergeError, mergeReports, readReport } from '../../report/merge.ts';
import { createReporters } from '../../report/reporters/index.ts';
import { policy } from '../../run/results.ts';
import { UsageError, type CommandContext } from '../context.ts';
import { palette } from '../style.ts';

export const MERGE_HELP = `Usage: hydration-proof merge-reports <report>... [options]

Combine the reports of parallel CI jobs (--shard) into one. Each <report> is a
report folder or a report.json file.

Options:
  -o, --output <dir>      Where the merged reports go (default: .hydration-proof/report)
      --reporter <list>   Comma-separated reporters (default: list,json,html)
  -c, --config <file>     Config for the CI policy (failOn, budgets, ignore rules)
      --fail-on <level>   error (default), warning, info or never
  -h, --help              Show this help
`;

const FAIL_ON = new Set(['error', 'warning', 'info', 'never']);

export async function mergeReportsCommand(args: string[], context: CommandContext): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: true,
    options: {
      output: { type: 'string', short: 'o' },
      reporter: { type: 'string', multiple: true },
      config: { type: 'string', short: 'c' },
      'fail-on': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    context.out(MERGE_HELP);
    return ExitCode.Ok;
  }
  if (positionals.length === 0) throw new UsageError('Name the reports to merge, e.g. hydration-proof merge-reports reports/shard-1 reports/shard-2');
  const overrides: CliOverrides = {};
  if (values.output !== undefined) overrides.outputDir = values.output;
  if (values.reporter?.length) overrides.reporters = values.reporter.flatMap((entry) => entry.split(',')).map((name) => name.trim()).filter(Boolean) as ReporterName[];
  if (values['fail-on'] !== undefined) {
    if (!FAIL_ON.has(values['fail-on'])) throw new UsageError('--fail-on must be error, warning, info or never.');
    overrides.failOn = values['fail-on'] as CliOverrides['failOn'] & string;
  }

  const loaded = await loadConfig({ cwd: context.cwd, ...(values.config !== undefined ? { file: values.config } : {}) });
  const config = resolveConfig(loaded.config, { rootDir: loaded.rootDir, ...(loaded.file ? { configFile: loaded.file } : {}), overrides, env: context.env });

  let inputs;
  try {
    inputs = positionals.map((path) => readReport(path));
  } catch (error) {
    if (error instanceof MergeError) throw new UsageError(error.message);
    throw error;
  }
  const report = mergeReports(inputs);
  const copied = copyScreenshots(inputs, config.outputDir);

  const today = new Date().toISOString().slice(0, 10);
  const expiredBaseline: ExpiredEntry[] = report.issues
    .filter((issue) => issue.baseline?.expires !== undefined && issue.baseline.expires < today)
    .map((issue) => ({
      entry: {
        fingerprint: issue.fingerprint,
        code: issue.code,
        title: issue.title,
        route: issue.route.pattern,
        scenarios: [issue.scenario],
        firstSeen: issue.baseline!.firstSeen,
        lastSeen: today,
        expires: issue.baseline!.expires!,
        ...(issue.selector !== undefined ? { selector: issue.selector } : {}),
      },
    }));
  const failures = policy(config, report, expiredRules(report.issues.filter((issue) => !issue.ignored), config.ignore.issues), expiredBaseline);
  const exitCode = failures.length > 0 ? ExitCode.Failed : ExitCode.Ok;

  const { reporters } = createReporters(config.reporters, context.env);
  const reporterContext = { config, baseUrl: report.run.baseUrl ?? '', totalPages: report.pages.length, write: context.out };
  const c = palette(process.stdout);
  context.out(`\n${c.bold('Hydration Proof')} ${c.gray(`— merged ${inputs.length} report${inputs.length === 1 ? '' : 's'}: ${inputs.map((input) => input.label).join(', ')}`)}\n`);
  if (copied > 0) context.out(`  ${c.gray(`${copied} screenshot${copied === 1 ? '' : 's'} copied to ${relative(context.cwd, config.outputDir) || '.'}`)}\n`);
  for (const reporter of reporters) await reporter.onEnd?.(report, { ...reporterContext, exitCode, failures });
  return exitCode;
}
