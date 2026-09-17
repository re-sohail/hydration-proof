import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { Issue } from '../report/model.ts';
import { matchesAny } from '../routes/pattern.ts';

// Who owns a finding: route owners from the config, and CODEOWNERS entries
// for the source file of the finding (last matching line wins, like GitHub).

export interface CodeownersRule {
  pattern: string;
  owners: string[];
  regex: RegExp;
}

function escapeRegex(char: string): string {
  return /[.+^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
}

/** A CODEOWNERS / gitignore-style pattern as a regular expression over repository-relative paths. */
export function codeownersRegex(pattern: string): RegExp {
  let body = pattern;
  const anchored = body.startsWith('/') || body.slice(0, -1).includes('/');
  if (body.startsWith('/')) body = body.slice(1);
  const directory = body.endsWith('/');
  if (directory) body = body.slice(0, -1);
  let source = '';
  for (let i = 0; i < body.length; i++) {
    const char = body[i]!;
    if (char === '*') {
      if (body[i + 1] === '*') {
        if (body[i + 2] === '/') {
          source += '(?:.*/)?';
          i += 2;
        } else {
          source += '.*';
          i += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else if (char === '\\' && i + 1 < body.length) {
      source += escapeRegex(body[++i]!);
    } else {
      source += escapeRegex(char);
    }
  }
  const prefix = anchored ? '^' : '^(?:.*/)?';
  const suffix = directory ? '/.*$' : '(?:/.*)?$';
  return new RegExp(`${prefix}${source}${suffix}`);
}

export function parseCodeowners(text: string): CodeownersRule[] {
  const rules: CodeownersRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/(^|\s)#.*$/, '').trim();
    if (!line || line.startsWith('[')) continue; // blank, comment or GitLab section header
    const parts = line.split(/\s+/);
    const pattern = parts[0]!.replace(/\\#/g, '#');
    const owners = parts.slice(1).filter((owner) => owner.startsWith('@') || owner.includes('@'));
    rules.push({ pattern, owners, regex: codeownersRegex(pattern) });
  }
  return rules;
}

/** Owners of a repository-relative path (POSIX separators); the last matching rule wins. */
export function ownersOf(rules: readonly CodeownersRule[], path: string): string[] {
  for (let i = rules.length - 1; i >= 0; i--) {
    if (rules[i]!.regex.test(path)) return rules[i]!.owners;
  }
  return [];
}

const CODEOWNERS_LOCATIONS = ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS', '.gitlab/CODEOWNERS'];

/** The repository root: the nearest folder with .git, or `start`. */
export function repositoryRoot(start: string): string {
  for (let dir = resolve(start); ; dir = resolve(dir, '..')) {
    if (existsSync(join(dir, '.git'))) return dir;
    if (resolve(dir, '..') === dir) return resolve(start);
  }
}

export interface OwnersOptions {
  rootDir: string;
  routes: Record<string, string[]>;
  /** `true`: look for CODEOWNERS in the usual places; a string: that file. */
  codeowners: boolean | string;
}

export class OwnerResolver {
  private readonly rootDir: string;
  private readonly repository: string;
  private readonly routes: [string, string[]][];
  private readonly rules: CodeownersRule[] = [];
  readonly codeownersFile: string | undefined;

  constructor(options: OwnersOptions) {
    this.rootDir = options.rootDir;
    this.repository = repositoryRoot(options.rootDir);
    this.routes = Object.entries(options.routes);
    if (options.codeowners !== false) {
      const candidates =
        typeof options.codeowners === 'string'
          ? [isAbsolute(options.codeowners) ? options.codeowners : resolve(options.rootDir, options.codeowners)]
          : CODEOWNERS_LOCATIONS.map((file) => join(this.repository, file));
      this.codeownersFile = candidates.find((file) => existsSync(file));
      if (this.codeownersFile) this.rules = parseCodeowners(readFileSync(this.codeownersFile, 'utf8'));
    }
  }

  get active(): boolean {
    return this.routes.length > 0 || this.rules.length > 0;
  }

  ownersFor(issue: Issue): string[] {
    const owners = new Set<string>();
    const path = new URL(issue.route.url).pathname;
    for (const [glob, names] of this.routes) {
      if (matchesAny(path, [glob]) || matchesAny(issue.route.pattern, [glob])) for (const name of names) owners.add(name);
    }
    if (owners.size === 0 && issue.source && this.rules.length > 0) {
      const absolute = resolve(this.rootDir, issue.source.file);
      const repoPath = relative(this.repository, absolute).split(sep).join('/');
      if (!repoPath.startsWith('..')) for (const name of ownersOf(this.rules, repoPath)) owners.add(name);
    }
    return [...owners];
  }

  /** Add owners to every issue that has some. */
  assign(issues: Issue[]): void {
    if (!this.active) return;
    for (const issue of issues) {
      const owners = this.ownersFor(issue);
      if (owners.length > 0) issue.owners = owners;
    }
  }
}
