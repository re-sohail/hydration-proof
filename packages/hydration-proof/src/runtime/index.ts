// Entry point of the in-page runtime. Bundled to an IIFE and injected with
// Playwright's addInitScript, so it runs before any script of the page.

import {
  DEFAULT_RUNTIME_OPTIONS,
  RUNTIME_GLOBAL,
  RUNTIME_OPTIONS_GLOBAL,
  type RuntimeOptions,
} from '../shared/protocol.ts';
import { startRuntime } from './controller.ts';
import { defineProperty } from './env.ts';

function readOptions(): RuntimeOptions {
  const record = window as unknown as Record<string, unknown>;
  const given = record[RUNTIME_OPTIONS_GLOBAL];
  try {
    delete record[RUNTIME_OPTIONS_GLOBAL];
  } catch {
    // Non-configurable in some engines; harmless.
  }
  if (given === null || typeof given !== 'object') return DEFAULT_RUNTIME_OPTIONS;
  return { ...DEFAULT_RUNTIME_OPTIONS, ...(given as Partial<RuntimeOptions>) };
}

(function install(): void {
  // Only the top-level document is under test.
  if (window.top !== window) return;
  if (Object.prototype.hasOwnProperty.call(window, RUNTIME_GLOBAL)) return;
  const api = startRuntime(readOptions());
  defineProperty(window, RUNTIME_GLOBAL, {
    value: Object.freeze(api),
    enumerable: false,
    configurable: false,
    writable: false,
  });
})();
