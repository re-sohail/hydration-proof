import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';
import { ExitCode } from '../../ci/exit-codes.ts';
import { ConfigError, loadConfig } from '../../config/load.ts';
import { resolveConfig } from '../../config/resolve.ts';
import { startDashboard } from '../../dev/dashboard.ts';
import { UsageError, type CommandContext } from '../context.ts';
import { palette } from '../style.ts';

export const UI_HELP = `Usage: hydration-proof ui [options]

Start a local dashboard: run tests from the browser, follow their output and
read the latest report. It listens on 127.0.0.1 only; the printed URL contains
an access token.

Options:
  -c, --config <file>   Config file
  -p, --port <port>     Port (default: a free port)
      --open            Open the dashboard in the default browser
  -h, --help            Show this help
`;

function openBrowser(url: string): void {
  const [command, args] =
    process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]] : ['xdg-open', [url]];
  try {
    const child = spawn(command, args as string[], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The URL is printed anyway.
  }
}

export async function uiCommand(args: string[], context: CommandContext): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      config: { type: 'string', short: 'c' },
      port: { type: 'string', short: 'p' },
      open: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    context.out(UI_HELP);
    return ExitCode.Ok;
  }
  const port = values.port === undefined ? undefined : Number(values.port);
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new UsageError('--port must be a port number.');
  let outputDir: string;
  try {
    const loaded = await loadConfig({ cwd: context.cwd, ...(values.config !== undefined ? { file: values.config } : {}) });
    outputDir = resolveConfig(loaded.config, { rootDir: loaded.rootDir, env: context.env }).outputDir;
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw error;
  }
  const dashboard = await startDashboard({
    cwd: context.cwd,
    ...(values.config !== undefined ? { config: values.config } : {}),
    ...(port !== undefined ? { port } : {}),
    outputDir,
    write: context.out,
  });
  const c = palette(process.stdout);
  context.out(`\n${c.bold('Hydration Proof dashboard')}\n  ${dashboard.url}\n  ${c.gray('Press Ctrl+C to stop.')}\n\n`);
  if (values.open) openBrowser(dashboard.url);
  await new Promise<void>((resolve) => context.signal.addEventListener('abort', () => resolve(), { once: true }));
  await dashboard.close();
  return ExitCode.Ok;
}
