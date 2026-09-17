// Bundles a harness client for development and production.
import { rolldown } from 'rolldown';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export async function buildClients(packageDir: string): Promise<void> {
  const outDir = join(packageDir, 'dist');
  mkdirSync(outDir, { recursive: true });
  for (const mode of ['development', 'production'] as const) {
    const bundle = await rolldown({
      input: join(packageDir, 'client-entry.ts'),
      platform: 'browser',
      transform: { define: { 'process.env.NODE_ENV': JSON.stringify(mode) } },
      logLevel: 'silent',
    });
    await bundle.write({ file: join(outDir, `client.${mode}.js`), format: 'iife', minify: mode === 'production' });
    await bundle.close();
  }
}
