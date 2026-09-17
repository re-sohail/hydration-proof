import { astroAdapter } from './astro.ts';
import { nextAdapter } from './next.ts';
import { nodeAdapter } from './node.ts';
import { reactRouterAdapter } from './react-router.ts';
import { remixAdapter } from './remix.ts';
import type { Adapter } from './types.ts';
import { viteAdapter } from './vite.ts';

export const noneAdapter: Adapter = {
  name: 'none',
  detect: () => true,
  commands: () => ({ start: '', dev: '' }),
  markers: [],
};

/** Built-in adapters, in detection order (most specific first). */
export const ADAPTERS: readonly Adapter[] = [nextAdapter, reactRouterAdapter, remixAdapter, astroAdapter, viteAdapter, nodeAdapter];

export type AdapterName = 'auto' | 'next' | 'react-router' | 'remix' | 'astro' | 'vite' | 'node' | 'none';

export class UnknownAdapterError extends Error {
  override name = 'UnknownAdapterError';
}

/** The adapter for a config value: a name, `auto` (detected), or an adapter object. */
export function selectAdapter(choice: string | Adapter, rootDir: string, extra: readonly Adapter[] = []): Adapter {
  if (typeof choice === 'object') return choice;
  const all = [...extra, ...ADAPTERS];
  if (choice === 'none') return noneAdapter;
  if (choice === 'auto') return all.find((adapter) => adapter.detect(rootDir)) ?? noneAdapter;
  const found = all.find((adapter) => adapter.name === choice);
  if (!found) {
    throw new UnknownAdapterError(`Unknown adapter "${choice}". Available: auto, ${all.map((adapter) => adapter.name).join(', ')}, none.`);
  }
  return found;
}

export type { Adapter, AdapterCommands, AdapterContext, AdapterNavigation } from './types.ts';
