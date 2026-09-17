import { ExitCode } from '../ci/exit-codes.ts';
import { ConfigError } from '../config/load.ts';
import { RunError } from '../run.ts';
import { VERSION } from '../util/version.ts';
import { baselineCommand, BASELINE_HELP } from './commands/baseline.ts';
import { devCommand, DEV_HELP } from './commands/dev.ts';
import { doctorCommand, DOCTOR_HELP, nodeSupported } from './commands/doctor.ts';
import { initCommand, INIT_HELP } from './commands/init.ts';
import { installCommand, INSTALL_HELP } from './commands/install.ts';
import { mergeReportsCommand, MERGE_HELP } from './commands/merge-reports.ts';
import { migrateCommand, MIGRATE_HELP } from './commands/migrate.ts';
import { testCommand, TEST_HELP } from './commands/test.ts';
import { uiCommand, UI_HELP } from './commands/ui.ts';
import { UsageError, type CommandContext } from './context.ts';
import { palette } from './style.ts';

export const HELP: string = `hydration-proof ${VERSION}
Find, explain and prevent React hydration problems.

Usage: hydration-proof <command> [options]

Commands:
  test            Test the app's routes for hydration problems (default)
  baseline        Record the current findings; "test --new-only" then fails only on new ones
  merge-reports   Combine the reports of parallel CI jobs
  dev             Browse the app with a hydration overlay
  ui              Open a local dashboard to run tests and read reports
  init            Create hydration-proof.config.ts (and a CI workflow with --ci)
  migrate         Update a config written for an older version
  install         Download the browser (Chromium by default)
  doctor          Check the environment and configuration

Run "hydration-proof <command> --help" for command options.
Docs: https://hydration.jscrate.dev
`;

type Command = (args: string[], context: CommandContext) => Promise<number>;

/** `interactive` commands run until Ctrl+C, which is a normal way to stop them. */
const COMMANDS: Record<string, { run: Command; help: string; interactive?: boolean }> = {
  test: { run: testCommand, help: TEST_HELP },
  baseline: { run: baselineCommand, help: BASELINE_HELP },
  'merge-reports': { run: mergeReportsCommand, help: MERGE_HELP },
  dev: { run: devCommand, help: DEV_HELP, interactive: true },
  ui: { run: uiCommand, help: UI_HELP, interactive: true },
  migrate: { run: migrateCommand, help: MIGRATE_HELP },
  init: { run: initCommand, help: INIT_HELP },
  install: { run: installCommand, help: INSTALL_HELP },
  doctor: { run: doctorCommand, help: DOCTOR_HELP },
};

export async function main(argv: string[], overrides: Partial<CommandContext> = {}): Promise<number> {
  const out = overrides.out ?? ((text: string) => void process.stdout.write(text));
  const err = overrides.err ?? ((text: string) => void process.stderr.write(text));
  const c = palette(process.stderr);

  if (!nodeSupported()) {
    err(`hydration-proof needs Node.js 22.18 or newer (found ${process.versions.node}).\n`);
    return ExitCode.Usage;
  }

  const [first, ...rest] = argv;
  if (first === '--version' || first === '-v') {
    out(`${VERSION}\n`);
    return ExitCode.Ok;
  }
  if (first === '--help' || first === '-h' || first === 'help') {
    const topic = first === 'help' ? rest[0] : undefined;
    out(topic && COMMANDS[topic] ? COMMANDS[topic].help : HELP);
    return ExitCode.Ok;
  }

  const name = first === undefined || first.startsWith('-') ? 'test' : first;
  const args = first === undefined || first.startsWith('-') ? argv : rest;
  const command = COMMANDS[name];
  if (!command) {
    err(`Unknown command "${name}".\n\n${HELP}`);
    return ExitCode.Usage;
  }

  const watching = name === 'test' && args.includes('--watch');
  const controller = new AbortController();
  let interrupted = false;
  const onSignal = (): void => {
    if (interrupted) process.exit(ExitCode.Interrupted);
    interrupted = true;
    err(command.interactive || watching ? '\nStopping…\n' : '\nStopping… (press Ctrl+C again to force)\n');
    controller.abort();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  const context: CommandContext = {
    cwd: overrides.cwd ?? process.cwd(),
    out,
    err,
    signal: overrides.signal ?? controller.signal,
    env: overrides.env ?? process.env,
  };

  try {
    const code = await command.run(args, context);
    if (interrupted && (command.interactive || watching)) return code;
    return interrupted ? ExitCode.Interrupted : code;
  } catch (error) {
    if (interrupted) return ExitCode.Interrupted;
    if (error instanceof UsageError || (error instanceof Error && 'code' in error && String((error as { code: unknown }).code).startsWith('ERR_PARSE_ARGS'))) {
      err(`${c.red('Error:')} ${error.message}\nRun "hydration-proof ${name} --help" for usage.\n`);
      return ExitCode.Usage;
    }
    if (error instanceof ConfigError) {
      err(`${c.red('Configuration error:')} ${error.message}\n`);
      return ExitCode.Usage;
    }
    if (error instanceof RunError) {
      err(`\n${c.red('Error:')} ${error.message}\n`);
      if (error.details) err(`${c.dim(error.details.trimEnd())}\n`);
      return error.exitCode;
    }
    err(`\n${c.red('Unexpected error')} (this is a bug in hydration-proof, please report it):\n`);
    err(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
    return ExitCode.Internal;
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
}
