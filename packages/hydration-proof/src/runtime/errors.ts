import type { CapturedError, ErrorSource } from '../shared/protocol.ts';
import { defineProperty, getOwnPropertyDescriptor, NativeError, NativeWeakMap, NativeWeakSet } from './env.ts';
import type { FiberRoot } from './fiber.ts';

export type ErrorReport = Omit<CapturedError, 'seq' | 'time'>;

export interface ErrorSink {
  push(report: ErrorReport): void;
}

const MAX_TEXT = 4000;
const MAX_CAUSE_DEPTH = 3;

const errorIds: WeakMap<object, number> = new NativeWeakMap();
let nextErrorId = 1;

function errorIdOf(value: unknown): number | undefined {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
  let id = errorIds.get(value);
  if (id === undefined) {
    id = nextErrorId++;
    errorIds.set(value, id);
  }
  return id;
}

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

function isErrorLike(value: unknown): value is Error & { digest?: unknown; cause?: unknown } {
  return (
    value instanceof NativeError ||
    (value !== null && typeof value === 'object' && 'message' in value && 'stack' in value)
  );
}

export function stringify(value: unknown): string {
  switch (typeof value) {
    case 'string':
      return value;
    case 'number':
    case 'boolean':
    case 'bigint':
    case 'undefined':
      return String(value);
    case 'symbol':
      return value.toString();
    case 'function':
      return `[Function ${value.name || 'anonymous'}]`;
  }
  if (value === null) return 'null';
  if (isErrorLike(value)) return `${value.name}: ${value.message}`;
  if (typeof Node !== 'undefined' && value instanceof Node) {
    return value.nodeType === Node.ELEMENT_NODE ? `<${(value as Element).localName}>` : value.nodeName;
  }
  try {
    return clip(JSON.stringify(value) ?? String(value));
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/** Browser-style printf formatting for console arguments. */
export function formatConsole(args: readonly unknown[]): string {
  if (args.length === 0) return '';
  let index = 0;
  let out: string;
  const first = args[0];
  if (typeof first === 'string') {
    index = 1;
    out = first.replace(/%([sdifoOc%])/g, (match, code: string) => {
      if (code === '%') return '%';
      if (index >= args.length) return match;
      const arg = args[index++];
      switch (code) {
        case 'd':
        case 'i':
          return typeof arg === 'symbol' ? 'NaN' : String(Math.trunc(Number(arg)));
        case 'f':
          return typeof arg === 'symbol' ? 'NaN' : String(Number(arg));
        case 'c':
          return '';
        default:
          return stringify(arg);
      }
    });
  } else {
    out = stringify(first);
    index = 1;
  }
  for (; index < args.length; index++) out += ` ${stringify(args[index])}`;
  return clip(out);
}

export function describeValue(value: unknown, depth = 0): Omit<ErrorReport, 'source'> {
  if (!isErrorLike(value)) return { message: stringify(value) };
  const out: Omit<ErrorReport, 'source'> = { name: String(value.name), message: clip(String(value.message)) };
  if (typeof value.stack === 'string') out.stack = clip(value.stack);
  if (typeof value.digest === 'string') out.digest = value.digest;
  if (value.cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    out.cause = describeValue(value.cause, depth + 1);
  }
  const id = errorIdOf(value);
  if (id !== undefined) out.errorId = id;
  return out;
}

function callSite(): string | undefined {
  const stack = new NativeError().stack;
  if (!stack) return undefined;
  const frames = stack
    .split('\n')
    .slice(1)
    .filter((line) => !line.includes('<anonymous>') && !line.includes('__playwright'))
    .slice(0, 8);
  return frames.length > 0 ? frames.join('\n') : undefined;
}

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // Never break the page under test.
  }
}

function fromConsole(source: ErrorSource, args: readonly unknown[]): ErrorReport {
  const report: ErrorReport = { source, message: formatConsole(args), args: args.map(stringify) };
  const error = args.find(isErrorLike);
  if (error !== undefined) {
    const described = describeValue(error);
    if (described.stack !== undefined) report.stack = described.stack;
    if (described.errorId !== undefined) report.errorId = described.errorId;
    if (described.cause !== undefined) report.cause = described.cause;
    if (described.digest !== undefined) report.digest = described.digest;
    if (described.name !== undefined) report.name = described.name;
  }
  const site = callSite();
  if (site !== undefined) report.callSite = site;
  return report;
}

export function installErrorCapture(sink: ErrorSink, captureWarnings: boolean): void {
  const methods: [keyof Console, ErrorSource][] = [['error', 'console-error']];
  if (captureWarnings) methods.push(['warn', 'console-warn']);
  for (const [method, source] of methods) {
    const original = console[method] as (...args: unknown[]) => void;
    const wrapped = function (this: unknown, ...args: unknown[]): void {
      safe(() => sink.push(fromConsole(source, args)));
      original.apply(this, args);
    };
    safe(() => defineProperty(console, method, { value: wrapped, writable: true, configurable: true }));
  }

  window.addEventListener(
    'error',
    (event) => {
      // Resource load errors bubble here too; only script errors matter.
      if (!(event instanceof ErrorEvent)) return;
      safe(() => {
        const value = event.error ?? event.message;
        sink.push({ source: 'window-error', ...describeValue(value) });
      });
    },
    true,
  );

  window.addEventListener(
    'unhandledrejection',
    (event) => {
      safe(() => sink.push({ source: 'unhandled-rejection', ...describeValue(event.reason) }));
    },
    true,
  );

  const report = window.reportError;
  if (typeof report === 'function') {
    const wrapped = function (this: unknown, error: unknown): void {
      safe(() => sink.push({ source: 'report-error', ...describeValue(error) }));
      report.call(this, error);
    };
    safe(() => defineProperty(window, 'reportError', { value: wrapped, writable: true, configurable: true }));
  }
}

const ROOT_CALLBACKS: [keyof FiberRoot, ErrorSource][] = [
  ['onRecoverableError', 'recoverable'],
  ['onCaughtError', 'caught'],
  ['onUncaughtError', 'uncaught'],
];

const wrappedCallbacks: WeakSet<object> = new NativeWeakSet();

/**
 * Read a property only if it is a plain value. React 19 development builds
 * define `errorInfo.digest` as a getter that logs a deprecation warning.
 */
function dataProperty(target: object | undefined, key: string): unknown {
  if (target === undefined || target === null) return undefined;
  const descriptor = getOwnPropertyDescriptor(target, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

/**
 * Wrap the error callbacks React stored on a root. Called from the DevTools
 * commit hook, which React invokes before it reads these callbacks.
 */
export function wrapRootCallbacks(root: FiberRoot, sink: ErrorSink, rootId: number): void {
  const record = root as unknown as Record<string, unknown>;
  for (const [key, source] of ROOT_CALLBACKS) {
    const original = record[key];
    if (typeof original !== 'function' || wrappedCallbacks.has(original)) continue;
    const wrapped = function (this: unknown, error: unknown, info?: object) {
      safe(() => {
        const report: ErrorReport = { source, rootId, ...describeValue(error) };
        const componentStack = dataProperty(info, 'componentStack');
        if (typeof componentStack === 'string') report.componentStack = clip(componentStack);
        const digest = dataProperty(info, 'digest');
        if (typeof digest === 'string' && report.digest === undefined) report.digest = digest;
        sink.push(report);
      });
      return (original as (...args: unknown[]) => unknown).call(this, error, info);
    };
    wrappedCallbacks.add(wrapped);
    record[key] = wrapped;
  }
}
