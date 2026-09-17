// Prints the size of every published file (unpacked and gzipped).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const root = new URL('..', import.meta.url).pathname;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)],
  );
}

let total = 0;
let totalGzip = 0;
for (const file of files(join(root, 'dist')).sort()) {
  const bytes = statSync(file).size;
  const gzip = gzipSync(readFileSync(file)).length;
  total += bytes;
  totalGzip += gzip;
  console.log(`${relative(root, file).padEnd(24)} ${(bytes / 1024).toFixed(1).padStart(8)} KB ${(gzip / 1024).toFixed(1).padStart(8)} KB gzip`);
}
console.log(`${'total'.padEnd(24)} ${(total / 1024).toFixed(1).padStart(8)} KB ${(totalGzip / 1024).toFixed(1).padStart(8)} KB gzip`);
