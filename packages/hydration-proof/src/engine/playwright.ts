import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

// Playwright is resolved from the project first (so its already-installed
// browsers are reused), falling back to the copy bundled with hydration-proof.

export type PlaywrightModule = typeof import('playwright-core');

export const MIN_PLAYWRIGHT = [1, 63] as const;

export interface LoadedPlaywright {
  module: PlaywrightModule;
  version: string;
  /** Directory of the playwright-core package in use. */
  root: string;
  source: 'project' | 'bundled';
}

function versionOf(root: string): string {
  try {
    return (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export function isSupportedVersion(version: string): boolean {
  const [major = 0, minor = 0] = version.split('.').map((part) => Number.parseInt(part, 10));
  return major > MIN_PLAYWRIGHT[0] || (major === MIN_PLAYWRIGHT[0] && minor >= MIN_PLAYWRIGHT[1]);
}

function packageRoot(resolvedEntry: string): string {
  const marker = `${'playwright-core'}`;
  const at = resolvedEntry.lastIndexOf(marker);
  return at === -1 ? resolvedEntry : resolvedEntry.slice(0, at + marker.length);
}

let cached: LoadedPlaywright | undefined;

export async function loadPlaywright(cwd: string = process.cwd()): Promise<LoadedPlaywright> {
  if (cached) return cached;
  try {
    const projectRequire = createRequire(join(cwd, 'package.json'));
    const entry = projectRequire.resolve('playwright-core');
    const root = packageRoot(entry);
    const version = versionOf(root);
    if (isSupportedVersion(version)) {
      const module = (await import(pathToFileURL(entry).href)) as PlaywrightModule & { default?: PlaywrightModule };
      cached = { module: module.chromium ? module : (module.default as PlaywrightModule), version, root, source: 'project' };
      return cached;
    }
  } catch {
    // Not installed in the project; use ours.
  }
  const module = (await import('playwright-core')) as PlaywrightModule;
  const ownRequire = createRequire(import.meta.url);
  const root = packageRoot(ownRequire.resolve('playwright-core'));
  cached = { module, version: versionOf(root), root, source: 'bundled' };
  return cached;
}
