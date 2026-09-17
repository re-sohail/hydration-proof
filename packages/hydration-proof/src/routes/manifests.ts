import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Routes Next.js already knows about after `next build`: concrete paths of
// pre-rendered dynamic routes (generateStaticParams / getStaticPaths) and
// the i18n locales of the Pages Router.

export interface NextManifestInfo {
  buildId?: string;
  /** Dynamic route pattern -> concrete pre-rendered paths. */
  examples: Map<string, string[]>;
  locales?: { locales: string[]; defaultLocale: string };
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

export function readNextManifests(rootDir: string, distDir = '.next'): NextManifestInfo {
  const dir = join(rootDir, distDir);
  const info: NextManifestInfo = { examples: new Map() };
  const buildIdFile = join(dir, 'BUILD_ID');
  if (existsSync(buildIdFile)) info.buildId = readFileSync(buildIdFile, 'utf8').trim();

  const prerender = readJson(join(dir, 'prerender-manifest.json')) as
    | { routes?: Record<string, { srcRoute?: string | null }> }
    | undefined;
  for (const [path, route] of Object.entries(prerender?.routes ?? {})) {
    const pattern = route?.srcRoute;
    if (!pattern || !pattern.includes('[')) continue;
    const list = info.examples.get(pattern) ?? [];
    list.push(path);
    info.examples.set(pattern, list);
  }

  const routes = readJson(join(dir, 'routes-manifest.json')) as { i18n?: { locales?: string[]; defaultLocale?: string } } | undefined;
  if (routes?.i18n?.locales?.length && routes.i18n.defaultLocale) {
    info.locales = { locales: routes.i18n.locales, defaultLocale: routes.i18n.defaultLocale };
  }
  return info;
}
