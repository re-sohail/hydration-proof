import { watch, type FSWatcher } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { selectAdapter, UnknownAdapterError } from '../adapters/index.ts';
import { ExitCode } from '../ci/exit-codes.ts';
import { repositoryRoot } from '../ci/owners.ts';
import { palette } from '../cli/style.ts';
import { ConfigError, loadConfig } from '../config/load.ts';
import { resolveConfig, type CliOverrides, type ResolvedConfig } from '../config/resolve.ts';
import type { RouteEntry } from '../config/types.ts';
import type { RunningServer } from '../engine/server.ts';
import { routesAffectedBy } from '../routes/changed.ts';
import { run, RunError } from '../run.ts';
import { planStaticRoutes, type RoutePlan } from '../run/plan.ts';
import { prepareServer } from '../run/server.ts';
import { detectPackageManager } from '../util/package-manager.ts';

// `hydration-proof test --watch`: keep one app server running and test the
// routes affected by every change.

const IGNORED = /(^|[\\/])(node_modules|\.git|\.next|\.turbo|\.hydration-proof|dist|build|out|coverage|\.astro|\.react-router|\.cache)([\\/]|$)/;
const DEBOUNCE_MS = 300;

export interface WatchOptions {
  cwd: string;
  config?: string;
  overrides: CliOverrides;
  write(text: string): void;
  signal: AbortSignal;
}

async function resolveFor(options: WatchOptions, overrides: CliOverrides): Promise<ResolvedConfig> {
  try {
    const loaded = await loadConfig({ cwd: options.cwd, ...(options.config !== undefined ? { file: options.config } : {}) });
    return resolveConfig(loaded.config, { rootDir: loaded.rootDir, ...(loaded.file !== undefined ? { configFile: loaded.file } : {}), overrides });
  } catch (error) {
    if (error instanceof ConfigError) throw new RunError(error.message, ExitCode.Usage);
    throw error;
  }
}

/** Routes of the plan that belong to the affected patterns. */
export function routesFor(plan: RoutePlan, patterns: ReadonlySet<string>): RouteEntry[] {
  return plan.routes
    .filter((route) => route.source !== 'not-found' && patterns.has(route.pattern))
    .map((route) => ({ path: route.path, pattern: route.pattern, ...(route.expectStatus ? { expectStatus: route.expectStatus } : {}) }));
}

export async function watchTests(options: WatchOptions): Promise<number> {
  const c = palette(process.stdout);
  const mode = options.overrides.mode === 'production' || options.overrides.mode === 'both' ? 'production' : 'development';
  const base: CliOverrides = { ...options.overrides, mode, matrix: options.overrides.matrix ?? false };
  const config = await resolveFor(options, base);
  let adapter;
  try {
    adapter = selectAdapter(config.adapter, config.rootDir, config.plugins.flatMap((plugin) => plugin.adapters ?? []));
  } catch (error) {
    if (error instanceof UnknownAdapterError) throw new RunError(error.message, ExitCode.Usage);
    throw error;
  }
  const packageManager = detectPackageManager(config.rootDir);
  const notes: string[] = [];
  const plan = planStaticRoutes(config, adapter, packageManager, notes);
  const repository = repositoryRoot(config.rootDir);

  let server: RunningServer | undefined;
  let watcher: FSWatcher | undefined;
  try {
    const prepared = await prepareServer(config, adapter, packageManager, options.write, mode);
    server = prepared.server;
    const baseUrl = prepared.baseUrl;
    const iteration = async (label: string, entries?: RouteEntry[]): Promise<void> => {
      options.write(`\n${c.gray(`── ${new Date().toLocaleTimeString()} · ${label}`)}\n`);
      try {
        await run({
          cwd: options.cwd,
          ...(options.config !== undefined ? { config: options.config } : {}),
          overrides: { ...base, url: baseUrl, ...(entries ? { routeEntries: entries } : {}) },
          write: options.write,
          signal: options.signal,
        });
      } catch (error) {
        if (options.signal.aborted) return;
        options.write(`\n${c.red('Error:')} ${error instanceof Error ? error.message : String(error)}\n`);
      }
    };

    await iteration('all routes');
    if (options.signal.aborted) return ExitCode.Ok;
    options.write(`\n${c.bold('Watching for changes')} ${c.gray(`in ${relative(options.cwd, config.rootDir) || '.'} — press Ctrl+C to stop`)}\n`);

    const changed = new Set<string>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = Promise.resolve();
    const flush = (): void => {
      const files = [...changed];
      changed.clear();
      running = running.then(async () => {
        if (options.signal.aborted || files.length === 0) return;
        const affected = routesAffectedBy(files, plan.discovered, config.rootDir, repository);
        const names = files.map((file) => relative(config.rootDir, file).split(sep).join('/'));
        const shown = `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}`;
        if (affected.all || plan.discovered.length === 0) {
          await iteration(`${shown} changed: all routes`);
          return;
        }
        const entries = routesFor(plan, affected.patterns);
        if (entries.length === 0) {
          options.write(`${c.gray(`${shown} changed: no route is affected.`)}\n`);
          return;
        }
        await iteration(`${shown} changed: ${entries.length} route${entries.length === 1 ? '' : 's'}`, entries);
      });
    };
    watcher = watch(config.rootDir, { recursive: true }, (_event, name) => {
      if (!name || IGNORED.test(name)) return;
      changed.add(join(config.rootDir, name.toString()));
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, DEBOUNCE_MS);
    });
    await new Promise<void>((resolve) => options.signal.addEventListener('abort', () => resolve(), { once: true }));
    if (timer) clearTimeout(timer);
    await running;
    return ExitCode.Ok;
  } finally {
    watcher?.close();
    await server?.stop();
  }
}
