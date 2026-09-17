import { defineProperty, getOwnPropertyDescriptor, NativeMap, NativeWeakSet } from './env.ts';
import type { FiberRoot, ReactRenderer } from './fiber.ts';

// Installs (or wraps) `__REACT_DEVTOOLS_GLOBAL_HOOK__` before any page script
// runs. React connects to this hook in development and production builds.
//
// Rules learned from React and react-refresh:
// - never set `isDisabled` (it turns off Fast Refresh);
// - keep `renderers` a Map (react-refresh iterates it);
// - `supportsFiber` must be true or React logs "DevTools too old";
// - if something replaces the hook later (the DevTools extension), wrap the
//   replacement too, so nothing is lost.

const HOOK_KEY = '__REACT_DEVTOOLS_GLOBAL_HOOK__';

export interface HookHandlers {
  onInject(id: number, renderer: ReactRenderer): void;
  onCommit(id: number, root: FiberRoot, didError: boolean): void;
  onPostCommit(id: number, root: FiberRoot): void;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyFn = (...args: any[]) => any;
interface DevToolsHook {
  renderers: Map<number, ReactRenderer>;
  supportsFiber: boolean;
  inject: AnyFn;
  onCommitFiberRoot: AnyFn;
  onPostCommitFiberRoot?: AnyFn;
  onCommitFiberUnmount?: AnyFn;
  [key: string]: any;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const wrapped: WeakSet<object> = new NativeWeakSet();

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // The runtime must never break the page under test.
  }
}

function wrapHook(hook: DevToolsHook, handlers: HookHandlers): void {
  if (wrapped.has(hook)) return;
  wrapped.add(hook);

  const inject = hook.inject;
  hook.inject = function (renderer: ReactRenderer) {
    const id: number = inject.call(this, renderer);
    safe(() => handlers.onInject(id, renderer));
    return id;
  };

  const onCommit = hook.onCommitFiberRoot;
  hook.onCommitFiberRoot = function (id: number, root: FiberRoot, priority?: unknown, didError?: boolean) {
    // Ours runs first: it must wrap root.onRecoverableError before React reads it.
    safe(() => handlers.onCommit(id, root, didError === true));
    return onCommit?.call(this, id, root, priority, didError);
  };

  const onPostCommit = hook.onPostCommitFiberRoot;
  hook.onPostCommitFiberRoot = function (id: number, root: FiberRoot) {
    const result = onPostCommit?.call(this, id, root);
    safe(() => handlers.onPostCommit(id, root));
    return result;
  };
}

function createHook(): DevToolsHook {
  let nextId = 0;
  const renderers = new NativeMap<number, ReactRenderer>();
  const noop = (): void => {};
  return {
    renderers,
    supportsFiber: true,
    inject(renderer: ReactRenderer) {
      const id = ++nextId;
      renderers.set(id, renderer);
      return id;
    },
    onCommitFiberRoot: noop,
    onPostCommitFiberRoot: noop,
    onCommitFiberUnmount: noop,
    onScheduleFiberRoot: noop,
    setStrictMode: noop,
    // Presence of checkDCE tells React this is a full DevTools hook, which
    // suppresses the "Download the React DevTools" console message.
    checkDCE: noop,
  };
}

export function installHook(handlers: HookHandlers): void {
  const target = window as unknown as Record<string, unknown>;
  const descriptor = getOwnPropertyDescriptor(target, HOOK_KEY);

  let current: DevToolsHook;
  if (descriptor && 'value' in descriptor && descriptor.value && typeof descriptor.value === 'object') {
    current = descriptor.value as DevToolsHook;
  } else {
    current = createHook();
  }
  wrapHook(current, handlers);

  if (descriptor && !descriptor.configurable) return;
  defineProperty(target, HOOK_KEY, {
    configurable: true,
    enumerable: false,
    get: () => current,
    set: (next: unknown) => {
      if (!next || typeof next !== 'object' || next === current) return;
      const replacement = next as DevToolsHook;
      // Carry over renderers React already injected into the old hook.
      if (replacement.renderers instanceof Map) {
        for (const [id, renderer] of current.renderers) {
          if (!replacement.renderers.has(id)) replacement.renderers.set(id, renderer);
        }
      }
      wrapHook(replacement, handlers);
      current = replacement;
    },
  });
}
