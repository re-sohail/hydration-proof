import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Adapter } from '../adapters/index.ts';
import { ExitCode } from '../ci/exit-codes.ts';
import type { ResolvedConfig } from '../config/resolve.ts';
import type { BuildMode } from '../config/types.ts';
import { isReachable, ServerStartError, startServer, type RunningServer } from '../engine/server.ts';
import type { PackageManager } from '../util/package-manager.ts';
import { freePort } from '../util/port.ts';
import { RunError } from './errors.ts';

function runCommand(command: string, cwd: string, env: Record<string, string>, write: (text: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { cwd, env: { ...process.env, ...env }, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const collect = (chunk: Buffer): void => {
      tail = (tail + chunk.toString('utf8')).slice(-8_000);
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => reject(new RunError(`Could not run "${command}": ${error.message}`, ExitCode.Server)));
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new RunError(`"${command}" failed with exit code ${String(code)}.`, ExitCode.Server, tail));
    });
    write(`  Building: ${command}\n`);
  });
}

export async function prepareServer(
  config: ResolvedConfig,
  adapter: Adapter,
  packageManager: PackageManager,
  write: (text: string) => void,
  mode: BuildMode,
): Promise<{ baseUrl: string; server?: RunningServer }> {
  const { server } = config;
  if (server.url !== undefined) {
    if (!(await isReachable(server.url, 10_000))) {
      throw new RunError(`Nothing answers at ${server.url}. Start the app first or remove --url to let hydration-proof start it.`, ExitCode.Server);
    }
    return { baseUrl: server.url };
  }

  const commands = adapter.commands({ rootDir: config.rootDir, packageManager });
  const production = mode === 'production';
  const custom = production
    ? server.mode === 'development'
      ? undefined
      : server.command
    : (server.devCommand ?? (server.mode === 'development' ? server.command : undefined));
  const command = custom ?? (production ? commands.start : commands.dev);
  if (!command) {
    throw new RunError(
      'hydration-proof does not know how to start this app. Set server.command (and server.build) in hydration-proof.config.ts, or pass --url.',
      ExitCode.Usage,
    );
  }

  if (production) {
    const output = commands.buildOutput ? join(server.cwd, commands.buildOutput) : undefined;
    const needed = server.buildWhen === 'always' || (server.buildWhen === 'if-missing' && (output === undefined || !existsSync(output)));
    // A custom start command only gets a build step when one is configured.
    const build = server.build !== undefined ? server.build : custom === undefined ? commands.build : undefined;
    if (build && needed) await runCommand(build, server.cwd, server.env, write);
  }

  const port = server.port ?? (await freePort());
  const host = production ? '127.0.0.1' : (adapter.devHost ?? '127.0.0.1');
  const baseUrl = `http://${host}:${port}`;
  try {
    const running = await startServer({
      name: production ? 'the app' : 'the development server',
      command: command.replaceAll('{port}', String(port)),
      cwd: server.cwd,
      env: { PORT: String(port), ...server.env },
      url: baseUrl,
      timeout: server.timeout,
      reuseExisting: server.reuseExisting && server.port !== undefined,
    });
    return { baseUrl, server: running };
  } catch (error) {
    if (error instanceof ServerStartError) {
      const tail = error.logs.slice(-30).map((line) => line.text).join('\n');
      throw new RunError(error.message, ExitCode.Server, tail);
    }
    throw error;
  }
}
