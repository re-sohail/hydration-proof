import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Browser-side code (the capture runtime, the HTML report client) is built to
// IIFEs first, then inlined into the Node bundle as strings. Nothing is read
// from disk at run time, so the package works the same under npm, pnpm, Yarn
// PnP (zip archives) and Bun.
const PREFIX = 'virtual:hydration-proof/';
const SUFFIX = '?inline-source';

export const browserBuildDir: string = new URL('../.browser-build', import.meta.url).pathname;

export function inlineBrowserBundles(dir: string = browserBuildDir): {
  name: string;
  resolveId(id: string): string | null;
  load(id: string): string | null;
} {
  return {
    name: 'hydration-proof:inline-browser-bundles',
    resolveId(id) {
      return id.startsWith(PREFIX) ? join(dir, `${id.slice(PREFIX.length)}.js`) + SUFFIX : null;
    },
    load(id) {
      if (!id.endsWith(SUFFIX)) return null;
      const file = id.slice(0, -SUFFIX.length);
      const name = file.slice(dir.length + 1, -'.js'.length);
      let code: string;
      try {
        code = readFileSync(file, 'utf8');
      } catch {
        throw new Error(`Browser bundle "${name}" is missing at ${file}. Run the browser build first.`);
      }
      return `export default ${JSON.stringify(code)};`;
    },
  };
}
