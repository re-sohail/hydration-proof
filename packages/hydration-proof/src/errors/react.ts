// Recognise React's hydration errors and warnings, in development and
// production builds of React 18 and 19.

export type ReactMessageKind =
  | 'hydration-failed'
  | 'text-mismatch'
  | 'server-render-failed'
  | 'boundary-client-render'
  | 'root-client-render'
  | 'early-update'
  | 'attribute-warning'
  | 'text-warning'
  | 'structure-warning'
  | 'nesting-warning'
  | 'duplicate-stylesheet';

export interface ReactDiffLine {
  sign: '+' | '-' | ' ';
  depth: number;
  text: string;
}

export interface ReactMessage {
  kind: ReactMessageKind;
  /** Production error code, when minified. */
  code?: number;
  args?: string[];
  production: boolean;
  /** React 19 dev: the `+ client / - server` diff. */
  diff?: ReactDiffLine[];
  /** React 18 dev: values quoted in the message. */
  server?: string;
  client?: string;
  prop?: string;
  /** Nesting warnings: the tags involved. */
  childTag?: string;
  parentTag?: string;
}

const CODE_KINDS: ReadonlyMap<number, ReactMessageKind> = new Map([
  [418, 'hydration-failed'],
  [419, 'server-render-failed'],
  [421, 'early-update'],
  [422, 'boundary-client-render'],
  [423, 'root-client-render'],
  [424, 'early-update'],
  [425, 'text-mismatch'],
  [436, 'duplicate-stylesheet'],
]);

const MINIFIED = /Minified React error #(\d+)[;:]?\s*(?:visit\s+(\S+))?/;

function decodeArgs(url: string | undefined): string[] {
  if (!url) return [];
  const query = url.split('?')[1] ?? '';
  const args: string[] = [];
  for (const part of query.split('&')) {
    const [key, value = ''] = part.split('=');
    if (key !== undefined && decodeURIComponent(key) === 'args[]') {
      try {
        args.push(decodeURIComponent(value.replace(/\+/g, ' ')));
      } catch {
        args.push(value);
      }
    }
  }
  return args;
}

/** React 19 appends a tree diff with `+` (client) and `-` (server) lines. */
export function parseReactDiff(message: string): ReactDiffLine[] | undefined {
  const marker = message.indexOf('https://react.dev/link/hydration-mismatch');
  if (marker === -1) return undefined;
  const lines = message.slice(marker).split('\n').slice(1);
  const out: ReactDiffLine[] = [];
  for (const raw of lines) {
    if (raw.trim() === '') continue;
    const match = /^([+-]?)(\s*)(.*)$/.exec(raw);
    if (!match) continue;
    const sign = (match[1] || ' ') as ReactDiffLine['sign'];
    const indent = match[2]!.length + (sign === ' ' ? 0 : 1);
    if (match[3] === '...') continue;
    out.push({ sign, depth: Math.floor(indent / 2), text: match[3]!.trim() });
  }
  return out.length > 0 ? out : undefined;
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

export function classifyReactMessage(message: string): ReactMessage | undefined {
  const minified = MINIFIED.exec(message);
  if (minified) {
    const code = Number(minified[1]);
    const kind = CODE_KINDS.get(code);
    if (!kind) return undefined;
    return { kind, code, args: decodeArgs(minified[2]), production: true };
  }

  const text = message.replace(/^Warning: /, '');

  if (/^Hydration failed because/.test(text)) {
    const result: ReactMessage = { kind: 'hydration-failed', production: false };
    const diff = parseReactDiff(text);
    if (diff) result.diff = diff;
    return result;
  }
  if (/^Text content does not match server-rendered HTML/.test(text)) {
    return { kind: 'text-mismatch', production: false };
  }
  if (/^There was an error while hydrating/.test(text)) {
    return {
      kind: /Suspense boundary/i.test(text) && !/outside of a Suspense boundary/i.test(text) && !/entire root/.test(text)
        ? 'boundary-client-render'
        : 'root-client-render',
      production: false,
    };
  }
  if (/^Switched to client rendering because the server rendering (?:errored|aborted)|^The server could not finish this Suspense boundary/.test(text)) {
    return { kind: 'server-render-failed', production: false };
  }
  if (/^This (?:Suspense boundary|root) received an (?:update|early update) before/.test(text)) {
    return { kind: 'early-update', production: false };
  }
  if (/^A tree hydrated but some attributes of the server rendered HTML didn't match/.test(text)) {
    const result: ReactMessage = { kind: 'attribute-warning', production: false };
    const diff = parseReactDiff(text);
    if (diff) result.diff = diff;
    return result;
  }

  const textMatch = /^Text content did not match\. Server: ("(?:[^"\\]|\\.)*") Client: ("(?:[^"\\]|\\.)*")/.exec(text);
  if (textMatch) {
    return { kind: 'text-warning', production: false, server: unquote(textMatch[1]!), client: unquote(textMatch[2]!) };
  }
  const propMatch = /^Prop `([^`]+)` did not match\. Server: (.*?) Client: (.*?)(?:\n|$)/.exec(text);
  if (propMatch) {
    return {
      kind: 'attribute-warning',
      production: false,
      prop: propMatch[1]!,
      server: unquote(propMatch[2]!),
      client: unquote(propMatch[3]!),
    };
  }
  if (/^(?:Expected server HTML to contain|Did not expect server HTML to contain|An error occurred during hydration\. The server HTML was replaced)/.test(text)) {
    return { kind: 'structure-warning', production: false };
  }
  if (/^Extra attributes from the server/.test(text)) {
    return { kind: 'attribute-warning', production: false };
  }

  const nesting19 = /^In HTML, (?:<(\w+)>|%s|text nodes|whitespace text nodes) cannot be a (?:child|descendant) of <(\w+)>/.exec(text);
  if (nesting19) {
    const result: ReactMessage = { kind: 'nesting-warning', production: false, parentTag: nesting19[2]! };
    if (nesting19[1]) result.childTag = nesting19[1];
    return result;
  }
  const nesting18 = /^validateDOMNesting\(\.\.\.\): <(\w+)> cannot appear as a (?:child|descendant) of <(\w+)>/.exec(text);
  if (nesting18) {
    return { kind: 'nesting-warning', production: false, childTag: nesting18[1]!, parentTag: nesting18[2]! };
  }
  if (/^validateDOMNesting|cannot contain a nested <\w+>|This will cause a hydration error/.test(text)) {
    return { kind: 'nesting-warning', production: false };
  }
  return undefined;
}

export interface StackFrame {
  name: string;
  url?: string;
  line?: number;
  column?: number;
}

/** Parse `    at Name (url:line:col)` style component stacks (V8, Firefox and WebKit forms). */
export function parseComponentStack(stack: string | undefined): StackFrame[] {
  if (!stack) return [];
  const frames: StackFrame[] = [];
  for (const raw of stack.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let match = /^at (\S+?)(?: \((.*)\))?$/.exec(line);
    let name: string | undefined;
    let location: string | undefined;
    if (match) {
      name = match[1];
      location = match[2];
    } else {
      match = /^(\S*?)@(.*)$/.exec(line);
      if (!match) continue;
      name = match[1] || '<anonymous>';
      location = match[2];
    }
    const frame: StackFrame = { name: name ?? '<anonymous>' };
    const position = location ? /^(.*?):(\d+):(\d+)$/.exec(location) : null;
    if (position) {
      frame.url = position[1]!;
      frame.line = Number(position[2]);
      frame.column = Number(position[3]);
    } else if (location && location !== '<anonymous>') {
      frame.url = location;
    }
    frames.push(frame);
  }
  return frames;
}

/**
 * Component frames of a component stack, innermost first. Host elements
 * (`at p`, `at p (<anonymous>)`) carry no source location; components do,
 * even when production minification shortened their names.
 */
export function componentFrames(stack: string | undefined): StackFrame[] {
  return parseComponentStack(stack).filter((frame) => frame.url !== undefined || /^[A-Z]/.test(frame.name));
}
