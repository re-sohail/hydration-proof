import { nextAdapter } from './next.ts';
import type { Adapter } from './types.ts';

export const noneAdapter: Adapter = {
  name: 'none',
  detect: () => true,
  commands: () => ({ start: '', dev: '' }),
  markers: [],
};

export const ADAPTERS: readonly Adapter[] = [nextAdapter];

export function selectAdapter(name: 'auto' | 'next' | 'none', rootDir: string): Adapter {
  if (name === 'next') return nextAdapter;
  if (name === 'none') return noneAdapter;
  return ADAPTERS.find((adapter) => adapter.detect(rootDir)) ?? noneAdapter;
}

export type { Adapter, AdapterCommands, AdapterContext } from './types.ts';
