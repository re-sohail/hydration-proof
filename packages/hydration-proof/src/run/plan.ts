import { join } from 'node:path';
import type { Adapter } from '../adapters/index.ts';
import type { ResolvedConfig } from '../config/resolve.ts';
import type { RouteEntry } from '../config/types.ts';
import { discoveryKey, readCache, writeCache } from '../routes/cache.ts';
import { readNextManifests } from '../routes/manifests.ts';
import type { DiscoveredRoute } from '../routes/next.ts';
import { expandPattern, isDynamicPattern, matchesAny, pathOf } from '../routes/pattern.ts';
import { readSitemaps, type FetchText } from '../routes/sitemap.ts';
import type { PackageManager } from '../util/package-manager.ts';

export interface PlannedRoute extends RouteEntry {
  pattern: string;
  source: 'config' | 'discovered' | 'manifest' | 'sitemap' | 'crawl' | 'not-found';
}

export interface RouteFlags {
  parallel?: boolean;
  intercepted?: boolean;
}

export interface RoutePlan {
  routes: PlannedRoute[];
  /** All known route patterns (static and dynamic), for mapping crawled URLs. */
  patterns: string[];
  /** Framework details of route patterns (parallel and intercepting routes). */
  flags: Record<string, RouteFlags>;
  /** Routes found in the file system (with their source files). */
  discovered: DiscoveredRoute[];
}

export const NOT_FOUND_PATH = '/hydration-proof-not-found';

interface DiscoveryCache {
  discovered: DiscoveredRoute[];
  examples: [string, string[]][];
}

function discover(config: ResolvedConfig, adapter: Adapter, packageManager: PackageManager, notes: string[]): DiscoveryCache {
  if (!adapter.discoverRoutes) return { discovered: [], examples: [] };
  const manifestsFirst = adapter.name === 'next' ? readNextManifests(config.rootDir) : undefined;
  const key = discoveryKey(config.rootDir, ['v2', adapter.name, manifestsFirst?.buildId ?? 'no-build']);
  const file = join(config.rootDir, '.hydration-proof', 'cache', 'routes.json');
  if (config.cache) {
    const cached = readCache<DiscoveryCache>(file, key);
    if (cached) return cached;
  }
  const discovered = adapter.discoverRoutes({ rootDir: config.rootDir, packageManager });
  const examples = manifestsFirst ? [...manifestsFirst.examples] : [];
  const value: DiscoveryCache = { discovered, examples };
  if (config.cache) writeCache(file, key, value);
  void notes;
  return value;
}

function applyFilters(config: ResolvedConfig, routes: PlannedRoute[]): PlannedRoute[] {
  return routes.filter((route) => {
    if (route.source === 'not-found') return true;
    const path = pathOf(route.path);
    if (config.routes.include.length > 0 && !matchesAny(path, config.routes.include) && !matchesAny(route.pattern, config.routes.include)) {
      return false;
    }
    if (matchesAny(path, config.routes.exclude) || matchesAny(route.pattern, config.routes.exclude)) return false;
    if (config.routes.grep && !config.routes.grep.test(route.path)) return false;
    return true;
  });
}

/** Routes known before the app runs: config, file system, build manifests. */
export function planStaticRoutes(
  config: ResolvedConfig,
  adapter: Adapter,
  packageManager: PackageManager,
  notes: string[],
): RoutePlan {
  const planned = new Map<string, PlannedRoute>();
  const patterns = new Set<string>();
  const flags: Record<string, RouteFlags> = {};
  let discoveredRoutes: DiscoveredRoute[] = [];
  const add = (route: RouteEntry, source: PlannedRoute['source'], pattern?: string): void => {
    const resolvedPattern = route.pattern ?? pattern ?? pathOf(route.path);
    patterns.add(resolvedPattern);
    if (!planned.has(route.path)) planned.set(route.path, { ...route, pattern: resolvedPattern, source });
  };

  for (const route of config.routes.paths) add(route, 'config');

  const discoverEnabled = config.routes.discover ?? (config.routes.paths.length === 0 && adapter.discoverRoutes !== undefined);
  if (discoverEnabled) {
    const { discovered, examples } = discover(config, adapter, packageManager, notes);
    discoveredRoutes = discovered;
    const manifestExamples = new Map(examples);
    const skipped: string[] = [];
    for (const route of discovered) {
      patterns.add(route.pattern);
      if (route.parallel || route.intercepted) {
        flags[route.pattern] = { ...(route.parallel ? { parallel: true } : {}), ...(route.intercepted ? { intercepted: true } : {}) };
      }
      if (!route.dynamic) {
        add({ path: route.pattern, ...(route.expectStatus ? { expectStatus: route.expectStatus } : {}) }, 'discovered');
        continue;
      }
      if (config.routes.dynamic[route.pattern]) continue;
      const fromBuild = (manifestExamples.get(route.pattern) ?? []).slice(0, config.routes.manifestExamples);
      if (fromBuild.length > 0) {
        for (const path of fromBuild) add({ path }, 'manifest', route.pattern);
      } else {
        skipped.push(route.pattern);
      }
    }
    if (skipped.length > 0) {
      notes.push(
        `Skipped ${skipped.length} dynamic route${skipped.length === 1 ? '' : 's'} without example values (${skipped.slice(0, 3).join(', ')}${skipped.length > 3 ? ', …' : ''}). Add them under routes.dynamic.`,
      );
    }
  }

  for (const [pattern, values] of Object.entries(config.routes.dynamic)) {
    for (const value of values) add({ path: isDynamicPattern(pattern) ? expandPattern(pattern, value) : pattern }, 'config', pattern);
  }

  // Query variants: for every planned route whose pattern (or path) is listed.
  for (const [target, queries] of Object.entries(config.routes.query)) {
    for (const route of [...planned.values()]) {
      if (route.pattern !== target && pathOf(route.path) !== target) continue;
      for (const query of queries) {
        const suffix = query.startsWith('?') ? query : `?${query}`;
        add({ ...route, path: `${pathOf(route.path)}${suffix}` }, route.source, route.pattern);
      }
    }
  }

  if (planned.size === 0) add({ path: '/' }, 'config');
  return { routes: applyFilters(config, [...planned.values()]), patterns: [...patterns], flags, discovered: discoveredRoutes };
}

/** Routes that need the running app: sitemap and the not-found probe. */
export async function planServerRoutes(
  config: ResolvedConfig,
  adapter: Adapter,
  plan: RoutePlan,
  baseUrl: string,
  fetchText: FetchText,
  notes: string[],
): Promise<RoutePlan> {
  const routes = [...plan.routes];
  const known = new Set(routes.map((route) => route.path));
  const extra: PlannedRoute[] = [];
  if (config.routes.sitemap !== false) {
    const start = typeof config.routes.sitemap === 'string' ? config.routes.sitemap : undefined;
    const sitemap = await readSitemaps(baseUrl, fetchText, start);
    if (sitemap.sources.length === 0) notes.push('No sitemap was found.');
    for (const path of sitemap.paths) {
      if (known.has(path)) continue;
      known.add(path);
      extra.push({ path, pattern: pathOf(path), source: 'sitemap' });
    }
  }
  const notFound = config.routes.notFound ?? adapter.name === 'next';
  if (notFound && !known.has(NOT_FOUND_PATH)) {
    extra.push({ path: NOT_FOUND_PATH, pattern: '(not found)', expectStatus: [404], source: 'not-found' });
  }
  return { ...plan, routes: [...routes, ...applyFilters(config, extra)] };
}

export function routeAllowed(config: ResolvedConfig, path: string): boolean {
  const clean = pathOf(path);
  if (config.routes.include.length > 0 && !matchesAny(clean, config.routes.include)) return false;
  return !matchesAny(clean, config.routes.exclude);
}
