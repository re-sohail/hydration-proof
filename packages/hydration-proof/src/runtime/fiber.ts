// Minimal, version-tolerant access to React's internal fiber tree. Everything
// here is read-only and defensive: React internals are not a public API, so
// every accessor returns `undefined` instead of throwing when a shape changes.

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Fiber {
  tag: number;
  type: any;
  elementType: any;
  key: string | null;
  stateNode: any;
  return: Fiber | null;
  child: Fiber | null;
  sibling: Fiber | null;
  alternate: Fiber | null;
  memoizedProps: any;
  memoizedState: any;
  flags: number;
  _debugOwner?: any;
  _debugStack?: any;
}

export interface FiberRoot {
  current: Fiber;
  containerInfo: any;
  identifierPrefix?: string;
  onRecoverableError?: (...args: any[]) => void;
  onCaughtError?: (...args: any[]) => void;
  onUncaughtError?: (...args: any[]) => void;
}

export interface ReactRenderer {
  version?: string;
  reconcilerVersion?: string;
  rendererPackageName?: string;
  bundleType?: number;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// ReactWorkTags, stable across React 18 and 19.
export const FunctionComponent = 0;
export const ClassComponent = 1;
export const HostRoot = 3;
export const HostPortal = 4;
export const HostComponent = 5;
export const HostText = 6;
export const ForwardRef = 11;
export const SuspenseComponent = 13;
export const MemoComponent = 14;
export const SimpleMemoComponent = 15;
export const LazyComponent = 16;
export const DehydratedFragment = 18;
export const OffscreenComponent = 22;
export const HostHoistable = 26;
export const HostSingleton = 27;
export const ActivityComponent = 31;

const COMPONENT_TAGS: ReadonlySet<number> = new Set([
  FunctionComponent, ClassComponent, ForwardRef, MemoComponent, SimpleMemoComponent, LazyComponent,
]);

const FIBER_PREFIX = '__reactFiber$';
const PROPS_PREFIX = '__reactProps$';
const CONTAINER_PREFIX = '__reactContainer$';

/** Random suffixes React appended to its expando keys (one per react-dom copy). */
const suffixes: string[] = [];

/** Learn the expando suffix from a root container (`__reactContainer$<suffix>`). */
export function learnSuffixes(container: object | null | undefined): void {
  if (container === null || container === undefined) return;
  for (const key of Object.keys(container)) {
    if (key.startsWith(CONTAINER_PREFIX)) {
      const suffix = key.slice(CONTAINER_PREFIX.length);
      if (!suffixes.includes(suffix)) suffixes.push(suffix);
    }
  }
}

function expando(node: Node, prefix: string): unknown {
  const record = node as unknown as Record<string, unknown>;
  for (const suffix of suffixes) {
    const value = record[prefix + suffix];
    if (value !== undefined) return value;
  }
  return undefined;
}

export function fiberOf(node: Node): Fiber | undefined {
  return expando(node, FIBER_PREFIX) as Fiber | undefined;
}

export function hostPropsOf(node: Node): Record<string, unknown> | undefined {
  const props = expando(node, PROPS_PREFIX);
  return props !== null && typeof props === 'object' ? (props as Record<string, unknown>) : undefined;
}

export function isComponentFiber(fiber: Fiber): boolean {
  return COMPONENT_TAGS.has(fiber.tag);
}

export function componentName(fiber: Fiber): string | undefined {
  let type = fiber.type;
  if (type === null || type === undefined) return undefined;
  if (typeof type === 'string') return type;
  if (fiber.tag === ForwardRef && typeof type === 'object') {
    return type.displayName ?? type.render?.displayName ?? type.render?.name ?? undefined;
  }
  if ((fiber.tag === MemoComponent || fiber.tag === SimpleMemoComponent) && typeof type === 'object') {
    type = type.type ?? type;
  }
  if (typeof type === 'function') return type.displayName || type.name || undefined;
  if (typeof type === 'object') {
    return type.displayName ?? type.type?.displayName ?? type.type?.name ?? type.render?.name ?? undefined;
  }
  return undefined;
}

/** Nearest component that rendered this host fiber. */
export function ownerName(fiber: Fiber): string | undefined {
  const owner = fiber._debugOwner;
  if (owner !== null && owner !== undefined) {
    if (typeof owner.tag === 'number') {
      const name = componentName(owner as Fiber);
      if (name) return name;
    } else if (typeof owner.name === 'string') {
      return owner.name;
    }
  }
  for (let current = fiber.return; current !== null; current = current.return) {
    if (isComponentFiber(current)) {
      const name = componentName(current);
      if (name) return name;
    }
    if (current.tag === HostRoot) break;
  }
  return undefined;
}

const MAX_OWNERS = 8;

/** Component names that led to this host fiber, innermost first. */
export function ownerChain(fiber: Fiber): string[] {
  const names: string[] = [];
  const debug = fiber._debugOwner;
  if (debug !== null && debug !== undefined) {
    let owner: any = debug; // eslint-disable-line @typescript-eslint/no-explicit-any
    while (owner && names.length < MAX_OWNERS) {
      const name = typeof owner.tag === 'number' ? componentName(owner as Fiber) : typeof owner.name === 'string' ? owner.name : undefined;
      if (name) names.push(name);
      owner = owner._debugOwner ?? owner.owner;
    }
    if (names.length > 0) return names;
  }
  for (let current = fiber.return; current !== null && names.length < MAX_OWNERS; current = current.return) {
    if (isComponentFiber(current)) {
      const name = componentName(current);
      if (name) names.push(name);
    }
    if (current.tag === HostRoot) break;
  }
  return names;
}

function stackText(fiber: { _debugStack?: unknown }): string | undefined {
  const stack = fiber._debugStack;
  if (stack === null || stack === undefined) return undefined;
  const text = typeof stack === 'string' ? stack : typeof (stack as { stack?: unknown }).stack === 'string' ? (stack as { stack: string }).stack : undefined;
  return text ? text.split('\n').slice(0, 12).join('\n') : undefined;
}

/**
 * Stacks React captured when this element and its owners were created
 * (React 19 dev), innermost first.
 */
export function creationStacks(fiber: Fiber, limit = 4): string[] {
  const stacks: string[] = [];
  let current: any = fiber; // eslint-disable-line @typescript-eslint/no-explicit-any
  while (current && stacks.length < limit) {
    const text = stackText(current);
    if (text) stacks.push(text);
    const owner = current._debugOwner;
    current = owner && typeof owner.tag === 'number' ? owner : undefined;
  }
  return stacks;
}

/** `_debugSource` of the element and its owners (React 18 dev), innermost first. */
export function debugSources(fiber: Fiber, limit = 4): { fileName: string; lineNumber: number; columnNumber?: number }[] {
  const out: { fileName: string; lineNumber: number; columnNumber?: number }[] = [];
  let current: any = fiber; // eslint-disable-line @typescript-eslint/no-explicit-any
  while (current && out.length < limit) {
    const source = debugSource(current);
    if (source) out.push(source);
    const owner = current._debugOwner;
    current = owner && typeof owner.tag === 'number' ? owner : undefined;
  }
  return out;
}

export function debugSource(fiber: Fiber): { fileName: string; lineNumber: number; columnNumber?: number } | undefined {
  const source = (fiber as unknown as { _debugSource?: { fileName?: unknown; lineNumber?: unknown; columnNumber?: unknown } })._debugSource;
  if (!source || typeof source.fileName !== 'string' || typeof source.lineNumber !== 'number') return undefined;
  const out: { fileName: string; lineNumber: number; columnNumber?: number } = { fileName: source.fileName, lineNumber: source.lineNumber };
  if (typeof source.columnNumber === 'number') out.columnNumber = source.columnNumber;
  return out;
}

/**
 * The start comments of Suspense / Activity boundaries that are still
 * dehydrated in the committed tree. Comment nodes are stable identities even
 * though fibers alternate between commits.
 */
export function dehydratedBoundaries(root: FiberRoot): Set<Node> {
  const pending = new Set<Node>();
  const start = root.current?.child ?? null;
  let fiber: Fiber | null = start;
  while (fiber !== null) {
    let descend = true;
    if (fiber.tag === SuspenseComponent || fiber.tag === ActivityComponent) {
      const dehydrated = fiber.memoizedState?.dehydrated;
      if (dehydrated !== null && dehydrated !== undefined) {
        pending.add(dehydrated as Node);
        descend = false;
      }
    } else if (fiber.tag === DehydratedFragment) {
      descend = false;
    }
    if (descend && fiber.child !== null) {
      fiber = fiber.child;
      continue;
    }
    while (fiber !== null && fiber.sibling === null) {
      fiber = fiber.return;
      if (fiber === null || fiber === root.current) {
        fiber = null;
        break;
      }
    }
    if (fiber !== null) fiber = fiber.sibling;
  }
  return pending;
}

const END_MARKERS = new Set(['/$', '/&']);

/**
 * A dehydrated boundary blocks "hydration done" unless it is empty (nothing
 * to mismatch) or inside a hidden subtree (React hydrates those at idle
 * priority, possibly much later).
 */
export function isBlockingBoundary(start: Node): boolean {
  let next = start.nextSibling;
  while (next && next.nodeType === Node.TEXT_NODE && (next as Text).data.trim() === '') next = next.nextSibling;
  if (next && next.nodeType === Node.COMMENT_NODE && END_MARKERS.has((next as Comment).data)) return false;
  for (let parent = start.parentElement; parent; parent = parent.parentElement) {
    if (parent.hasAttribute('hidden')) return false;
  }
  return true;
}

/** The root was still dehydrated before this commit. */
export function wasRootDehydrated(root: FiberRoot): boolean {
  return root.current?.alternate?.memoizedState?.isDehydrated === true;
}

export function isRootDehydrated(root: FiberRoot): boolean {
  return root.current?.memoizedState?.isDehydrated === true;
}
