import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { DiscoveredRoute } from './next.ts';

// Route discovery for React Router (framework mode), Remix and Astro.

/** A route as `react-router routes --json` and `remix routes --json` print it. */
export interface RouteTreeNode {
  id?: string;
  path?: string;
  index?: boolean;
  file?: string;
  children?: RouteTreeNode[];
}

/** `:id` → `[id]`, `:id?` → `[[id]]`, `*` → `[...splat]`; optional static segments are kept. */
export function toPatternSegment(segment: string): string {
  if (segment === '*') return '[...splat]';
  const param = /^:([\w-]+)(\?)?$/.exec(segment);
  if (param) return param[2] ? `[[${param[1]}]]` : `[${param[1]}]`;
  return segment.replace(/\?$/, '');
}

function joinPattern(parent: string, path: string | undefined): string {
  if (path === undefined || path === '') return parent;
  if (path.startsWith('/')) return normalize(path);
  return normalize(`${parent}/${path}`);
}

function normalize(path: string): string {
  const segments = path.split('/').filter(Boolean).map(toPatternSegment);
  return `/${segments.join('/')}`;
}

/** Flatten a route tree into URL patterns with the files that render them. */
export function flattenRouteTree(nodes: readonly RouteTreeNode[], appDirectory: string): DiscoveredRoute[] {
  const out = new Map<string, DiscoveredRoute>();
  const visit = (node: RouteTreeNode, parentPattern: string, wrappers: string[]): void => {
    const pattern = node.index ? parentPattern : joinPattern(parentPattern, node.path);
    const file = node.file ? join(appDirectory, node.file).split(sep).join('/') : undefined;
    const children = node.children ?? [];
    const renders = node.index === true || (node.path !== undefined && node.path !== '' && children.every((child) => !child.index));
    if (renders && file && !out.has(pattern)) {
      const route: DiscoveredRoute = { pattern, dynamic: /\[/.test(pattern), router: 'react-router', file };
      if (wrappers.length > 0) route.wrappers = [...wrappers];
      out.set(pattern, route);
    }
    for (const child of children) visit(child, pattern, file ? [...wrappers, file] : wrappers);
  };
  for (const node of nodes) visit(node, '/', []);
  return [...out.values()].sort((a, b) => a.pattern.localeCompare(b.pattern));
}

/** Run a framework CLI that prints the route tree as JSON. */
export function routeTreeFromCli(command: string, args: readonly string[], cwd: string): RouteTreeNode[] | undefined {
  try {
    const output = execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 60_000,
      shell: process.platform === 'win32',
      env: { ...process.env, NODE_ENV: 'production' },
    });
    const start = output.indexOf('[');
    if (start < 0) return undefined;
    const parsed = JSON.parse(output.slice(start)) as unknown;
    return Array.isArray(parsed) ? (parsed as RouteTreeNode[]) : undefined;
  } catch {
    return undefined;
  }
}

/** The binary of a package installed in the project (works for npm, pnpm, yarn and bun layouts). */
export function localBin(rootDir: string, name: string): string | undefined {
  for (let dir = rootDir; ; dir = join(dir, '..')) {
    const bin = join(dir, 'node_modules', '.bin', process.platform === 'win32' ? `${name}.cmd` : name);
    if (existsSync(bin)) return bin;
    if (join(dir, '..') === dir) return undefined;
  }
}

const ASTRO_PAGES = /\.(astro|md|mdx|markdown|html)$/;

/** Astro file-based routes from `src/pages`. */
export function discoverAstroRoutes(rootDir: string, pagesDir: string = join('src', 'pages')): DiscoveredRoute[] {
  const root = join(rootDir, pagesDir);
  const out: DiscoveredRoute[] = [];
  const walk = (dir: string, segments: string[]): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;
      if (entry.isDirectory()) {
        walk(join(dir, entry.name), [...segments, entry.name]);
        continue;
      }
      if (!ASTRO_PAGES.test(entry.name)) continue;
      const base = entry.name.replace(ASTRO_PAGES, '');
      const parts = base === 'index' ? segments : [...segments, base];
      const pattern = `/${parts.join('/')}`;
      out.push({ pattern, dynamic: /\[/.test(pattern), router: 'astro', file: relative(rootDir, join(dir, entry.name)).split(sep).join('/') });
    }
  };
  walk(root, []);
  return out.sort((a, b) => a.pattern.localeCompare(b.pattern));
}
