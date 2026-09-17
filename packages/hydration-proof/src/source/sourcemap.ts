// Source Map v3 decoding, in-house: VLQ mappings, index maps (`sections`,
// used by Turbopack), `sourcesContent`, `ignoreList`.

export interface RawSourceMap {
  version: number;
  sources?: (string | null)[];
  sourcesContent?: (string | null)[];
  names?: string[];
  mappings?: string;
  sourceRoot?: string;
  file?: string;
  sections?: { offset: { line: number; column: number }; map?: RawSourceMap; url?: string }[];
  ignoreList?: number[];
  x_google_ignoreList?: number[];
}

export interface OriginalPosition {
  source: string;
  /** 1-based. */
  line: number;
  /** 0-based. */
  column: number;
  name?: string;
  content?: string;
  /** The source is marked as third-party / framework code. */
  ignored: boolean;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_VALUE = new Int8Array(128).fill(-1);
for (let i = 0; i < BASE64.length; i++) BASE64_VALUE[BASE64.charCodeAt(i)] = i;

// [generatedColumn, sourceIndex, originalLine, originalColumn, nameIndex]
type Segment = [number, number, number, number, number];

/** Decode a `mappings` string into per-line segment arrays (sorted by column). */
export function decodeMappings(mappings: string): Segment[][] {
  const lines: Segment[][] = [];
  let line: Segment[] = [];
  let source = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let name = 0;
  let column = 0;
  let index = 0;
  const length = mappings.length;
  const fields = [0, 0, 0, 0, 0];

  while (index <= length) {
    const char = index < length ? mappings.charCodeAt(index) : 59; // treat end as ';'
    if (char === 59 /* ; */) {
      line.sort((a, b) => a[0] - b[0]);
      lines.push(line);
      line = [];
      column = 0;
      index++;
      continue;
    }
    if (char === 44 /* , */) {
      index++;
      continue;
    }
    let count = 0;
    while (index < length) {
      const code = mappings.charCodeAt(index);
      if (code === 44 || code === 59) break;
      let value = 0;
      let shift = 0;
      let digit: number;
      do {
        digit = BASE64_VALUE[mappings.charCodeAt(index++)] ?? -1;
        if (digit < 0) throw new Error('Invalid base64 in source map mappings');
        value += (digit & 31) << shift;
        shift += 5;
      } while (digit & 32);
      fields[count++] = value & 1 ? -(value >>> 1) : value >>> 1;
    }
    column += fields[0]!;
    if (count >= 4) {
      source += fields[1]!;
      originalLine += fields[2]!;
      originalColumn += fields[3]!;
      if (count >= 5) name += fields[4]!;
      line.push([column, source, originalLine, originalColumn, count >= 5 ? name : -1]);
    }
  }
  return lines;
}

function joinRoot(root: string | undefined, source: string): string {
  if (!root || /^[a-z][a-z0-9+.-]*:/i.test(source) || source.startsWith('/')) return source;
  return `${root.replace(/\/$/, '')}/${source}`;
}

export class SourceMap {
  private readonly raw: RawSourceMap;
  private lines: Segment[][] | undefined;
  private readonly sections: { line: number; column: number; map: SourceMap }[] | undefined;
  private readonly ignored: Set<number>;

  constructor(raw: RawSourceMap | string) {
    this.raw = typeof raw === 'string' ? (JSON.parse(raw) as RawSourceMap) : raw;
    if (this.raw.version !== 3) throw new Error(`Unsupported source map version ${String(this.raw.version)}`);
    this.ignored = new Set(this.raw.ignoreList ?? this.raw.x_google_ignoreList ?? []);
    if (this.raw.sections) {
      this.sections = this.raw.sections
        .filter((section) => section.map !== undefined)
        .map((section) => ({ line: section.offset.line, column: section.offset.column, map: new SourceMap(section.map!) }))
        .sort((a, b) => a.line - b.line || a.column - b.column);
    }
  }

  /** `line` is 1-based, `column` 0-based (as in V8 stack traces minus one). */
  originalPositionFor(line: number, column: number): OriginalPosition | undefined {
    if (this.sections) {
      const zeroLine = line - 1;
      let chosen: { line: number; column: number; map: SourceMap } | undefined;
      for (const section of this.sections) {
        if (section.line < zeroLine || (section.line === zeroLine && section.column <= column)) chosen = section;
        else break;
      }
      if (!chosen) return undefined;
      const innerLine = zeroLine - chosen.line;
      const innerColumn = innerLine === 0 ? column - chosen.column : column;
      return chosen.map.originalPositionFor(innerLine + 1, innerColumn);
    }

    this.lines ??= decodeMappings(this.raw.mappings ?? '');
    const segments = this.lines[line - 1];
    if (!segments || segments.length === 0) return undefined;
    let low = 0;
    let high = segments.length - 1;
    let found = -1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (segments[mid]![0] <= column) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (found < 0) found = 0;
    const [, sourceIndex, originalLine, originalColumn, nameIndex] = segments[found]!;
    const source = this.raw.sources?.[sourceIndex];
    if (source === null || source === undefined) return undefined;
    const position: OriginalPosition = {
      source: joinRoot(this.raw.sourceRoot, source),
      line: originalLine + 1,
      column: originalColumn,
      ignored: this.ignored.has(sourceIndex),
    };
    const content = this.raw.sourcesContent?.[sourceIndex];
    if (typeof content === 'string') position.content = content;
    if (nameIndex >= 0 && this.raw.names?.[nameIndex] !== undefined) position.name = this.raw.names[nameIndex]!;
    return position;
  }
}
