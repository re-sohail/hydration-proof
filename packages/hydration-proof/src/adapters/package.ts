import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// package.json helpers shared by the adapters.

export interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

export function readPackage(rootDir: string): PackageJson | undefined {
  try {
    return JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as PackageJson;
  } catch {
    return undefined;
  }
}

export function hasDependency(pkg: PackageJson | undefined, name: string): boolean {
  return pkg?.dependencies?.[name] !== undefined || pkg?.devDependencies?.[name] !== undefined;
}

export function hasAnyFile(rootDir: string, names: readonly string[]): boolean {
  return names.some((name) => existsSync(join(rootDir, name)));
}

export function configFiles(base: string): string[] {
  return ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts'].map((ext) => `${base}.${ext}`);
}
