import { ExitCode } from '../../ci/exit-codes.ts';
import { run } from '../../run.ts';
import type { CommandContext } from '../context.ts';
import { parseTestArgs } from './test.ts';

export const BASELINE_HELP = `Usage: hydration-proof baseline [options]

Test the app and record every finding in the baseline file (ci.baseline,
default .hydration-proof/baseline.json). Afterwards,
"hydration-proof test --new-only" fails only on findings that are not in it.

Entries keep the date they were first seen. Add "reason" and "expires"
(YYYY-MM-DD) to an entry by hand; they are kept when the baseline is written
again, and an expired entry fails the run.

Options: the same as "hydration-proof test --help".
`;

export async function baselineCommand(args: string[], context: CommandContext): Promise<number> {
  const parsed = parseTestArgs(args);
  if (parsed.help) {
    context.out(BASELINE_HELP);
    return ExitCode.Ok;
  }
  const result = await run({
    cwd: context.cwd,
    ...(parsed.config !== undefined ? { config: parsed.config } : {}),
    overrides: { ...parsed.overrides, updateBaseline: true, newOnly: false },
    write: context.out,
    signal: context.signal,
  });
  // Recording findings is the point: they do not fail this command.
  return result.exitCode === ExitCode.Failed ? ExitCode.Ok : result.exitCode;
}
