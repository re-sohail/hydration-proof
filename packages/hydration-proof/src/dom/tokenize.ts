// A small, non-repairing HTML tokenizer. It builds the element tree exactly
// as the markup is written (what React meant to render), which is compared
// with the browser's repaired tree to find invalid nesting.
//
// Only what nesting analysis needs: tags, attributes, positions. Text,
// entities and error recovery are deliberately not modelled.

export interface RawElement {
  tag: string;
  attrs: [string, string][];
  children: RawElement[];
  parent: RawElement | null;
  /** Offset of `<` in the source. */
  start: number;
  line: number;
  column: number;
  foreign: boolean;
}

const VOID = new Set(
  'area base basefont bgsound br col embed frame hr img input keygen link meta param source track wbr'.split(' '),
);
const RAW_TEXT = new Set('script style textarea title xmp iframe noembed noframes noscript'.split(' '));

const NAME = /[^\s/>]/;

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) if (source.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function position(starts: number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= offset) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: offset - starts[low]! + 1 };
}

function parseAttributes(source: string, from: number): { attrs: [string, string][]; end: number; selfClosing: boolean } {
  const attrs: [string, string][] = [];
  let i = from;
  const length = source.length;
  while (i < length) {
    while (i < length && /\s/.test(source[i]!)) i++;
    const ch = source[i];
    if (ch === undefined) break;
    if (ch === '>') return { attrs, end: i + 1, selfClosing: false };
    if (ch === '/' && source[i + 1] === '>') return { attrs, end: i + 2, selfClosing: true };
    if (ch === '/') {
      i++;
      continue;
    }
    let nameEnd = i;
    while (nameEnd < length && !/[\s=/>]/.test(source[nameEnd]!)) nameEnd++;
    if (nameEnd === i) nameEnd = i + 1;
    const name = source.slice(i, nameEnd).toLowerCase();
    i = nameEnd;
    while (i < length && /\s/.test(source[i]!)) i++;
    let value = '';
    if (source[i] === '=') {
      i++;
      while (i < length && /\s/.test(source[i]!)) i++;
      const quote = source[i];
      if (quote === '"' || quote === "'") {
        const close = source.indexOf(quote, i + 1);
        const end = close === -1 ? length : close;
        value = source.slice(i + 1, end);
        i = end + 1;
      } else {
        let end = i;
        while (end < length && !/[\s>]/.test(source[end]!)) end++;
        value = source.slice(i, end);
        i = end;
      }
    }
    attrs.push([name, value]);
  }
  return { attrs, end: length, selfClosing: false };
}

export function tokenizeHtml(source: string): RawElement {
  const starts = lineStarts(source);
  const root: RawElement = { tag: '#document', attrs: [], children: [], parent: null, start: 0, line: 1, column: 1, foreign: false };
  const stack: RawElement[] = [root];
  let i = 0;
  const length = source.length;

  while (i < length) {
    const lt = source.indexOf('<', i);
    if (lt === -1) break;
    i = lt;
    if (source.startsWith('<!--', i)) {
      const close = source.indexOf('-->', i + 4);
      i = close === -1 ? length : close + 3;
      continue;
    }
    if (source[i + 1] === '!' || source[i + 1] === '?') {
      const close = source.indexOf('>', i);
      i = close === -1 ? length : close + 1;
      continue;
    }
    if (source[i + 1] === '/') {
      let nameEnd = i + 2;
      while (nameEnd < length && NAME.test(source[nameEnd]!)) nameEnd++;
      const tag = source.slice(i + 2, nameEnd).toLowerCase();
      const close = source.indexOf('>', nameEnd);
      i = close === -1 ? length : close + 1;
      for (let depth = stack.length - 1; depth > 0; depth--) {
        if (stack[depth]!.tag.toLowerCase() === tag) {
          stack.length = depth;
          break;
        }
      }
      continue;
    }
    if (!/[a-zA-Z]/.test(source[i + 1] ?? '')) {
      i++;
      continue;
    }
    let nameEnd = i + 1;
    while (nameEnd < length && NAME.test(source[nameEnd]!)) nameEnd++;
    const rawName = source.slice(i + 1, nameEnd);
    const parent = stack[stack.length - 1]!;
    const foreign = parent.foreign || rawName.toLowerCase() === 'svg' || rawName.toLowerCase() === 'math';
    const inForeignText = parent.foreign && (parent.tag === 'foreignObject' || parent.tag === 'desc' || parent.tag === 'title');
    const tag = foreign && !inForeignText ? rawName : rawName.toLowerCase();
    const { attrs, end, selfClosing } = parseAttributes(source, nameEnd);
    const { line, column } = position(starts, i);
    const element: RawElement = { tag, attrs, children: [], parent, start: i, line, column, foreign: foreign && !inForeignText };
    parent.children.push(element);
    i = end;

    const lower = tag.toLowerCase();
    if (element.foreign ? selfClosing : VOID.has(lower)) continue;
    if (!element.foreign && RAW_TEXT.has(lower)) {
      const closePattern = new RegExp(`</${lower}[\\s/>]`, 'ig');
      closePattern.lastIndex = i;
      const match = closePattern.exec(source);
      if (match === null) {
        i = length;
      } else {
        const close = source.indexOf('>', match.index);
        i = close === -1 ? length : close + 1;
      }
      continue;
    }
    if (!element.foreign && lower === 'plaintext') break;
    stack.push(element);
  }
  return root;
}

export function rawAttr(element: RawElement, name: string): string | null {
  for (const [key, value] of element.attrs) if (key === name) return value;
  return null;
}

export function* rawElements(root: RawElement): Generator<RawElement> {
  for (const child of root.children) {
    yield child;
    yield* rawElements(child);
  }
}
