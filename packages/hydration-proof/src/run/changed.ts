import { realpathSync } from 'node:fs';
import type { Adapter } from '../adapters/index.ts';
import { ExitCode } from '../ci/exit-codes.ts';
import { repositoryRoot } from '../ci/owners.ts';
import type { ResolvedConfig } from '../config/resolve.ts';
import { routesAffectedBy } from '../routes/changed.ts';
import { patternFor } from '../routes/crawl.ts';
import { changedFiles, defaultBaseRef } from '../util/git.ts';
import { RunError } from './errors.ts';
import type { PlannedRoute, RoutePlan } from './plan.ts';

// `--changed [ref]`: keep only the routes the changed files can affect.

export type RouteFilter = (route: PlannedRoute) => boolean;

function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function changedRouteFilter(config: ResolvedConfig, adapter: Adapter, plan: RoutePlan, notes: string[]): RouteFilter | undefined {
  if (!config.changed) return undefined;
  const rootDir = real(config.rootDir);
  const repository = real(repositoryRoot(rootDir));
  const ref = config.changed.ref === true ? defaultBaseRef(rootDir) : config.changed.ref;
  const files = changedFiles(rootDir, ref);
  if (files === undefined) {
    throw new RunError(`--changed: cannot compare with "${ref}" (is this a git repository, and was the ref fetched? In CI, use a full clone: fetch-depth: 0).`, ExitCode.Usage);
  }
  if (adapter.discoverRoutes === undefined || plan.discovered.length === 0) {
    notes.push(`--changed: ${files.length} changed file${files.length === 1 ? '' : 's'} since ${ref}, but routes cannot be mapped to files without a framework adapter; testing every route.`);
    return undefined;
  }
  const affected = routesAffectedBy(files, plan.discovered, rootDir, repository);
  if (affected.all) {
    notes.push(`--changed: ${affected.reason} since ${ref}; testing every route.`);
    return undefined;
  }
  const known = new Set(plan.discovered.map((route) => route.pattern));
  const patterns = [...known];
  notes.push(
    affected.patterns.size === 0
      ? `--changed: no route is affected by the ${files.length} file${files.length === 1 ? '' : 's'} changed since ${ref}.`
      : `--changed: ${affected.patterns.size} of ${known.size} routes are affected by files changed since ${ref} (${affected.relevant.slice(0, 3).join(', ')}${affected.relevant.length > 3 ? ', …' : ''}).`,
  );
  return (route) => {
    if (route.source === 'not-found') return affected.patterns.size > 0;
    const pattern = known.has(route.pattern) ? route.pattern : patternFor(route.path, patterns);
    // Routes that do not map to a known file (config-only paths) are kept.
    return !known.has(pattern) || affected.patterns.has(pattern);
  };
}
