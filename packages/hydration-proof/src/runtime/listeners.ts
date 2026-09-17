import { NativeMap, NativeSet, NativeWeakMap } from './env.ts';

// Event listeners that page scripts add directly to elements. React handles
// these events at the root, so a listener on the element itself plus a React
// handler means the event is handled twice.

/** DOM event → React props that handle it. */
export const TRACKED_EVENTS: ReadonlyMap<string, readonly string[]> = new NativeMap([
  ['click', ['onClick']],
  ['submit', ['onSubmit']],
  ['input', ['onInput', 'onChange']],
  ['change', ['onChange']],
  ['keydown', ['onKeyDown']],
  ['keyup', ['onKeyUp']],
]);

const listeners = new NativeWeakMap<EventTarget, Map<string, Set<unknown>>>();

export function installListenerTracking(): void {
  const proto = EventTarget.prototype;
  const add = proto.addEventListener;
  const remove = proto.removeEventListener;
  proto.addEventListener = function addEventListener(this: EventTarget, type: string, listener: unknown, options?: unknown) {
    if (listener && TRACKED_EVENTS.has(type) && (this as Node).nodeType === 1) {
      let byType = listeners.get(this);
      if (!byType) {
        byType = new NativeMap();
        listeners.set(this, byType);
      }
      let set = byType.get(type);
      if (!set) {
        set = new NativeSet();
        byType.set(type, set);
      }
      set.add(listener);
    }
    return add.call(this, type, listener as EventListenerOrEventListenerObject, options as AddEventListenerOptions);
  } as typeof proto.addEventListener;
  proto.removeEventListener = function removeEventListener(this: EventTarget, type: string, listener: unknown, options?: unknown) {
    listeners.get(this)?.get(type)?.delete(listener);
    return remove.call(this, type, listener as EventListenerOrEventListenerObject, options as EventListenerOptions);
  } as typeof proto.removeEventListener;
}

/** Events the element handles outside React: script listeners and inline `on*` attributes. */
export function nativeHandlers(el: Element): string[] {
  const out: string[] = [];
  const byType = listeners.get(el);
  for (const type of TRACKED_EVENTS.keys()) {
    if ((byType?.get(type)?.size ?? 0) > 0 || el.hasAttribute(`on${type}`)) out.push(type);
  }
  return out;
}
