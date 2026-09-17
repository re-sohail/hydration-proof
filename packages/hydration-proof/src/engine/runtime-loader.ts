import type { Page } from 'playwright-core';
import runtimeSource from 'virtual:hydration-proof/runtime';
import {
  DEFAULT_RUNTIME_OPTIONS,
  PROTOCOL_VERSION,
  RUNTIME_GLOBAL,
  RUNTIME_OPTIONS_GLOBAL,
  type DrainPayload,
  type NodeRect,
  type NodeSource,
  type RuntimeOptions,
  type RuntimeStatus,
  type SnapshotKind,
} from '../shared/protocol.ts';

export class RuntimeUnavailableError extends Error {
  override name = 'RuntimeUnavailableError';
}

/** The init script: options assignment followed by the runtime IIFE. */
export function runtimeScript(options: Partial<RuntimeOptions> = {}): string {
  const merged: RuntimeOptions = { ...DEFAULT_RUNTIME_OPTIONS, ...options };
  return `window[${JSON.stringify(RUNTIME_OPTIONS_GLOBAL)}]=${JSON.stringify(merged)};\n${runtimeSource}`;
}

function checkVersion(version: unknown): void {
  if (version !== PROTOCOL_VERSION) {
    throw new RuntimeUnavailableError(
      version === undefined
        ? 'The hydration-proof runtime is not installed in this page.'
        : `Runtime protocol ${String(version)} does not match engine protocol ${PROTOCOL_VERSION}.`,
    );
  }
}

export async function readStatus(page: Page): Promise<RuntimeStatus> {
  const status = await page.evaluate((key) => {
    const api = (globalThis as unknown as Record<string, { status(): unknown } | undefined>)[key];
    return api ? api.status() : undefined;
  }, RUNTIME_GLOBAL);
  if (status === undefined) throw new RuntimeUnavailableError('The hydration-proof runtime is not installed in this page.');
  const typed = status as RuntimeStatus;
  checkVersion(typed.version);
  return typed;
}

export async function drainRuntime(page: Page): Promise<DrainPayload> {
  const payload = await page.evaluate((key) => {
    const api = (globalThis as unknown as Record<string, { drain(): unknown } | undefined>)[key];
    return api ? api.drain() : undefined;
  }, RUNTIME_GLOBAL);
  if (payload === undefined) throw new RuntimeUnavailableError('The hydration-proof runtime is not installed in this page.');
  const typed = payload as DrainPayload;
  checkVersion(typed.version);
  return typed;
}

export async function requestSnapshot(page: Page, kind: SnapshotKind): Promise<number> {
  return page.evaluate(
    ([key, snapshotKind]) => {
      const api = (globalThis as unknown as Record<string, { snapshot(kind: string): number } | undefined>)[key];
      return api ? api.snapshot(snapshotKind) : -1;
    },
    [RUNTIME_GLOBAL, kind] as const,
  );
}

export async function nodeSources(page: Page, ids: number[]): Promise<NodeSource[]> {
  if (ids.length === 0) return [];
  return page.evaluate(
    ([key, list]) => {
      const api = (globalThis as unknown as Record<string, { sources(ids: number[]): unknown } | undefined>)[key];
      return api ? api.sources(list) : [];
    },
    [RUNTIME_GLOBAL, ids] as const,
  ) as Promise<NodeSource[]>;
}

export async function nodeRects(page: Page, ids: number[]): Promise<NodeRect[]> {
  if (ids.length === 0) return [];
  return page.evaluate(
    ([key, list]) => {
      const api = (globalThis as unknown as Record<string, { rects(ids: number[]): unknown } | undefined>)[key];
      return api ? api.rects(list) : [];
    },
    [RUNTIME_GLOBAL, ids] as const,
  ) as Promise<NodeRect[]>;
}
