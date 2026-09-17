import { readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { parseArgs } from 'node:util';
import { ExitCode } from '../../ci/exit-codes.ts';
import { findConfigFile, loadConfig } from '../../config/load.ts';
import { applyMigrations, planMigrations } from '../../config/migrate.ts';
import { validateConfig } from '../../config/schema.ts';
import { formatIssues } from '../../config/load.ts';
import { UsageError, type CommandContext } from '../context.ts';
import { palette, symbols } from '../style.ts';

export const MIGRATE_HELP = `Usage: hydration-proof migrate [--write]

Check the config for options that were renamed or replaced, and say what to
change. With --write, the renames that are safe are applied to the file.

Options:
  -c, --config <file>   Config file
      --write           Change the file (a copy is kept as <file>.backup)
  -h, --help            Show this help
`;

export async function migrateCommand(args: string[], context: CommandContext): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: { config: { type: 'string', short: 'c' }, write: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } },
  });
  if (values.help) {
    context.out(MIGRATE_HELP);
    return ExitCode.Ok;
  }
  const c = palette(process.stdout);
  const file = values.config ?? findConfigFile(context.cwd);
  if (!file) throw new UsageError('No config file found. Create one with "hydration-proof init".');
  const loaded = await loadConfig({ cwd: context.cwd, file, validate: false });
  const name = relative(context.cwd, loaded.file ?? file) || file;
  const changes = planMigrations(loaded.config);
  const issues = validateConfig(loaded.config);

  if (changes.length === 0) {
    if (issues.length === 0) {
      context.out(`${c.green(symbols.pass)} ${name} needs no changes.\n`);
      return ExitCode.Ok;
    }
    context.err(`${name} has options this version does not know:\n${formatIssues(issues)}\n\nSee https://hydration.jscrate.dev/docs/configuration\n`);
    return ExitCode.Usage;
  }

  context.out(`\n${c.bold(`${changes.length} change${changes.length === 1 ? '' : 's'} for ${name}`)}\n`);
  for (const change of changes) {
    context.out(`  ${c.yellow(change.from)}${change.to ? ` → ${c.green(change.to)}` : ''}\n    ${c.gray(change.note)}\n`);
  }

  if (!values.write) {
    context.out(`\nRun "hydration-proof migrate --write" to apply the renames that are safe.\n`);
    return ExitCode.Ok;
  }
  const text = readFileSync(file, 'utf8');
  const result = applyMigrations(text, changes);
  if (result.applied.length > 0) {
    writeFileSync(`${file}.backup`, text);
    writeFileSync(file, result.text);
    context.out(`\n${c.green('Updated')} ${name} (${result.applied.length} rename${result.applied.length === 1 ? '' : 's'}); the old file is ${name}.backup\n`);
  }
  if (result.manual.length > 0) {
    context.out(`\n${c.yellow(symbols.warn)} Change these by hand:\n${result.manual.map((change) => `  • ${change.from}: ${change.note}`).join('\n')}\n`);
  }
  return ExitCode.Ok;
}
