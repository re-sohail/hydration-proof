import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Browser-side code (the capture runtime, the HTML report client) is built to
// IIFEs first, then inlined into the Node bundle as strings. Nothing is read
// from disk at run time, so the package works the same under npm, pnpm, Yarn
// PnP (zip archives) and Bun.
const PREFIX = 'virtual:hydration-proof/';

export const browserBuildDir: string = new URL('../.browser-build', import.meta.url).pathname;

export function inlineBrowserBundles(dir: string = browserBuildDir): {
  name: string;
  resolveId(id: string): string | null;
  load(id: string): string | null;
} {
  return {
    name: 'hydration-proof:inline-browser-bundles',
    resolveId(id) {
      return id.startsWith(PREFIX) ? '\0' + id : null;
    },
    load(id) {
      if (!id.startsWith('\0' + PREFIX)) return null;
      const name = id.slice(PREFIX.length + 1);
      const file = join(dir, `${name}.js`);
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
