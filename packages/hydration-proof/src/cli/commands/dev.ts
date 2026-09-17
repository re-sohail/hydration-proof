import { ExitCode } from '../../ci/exit-codes.ts';
import { devSession } from '../../dev/session.ts';
import type { CommandContext } from '../context.ts';
import { parseTestArgs } from './test.ts';

export const DEV_HELP = `Usage: hydration-proof dev [options]

Open the app in a browser window with a hydration overlay. Every page you open
is checked; findings appear in the overlay (highlight the element, open the
source file in your editor, copy a report) and in the terminal.

The development server is started for you (or use --url).

Options:
  -c, --config <file>     Config file
  -u, --url <url>         Use an app that is already running
  -r, --route <path>      Page to open first (default: the first configured route, or /)
  -s, --scenario <name>   Scenario to browse in (default: the first one)
      --mode <mode>       development (default) or production
      --browser <name>    chromium (default), firefox or webkit
      --channel <name>    Use an installed browser, e.g. chrome
  -h, --help              Show this help

The editor is taken from HYDRATION_PROOF_EDITOR, VISUAL or EDITOR, or the first
of cursor, code, windsurf, zed, webstorm, idea or subl found on PATH.
`;

export async function devCommand(args: string[], context: CommandContext): Promise<number> {
  const parsed = parseTestArgs(args);
  if (parsed.help) {
    context.out(DEV_HELP);
    return ExitCode.Ok;
  }
  return devSession({
    cwd: context.cwd,
    ...(parsed.config !== undefined ? { config: parsed.config } : {}),
    overrides: parsed.overrides,
    write: context.out,
    signal: context.signal,
  });
}
