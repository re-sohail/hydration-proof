import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Remembers discovered routes between runs. The key covers the build id and
// the route source folders, so any change invalidates it.

interface CacheFile<T> {
  version: 1;
  key: string;
  value: T;
}

function newestMtime(dir: string, depth = 0): number {
  if (!existsSync(dir) || depth > 12) return 0;
  let newest = statSync(dir).mtimeMs;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) newest = Math.max(newest, newestMtime(join(dir, entry.name), depth + 1));
  }
  return newest;
}

export function discoveryKey(rootDir: string, parts: readonly string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part).update('\n');
  for (const folder of ['app', 'pages', join('src', 'app'), join('src', 'pages')]) {
    hash.update(`${folder}:${newestMtime(join(rootDir, folder))}\n`);
  }
  return hash.digest('hex').slice(0, 20);
}

export function readCache<T>(file: string, key: string): T | undefined {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8')) as CacheFile<T>;
    return data.version === 1 && data.key === key ? data.value : undefined;
  } catch {
    return undefined;
  }
}

export function writeCache<T>(file: string, key: string, value: T): void {
  try {
    mkdirSync(join(file, '..'), { recursive: true });
    const data: CacheFile<T> = { version: 1, key, value };
    writeFileSync(file, JSON.stringify(data));
  } catch {
    // A cache that cannot be written is not an error.
  }
}
