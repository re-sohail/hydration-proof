import { build } from 'tsdown';

// Unit and browser tests import engine modules that inline the runtime
// bundle, so it has to exist before any test file is loaded.
export default async function setup(): Promise<void> {
  await build({ config: new URL('../../tsdown.browser.config.ts', import.meta.url).pathname, logLevel: 'error' });
}
