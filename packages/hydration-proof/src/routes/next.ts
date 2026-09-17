import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// Route discovery for Next.js from the file system (App Router and Pages
// Router). Build manifests refine this in a later step.

export interface DiscoveredRoute {
  pattern: string;
  dynamic: boolean;
  router: 'app' | 'pages';
  file: string;
  /** Statuses the route is expected to answer with. */
  expectStatus?: number[];
}

const PAGE_EXTENSIONS = ['tsx', 'ts', 'jsx', 'js', 'mdx', 'md'];
const PAGE_FILE = new RegExp(`^page\\.(${PAGE_EXTENSIONS.join('|')})$`);
const PAGES_FILE = new RegExp(`\\.(${PAGE_EXTENSIONS.join('|')})$`);

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function appSegment(name: string): string | null | undefined {
  // undefined: skip the whole folder; null: folder adds no URL segment.
  if (name.startsWith('_')) return undefined;
  if (name.startsWith('@')) return undefined;
  if (/^\((\.{1,3}|\.\.\)\(\.\.)\)/.test(name)) return undefined;
  if (name.startsWith('(') && name.endsWith(')')) return null;
  return decodeSegment(name);
}

function walkApp(dir: string, segments: string[], root: string, out: DiscoveredRoute[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isFile() && PAGE_FILE.test(entry.name)) {
      const pattern = `/${segments.join('/')}`;
      out.push({ pattern, dynamic: /\[/.test(pattern), router: 'app', file: relative(root, join(dir, entry.name)) });
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    const segment = appSegment(entry.name);
    if (segment === undefined) continue;
    walkApp(join(dir, entry.name), segment === null ? segments : [...segments, segment], root, out);
  }
}

const PAGES_SPECIAL = new Set(['_app', '_document', '_error', '500', 'middleware', '_middleware']);

function walkPages(dir: string, segments: string[], root: string, out: DiscoveredRoute[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (segments.length === 0 && entry.name === 'api') continue;
      if (entry.name === 'node_modules' || entry.name.startsWith('_')) continue;
      walkPages(join(dir, entry.name), [...segments, decodeSegment(entry.name)], root, out);
      continue;
    }
    if (!PAGES_FILE.test(entry.name) || /\.(test|spec|d)\.[jt]sx?$/.test(entry.name)) continue;
    const base = entry.name.replace(PAGES_FILE, '');
    if (segments.length === 0 && PAGES_SPECIAL.has(base)) continue;
    const parts = base === 'index' ? segments : [...segments, decodeSegment(base)];
    const pattern = `/${parts.join('/')}`;
    const route: DiscoveredRoute = { pattern, dynamic: /\[/.test(pattern), router: 'pages', file: relative(root, join(dir, entry.name)) };
    if (segments.length === 0 && base === '404') route.expectStatus = [404];
    out.push(route);
  }
}

export function discoverNextRoutes(rootDir: string): DiscoveredRoute[] {
  const out: DiscoveredRoute[] = [];
  for (const base of ['app', join('src', 'app')]) {
    const dir = join(rootDir, base);
    if (existsSync(dir)) {
      walkApp(dir, [], rootDir, out);
      break;
    }
  }
  for (const base of ['pages', join('src', 'pages')]) {
    const dir = join(rootDir, base);
    if (existsSync(dir)) {
      walkPages(dir, [], rootDir, out);
      break;
    }
  }
  const seen = new Set<string>();
  return out
    .filter((route) => {
      if (seen.has(route.pattern)) return false;
      seen.add(route.pattern);
      return true;
    })
    .map((route) => ({ ...route, file: route.file.split(sep).join('/') }))
    .sort((a, b) => a.pattern.localeCompare(b.pattern));
}
