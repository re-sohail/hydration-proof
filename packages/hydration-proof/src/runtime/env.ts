// Built-ins captured before any page script runs. The page (or a library it
// loads) may patch these later; the runtime keeps using the originals.

const perf = performance;
const perfNow: () => number = perf.now.bind(perf);

export const now = (): number => Math.round(perfNow() * 10) / 10;

export const NativeMutationObserver: typeof MutationObserver = MutationObserver;
export const NativeWeakMap: WeakMapConstructor = WeakMap;
export const NativeWeakSet: WeakSetConstructor = WeakSet;
export const NativeMap: MapConstructor = Map;
export const NativeSet: SetConstructor = Set;
export const defineProperty: typeof Object.defineProperty = Object.defineProperty;
export const getOwnPropertyDescriptor: typeof Object.getOwnPropertyDescriptor =
  Object.getOwnPropertyDescriptor;
export const objectKeys: typeof Object.keys = Object.keys;
export const NativeError: ErrorConstructor = Error;
const functionToString: () => string = Function.prototype.toString;
/** Source text of a function, immune to a patched Function.prototype.toString. */
export const sourceTextOf = (fn: object): string => functionToString.call(fn);

const elementProto = Element.prototype;
export const nativeAttachShadow: typeof elementProto.attachShadow = elementProto.attachShadow;
export const nativeGetAttribute: typeof elementProto.getAttribute = elementProto.getAttribute;

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const MATH_NS = 'http://www.w3.org/1998/Math/MathML';
export const HTML_NS = 'http://www.w3.org/1999/xhtml';
