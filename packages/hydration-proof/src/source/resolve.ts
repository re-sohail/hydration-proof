import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SourceLocation } from '../report/model.ts';
import { parseComponentStack, type StackFrame } from '../errors/react.ts';
import { SourceMap } from './sourcemap.ts';

// Maps browser stack frames back to project files.

export type FetchText = (url: string) => Promise<string | undefined>;

export interface ResolvedFrame extends SourceLocation {
  /** Absolute path when the file exists locally. */
  absolute?: string;
  /** Full text of the original source, when known. */
  content?: string;
  /** `component`: the location is the declaration of the component that rendered the element. */
  scope?: 'element' | 'component';
}

/**
 * pnpm "injected" workspace packages live in node_modules/.pnpm/<name>@file+<path>.
 * Map such a path back to the workspace source file.
 */
export function workspaceSourceOf(path: string): string | undefined {
  const normalized = path.split(sep).join('/');
  const match = /^(.*?)\/node_modules\/\.pnpm\/[^/]*?@file\+([^_/]+)[^/]*\/node_modules\/((?:@[^/]+\/)?[^/]+)\/(.*)$/.exec(normalized);
  if (!match) return undefined;
  const [, root, encoded, , rest] = match;
  return `${root}/${encoded!.replaceAll('+', '/')}/${rest}`;
}

export function isLibraryPath(path: string): boolean {
  return /(^|[\\/])node_modules[\\/]/.test(path) && workspaceSourceOf(path) === undefined;
}

const REACT_INTERNAL_NAME = /(?:^|\.)(?:jsxDEV|jsxs?|createElement|react[-_]stack[-_](?:top|bottom)[-_]frame|renderWithHooks|callComponentInDEV)$/;
// Chunks that only contain framework code (a shortcut; resolution decides anyway).
const FRAMEWORK_URL = /compiled[\\/_]react|next[\\/_]dist[\\/_]compiled|react-dom[.-]development|react-jsx-dev-runtime|\[turbopack\]|<anonymous>/;

/** Strip bundler prefixes from a source path; returns a project-relative or absolute path. */
export function normalizeSourcePath(source: string): string {
  let path = source.split('?')[0]!.split('#')[0]!;
  if (path.startsWith('file://')) {
    try {
      return fileURLToPath(path);
    } catch {
      return path.slice('file://'.length);
    }
  }
  path = path
    .replace(/^\[project\]\//, '')
    .replace(/^turbopack:\/\/\/?\[project\]\//, '')
    .replace(/^turbopack:\/\/\/?/, '')
    .replace(/^webpack-internal:\/\/\/(?:\([^)]*\)\/)?/, '')
    .replace(/^webpack:\/\/(?:[^/]*)?\//, '')
    .replace(/^\.\//, '');
  return path;
}

export function codeFrame(content: string, line: number, column: number | undefined, context = 2): string {
  const lines = content.split(/\r?\n/);
  const start = Math.max(1, line - context);
  const end = Math.min(lines.length, line + context);
  const width = String(end).length;
  const out: string[] = [];
  for (let current = start; current <= end; current++) {
    const text = (lines[current - 1] ?? '').replace(/\t/g, '  ');
    const marker = current === line ? '>' : ' ';
    out.push(`${marker} ${String(current).padStart(width)} | ${text}`);
    if (current === line && column !== undefined) {
      out.push(`  ${' '.repeat(width)} | ${' '.repeat(Math.max(0, column))}^`);
    }
  }
  return out.join('\n');
}

function sourceMapUrl(script: string, scriptUrl: string, header?: string): string | undefined {
  if (header) return new URL(header, scriptUrl).href;
  const matches = [...script.matchAll(/\/\/[#@]\s*sourceMappingURL=([^\s'"]+)\s*$/gm)];
  const last = matches.at(-1)?.[1];
  if (!last) return undefined;
  if (last.startsWith('data:')) return last;
  return new URL(last, scriptUrl).href;
}

/** 1-based line and 0-based column of a string offset. */
function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let index = text.indexOf('\n'); index >= 0 && index < offset; index = text.indexOf('\n', index + 1)) {
    line++;
    lineStart = index + 1;
  }
  return { line, column: offset - lineStart };
}

function decodeDataUrl(url: string): string | undefined {
  const comma = url.indexOf(',');
  if (comma < 0) return undefined;
  const meta = url.slice(5, comma);
  const data = url.slice(comma + 1);
  return meta.includes(';base64') ? Buffer.from(data, 'base64').toString('utf8') : decodeURIComponent(data);
}

export class SourceResolver {
  private readonly fetchText: FetchText;
  private readonly rootDir: string;
  /** Origins scripts and source maps may be fetched from (empty: any). */
  private readonly origins = new Set<string>();
  /** Origins that were refused, for one note per run. */
  readonly blocked: Set<string> = new Set();
  private readonly maps = new Map<string, Promise<SourceMap | undefined>>();
  private readonly scripts = new Map<string, Promise<string | undefined>>();

  constructor(options: { fetchText: FetchText; rootDir: string; origins?: readonly string[] }) {
    this.fetchText = options.fetchText;
    this.rootDir = options.rootDir;
    for (const origin of options.origins ?? []) this.allowOrigin(origin);
  }

  /** Allow scripts and source maps from this origin (the app, its CDN). */
  allowOrigin(url: string): void {
    try {
      this.origins.add(new URL(url).origin);
    } catch {
      // Not a URL: ignored.
    }
  }

  private allowed(url: string): boolean {
    if (this.origins.size === 0) return true;
    let origin: string;
    try {
      origin = new URL(url).origin;
    } catch {
      return false;
    }
    if (this.origins.has(origin)) return true;
    this.blocked.add(origin);
    return false;
  }

  private scriptText(scriptUrl: string): Promise<string | undefined> {
    const key = scriptUrl.split('#')[0]!;
    let pending = this.scripts.get(key);
    if (!pending) {
      pending = this.allowed(key) ? this.fetchText(key) : Promise.resolve(undefined);
      this.scripts.set(key, pending);
    }
    return pending;
  }

  private mapFor(scriptUrl: string): Promise<SourceMap | undefined> {
    const key = scriptUrl.split('#')[0]!;
    let pending = this.maps.get(key);
    if (!pending) {
      pending = (async () => {
        const script = await this.scriptText(key);
        if (!script) return undefined;
        const url = sourceMapUrl(script, key);
        if (!url) return undefined;
        const text = url.startsWith('data:') ? decodeDataUrl(url) : this.allowed(url) ? await this.fetchText(url) : undefined;
        if (!text) return undefined;
        try {
          return new SourceMap(text);
        } catch {
          return undefined;
        }
      })();
      this.maps.set(key, pending);
    }
    return pending;
  }

  /** Whether a script has a source map that can be loaded. */
  async hasSourceMap(scriptUrl: string): Promise<boolean> {
    if (!/^https?:/.test(scriptUrl)) return false;
    return (await this.mapFor(scriptUrl)) !== undefined;
  }

  /** Resolve a local file path (absolute or project-relative) into a location with a code frame. */
  fromFile(path: string, line: number, column?: number, content?: string): ResolvedFrame {
    const normalized = normalizeSourcePath(path);
    const candidates: string[] = [];
    if (isAbsolute(normalized)) {
      candidates.push(normalized);
    } else {
      // Bundlers resolve paths against their own project root, which in a
      // monorepo is often a parent of the app directory.
      for (let dir = this.rootDir; ; dir = dirname(dir)) {
        candidates.push(resolve(dir, normalized));
        if (dirname(dir) === dir) break;
      }
    }
    const expanded = candidates.flatMap((candidate) => {
      const workspace = workspaceSourceOf(candidate);
      return workspace ? [workspace, candidate] : [candidate];
    });
    const absolute = expanded.find((candidate) => existsSync(candidate));
    const text = content ?? (absolute ? readFileSync(absolute, 'utf8') : undefined);
    const shown = absolute ? relative(this.rootDir, absolute).split(sep).join('/') : normalized;
    const location: ResolvedFrame = { file: shown, line };
    if (column !== undefined) location.column = column + 1;
    if (absolute) location.absolute = absolute;
    if (text !== undefined) {
      location.content = text;
      location.frame = codeFrame(text, line, column);
    }
    return location;
  }

  async resolveFrame(frame: StackFrame): Promise<ResolvedFrame | undefined> {
    if (!frame.url || frame.line === undefined) return undefined;
    if (frame.url.startsWith('file://') || isAbsolute(frame.url)) {
      return this.fromFile(frame.url, frame.line, (frame.column ?? 1) - 1);
    }
    if (!/^https?:/.test(frame.url)) return undefined;
    const map = await this.mapFor(frame.url);
    if (!map) return undefined;
    const original = map.originalPositionFor(frame.line, Math.max(0, (frame.column ?? 1) - 1));
    if (!original || original.ignored) return undefined;
    const path = normalizeSourcePath(original.source);
    if (isLibraryPath(isAbsolute(path) ? path : resolve(this.rootDir, path))) return undefined;
    return this.fromFile(path, original.line, original.column, original.content);
  }

  /**
   * Find a function's source text in the given scripts and map its first
   * token to the original file. The text must occur exactly once across all
   * scripts, so a short or duplicated function never gives a wrong location.
   */
  async resolveFunction(text: string, scriptUrls: readonly string[]): Promise<ResolvedFrame | undefined> {
    let match: { url: string; script: string; offset: number } | undefined;
    for (const url of scriptUrls) {
      if (!/^https?:/.test(url)) continue;
      const script = await this.scriptText(url);
      if (!script) continue;
      const offset = script.indexOf(text);
      if (offset < 0) continue;
      if (match || script.indexOf(text, offset + 1) >= 0) return undefined;
      match = { url, script, offset };
    }
    if (!match) return undefined;
    const map = await this.mapFor(match.url);
    if (!map) return undefined;
    const start = lineAndColumn(match.script, match.offset);
    const end = lineAndColumn(match.script, match.offset + text.length);
    const original = map.firstPositionIn(start.line, start.column, end.line, end.column);
    if (!original || original.ignored) return undefined;
    const path = normalizeSourcePath(original.source);
    if (isLibraryPath(isAbsolute(path) ? path : resolve(this.rootDir, path))) return undefined;
    return { ...this.fromFile(path, original.line, original.column, original.content), scope: 'component' };
  }

  /** The first frame of a creation stack that belongs to application code. */
  async resolveCreationStack(stack: string): Promise<ResolvedFrame | undefined> {
    const frames = parseComponentStack(stack).filter(
      (frame) => frame.url !== undefined && !REACT_INTERNAL_NAME.test(frame.name) && !frame.name.startsWith('Error'),
    );
    for (const frame of frames) {
      if (frame.url && FRAMEWORK_URL.test(frame.url)) continue;
      const resolved = await this.resolveFrame(frame);
      if (resolved) return resolved;
    }
    return undefined;
  }
}
