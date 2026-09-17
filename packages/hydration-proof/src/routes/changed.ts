import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { workspaceSourceOf } from '../source/resolve.ts';
import type { DiscoveredRoute } from './next.ts';

// `--changed`: which routes can be affected by the files changed on a branch.
// An import graph of the project's sources (including workspace packages) is
// walked backwards from the changed files to the route files.

const SOURCE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.cjs', '.mts', '.cts', '.mdx'];
const ASSET_EXTENSIONS = ['.css', '.scss', '.sass', '.less', '.json', '.svg'];
const IMPORT = /(?:\bimport\s*(?:[\w*{}\s,$]+\s*from\s*)?|\bexport\s+(?:\*|\{[^}]*\})\s*from\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;
const SKIPPED_DIRS = new Set(['node_modules', '.next', '.git', 'dist', 'build', 'out', 'coverage', '.turbo', '.hydration-proof']);

/** Files whose change can affect every route. */
const GLOBAL_FILES = [
  /(^|\/)package\.json$/,
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|npm-shrinkwrap\.json)$/,
  /(^|\/)next\.config\.[cm]?[jt]s$/,
  /(^|\/)[tj]sconfig(\.[\w-]+)?\.json$/,
  /(^|\/)(src\/)?(middleware|instrumentation|instrumentation-client)\.[cm]?[jt]sx?$/,
  /(^|\/)\.env(\.[\w.-]+)?$/,
  /(^|\/)(postcss|tailwind|babel)\.config\.[cm]?[jt]s$/,
  /(^|\/)\.babelrc$/,
  /(^|\/)hydration-proof\.config\.[cm]?[jt]s(on)?$/,
];

/** App Router files that wrap the pages below them. */
const APP_WRAPPERS = /^(layout|template|loading|error|not-found|default|global-error)\.(tsx|ts|jsx|js|mdx)$/;
const PAGES_WRAPPERS = /^_(app|document)\.(tsx|ts|jsx|js)$/;

export interface ChangedRoutes {
  /** Every route may be affected (reason given). */
  all: boolean;
  reason?: string;
  /** Route patterns that may be affected. */
  patterns: Set<string>;
  /** Changed files that belong to the app (for the report). */
  relevant: string[];
}

interface PathAliases {
  baseUrl: string;
  paths: [prefix: string, suffix: string, targets: string[]][];
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    // tsconfig files may contain comments and trailing commas.
    const text = readFileSync(file, 'utf8')
      .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_match, string: string | undefined) => string ?? '')
      .replace(/,(\s*[}\]])/g, '$1');
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function aliasesOf(rootDir: string): PathAliases | undefined {
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const file = join(rootDir, name);
    if (!existsSync(file)) continue;
    const options = (readJson(file)?.['compilerOptions'] ?? {}) as { baseUrl?: string; paths?: Record<string, string[]> };
    const baseUrl = resolve(rootDir, options.baseUrl ?? '.');
    const paths = Object.entries(options.paths ?? {}).map(([pattern, targets]): [string, string, string[]] => {
      const star = pattern.indexOf('*');
      return star < 0 ? [pattern, '', targets] : [pattern.slice(0, star), pattern.slice(star + 1), targets];
    });
    return { baseUrl, paths };
  }
  return undefined;
}

function asFile(candidate: string): string | undefined {
  const tries = [candidate, ...SOURCE_EXTENSIONS.map((ext) => candidate + ext), ...SOURCE_EXTENSIONS.map((ext) => join(candidate, `index${ext}`))];
  // `./Button.js` in TypeScript sources means Button.ts.
  const withoutJs = candidate.replace(/\.(m|c)?js$/, '');
  if (withoutJs !== candidate) tries.push(...SOURCE_EXTENSIONS.map((ext) => withoutJs + ext));
  for (const path of tries) {
    try {
      if (statSync(path).isFile()) return path;
    } catch {
      // try the next one
    }
  }
  return undefined;
}

function real(path: string): string {
  try {
    const target = realpathSync(path);
    return workspaceSourceOf(target) ?? target;
  } catch {
    return path;
  }
}

/** Resolve a bare import to a workspace package's source, if it is one. */
function workspaceImport(specifier: string, from: string, repository: string): string | undefined {
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
  const subpath = parts.slice(specifier.startsWith('@') ? 2 : 1).join('/');
  for (let dir = dirname(from); ; dir = dirname(dir)) {
    const link = join(dir, 'node_modules', name);
    if (existsSync(link)) {
      const target = real(link);
      if (!target.startsWith(repository) || target.split(sep).includes('node_modules')) return undefined;
      if (subpath) return asFile(join(target, subpath)) ?? asFile(join(target, 'src', subpath));
      const pkg = readJson(join(target, 'package.json')) as { source?: string; module?: string; main?: string; exports?: unknown } | undefined;
      const exported = typeof pkg?.exports === 'string' ? pkg.exports : typeof (pkg?.exports as Record<string, unknown> | undefined)?.['.'] === 'string' ? ((pkg!.exports as Record<string, string>)['.']) : undefined;
      for (const entry of [pkg?.source, exported, pkg?.module, pkg?.main, 'src/index', 'index']) {
        if (!entry) continue;
        const file = asFile(join(target, entry));
        if (file) return file;
      }
      return undefined;
    }
    if (dirname(dir) === dir || !dir.startsWith(repository)) return undefined;
  }
}

function resolveImport(specifier: string, from: string, aliases: PathAliases | undefined, repository: string): string | undefined {
  if (specifier.startsWith('.')) return asFile(resolve(dirname(from), specifier.split('?')[0]!));
  if (isAbsolute(specifier)) return asFile(specifier);
  if (aliases) {
    for (const [prefix, suffix, targets] of aliases.paths) {
      if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix) || specifier.length < prefix.length + suffix.length) continue;
      const middle = specifier.slice(prefix.length, specifier.length - suffix.length);
      for (const target of targets) {
        const file = asFile(resolve(aliases.baseUrl, target.replace('*', middle)));
        if (file) return file;
      }
    }
  }
  return workspaceImport(specifier, from, repository);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith('.')) sourceFiles(join(dir, entry.name), out);
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

/** Reverse import graph: file → files that import it. */
export function importGraph(rootDir: string, repository: string): Map<string, Set<string>> {
  const aliases = aliasesOf(rootDir);
  const importers = new Map<string, Set<string>>();
  const queue = sourceFiles(rootDir);
  const seen = new Set(queue);
  while (queue.length > 0) {
    const file = queue.pop()!;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const match of text.matchAll(IMPORT)) {
      const target = resolveImport(match[2]!, file, aliases, repository);
      if (!target) continue;
      const set = importers.get(target) ?? new Set<string>();
      set.add(file);
      importers.set(target, set);
      // Follow imports into workspace packages outside the app folder.
      if (!seen.has(target) && SOURCE_EXTENSIONS.some((ext) => target.endsWith(ext))) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return importers;
}

/** The files a route renders through: its page and the wrappers around it. */
function routeRoots(route: DiscoveredRoute, rootDir: string): string[] {
  const page = resolve(rootDir, route.file);
  const roots = [page];
  if (route.router === 'pages') {
    const pagesDir = page.slice(0, page.lastIndexOf(`${sep}pages${sep}`) + `${sep}pages`.length);
    for (const name of readdirSafe(pagesDir)) if (PAGES_WRAPPERS.test(name)) roots.push(join(pagesDir, name));
    return roots;
  }
  const appDir = page.slice(0, page.lastIndexOf(`${sep}app${sep}`) + `${sep}app`.length);
  for (let dir = dirname(page); dir.startsWith(appDir); dir = dirname(dir)) {
    for (const name of readdirSafe(dir)) {
      if (APP_WRAPPERS.test(name)) roots.push(join(dir, name));
      // Parallel route slots render next to the page.
      if (name.startsWith('@')) roots.push(...sourceFiles(join(dir, name)));
    }
    if (dir === appDir) break;
  }
  return roots;
}

function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function routesAffectedBy(changedFiles: readonly string[], routes: readonly DiscoveredRoute[], rootDir: string, repository: string): ChangedRoutes {
  const result: ChangedRoutes = { all: false, patterns: new Set(), relevant: [] };
  const absolute = changedFiles.map((file) => (isAbsolute(file) ? file : resolve(repository, file)));
  for (const file of absolute) {
    const path = relative(repository, file).split(sep).join('/');
    const inApp = !relative(rootDir, file).startsWith('..');
    const global = GLOBAL_FILES.find((pattern) => pattern.test(path));
    // Global files count when they belong to this app or to the repository root.
    if (global && (inApp || dirname(file) === repository)) {
      result.all = true;
      result.reason = `${path} changed`;
      result.relevant.push(path);
    }
  }
  if (result.all) return result;

  const importers = importGraph(rootDir, repository);
  const reached = new Set<string>();
  const queue = absolute.filter((file) => SOURCE_EXTENSIONS.some((ext) => file.endsWith(ext)) || ASSET_EXTENSIONS.some((ext) => file.endsWith(ext)));
  for (const file of queue) reached.add(file);
  while (queue.length > 0) {
    const file = queue.pop()!;
    for (const importer of importers.get(file) ?? []) {
      if (reached.has(importer)) continue;
      reached.add(importer);
      queue.push(importer);
    }
  }
  const allRoots = new Set<string>();
  for (const route of routes) {
    const roots = routeRoots(route, rootDir);
    for (const root of roots) allRoots.add(root);
    if (roots.some((root) => reached.has(root))) result.patterns.add(route.pattern);
  }
  for (const file of absolute) {
    if (importers.has(file) || allRoots.has(file)) result.relevant.push(relative(repository, file).split(sep).join('/'));
  }
  return result;
}
