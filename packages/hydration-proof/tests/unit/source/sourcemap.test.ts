import { describe, expect, it } from 'vitest';
import { decodeMappings, SourceMap } from '../../../src/source/sourcemap.ts';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function vlq(value: number): string {
  let v = value < 0 ? (-value << 1) | 1 : value << 1;
  let out = '';
  do {
    let digit = v & 31;
    v >>>= 5;
    if (v > 0) digit |= 32;
    out += BASE64[digit];
  } while (v > 0);
  return out;
}

/** Encode absolute segments [genCol, source, line, col, name?] per generated line. */
function encode(lines: number[][][]): string {
  let source = 0;
  let line = 0;
  let column = 0;
  let name = 0;
  return lines
    .map((segments) => {
      let generated = 0;
      return segments
        .map((segment) => {
          const parts = [segment[0]! - generated];
          generated = segment[0]!;
          if (segment.length >= 4) {
            parts.push(segment[1]! - source, segment[2]! - line, segment[3]! - column);
            source = segment[1]!;
            line = segment[2]!;
            column = segment[3]!;
          }
          if (segment.length === 5) {
            parts.push(segment[4]! - name);
            name = segment[4]!;
          }
          return parts.map(vlq).join('');
        })
        .join(',');
    })
    .join(';');
}

describe('decodeMappings', () => {
  it('decodes relative VLQ fields across lines', () => {
    const mappings = encode([[[0, 0, 0, 0], [10, 0, 0, 7, 0]], [], [[4, 1, 41, 2]]]);
    expect(decodeMappings(mappings)).toEqual([
      [[0, 0, 0, 0, -1], [10, 0, 0, 7, 0]],
      [],
      [[4, 1, 41, 2, -1]],
    ]);
  });

  it('handles negative deltas and large values', () => {
    const mappings = encode([[[500, 0, 1000, 80]], [[3, 0, 999, 2]]]);
    expect(decodeMappings(mappings)[1]).toEqual([[3, 0, 999, 2, -1]]);
  });
});

describe('SourceMap', () => {
  const map = new SourceMap({
    version: 3,
    sources: ['app/page.tsx', 'node_modules/react/index.js'],
    sourcesContent: ['export default function Page() {}\n', null],
    names: ['Page'],
    sourceRoot: 'webpack://_N_E/',
    mappings: encode([[[0, 0, 0, 0], [16, 0, 0, 24, 0], [40, 1, 5, 0]]]),
    ignoreList: [1],
  });

  it('finds the closest mapping to the left', () => {
    expect(map.originalPositionFor(1, 20)).toEqual({
      source: 'webpack://_N_E/app/page.tsx',
      line: 1,
      column: 24,
      name: 'Page',
      content: 'export default function Page() {}\n',
      ignored: false,
    });
    expect(map.originalPositionFor(1, 45)).toMatchObject({ source: 'webpack://_N_E/node_modules/react/index.js', line: 6, ignored: true });
    expect(map.originalPositionFor(9, 0)).toBeUndefined();
  });

  it('supports index maps with sections', () => {
    const indexed = new SourceMap({
      version: 3,
      sections: [
        { offset: { line: 0, column: 0 }, map: { version: 3, sources: ['a.ts'], mappings: encode([[[0, 0, 0, 0]]]) } },
        { offset: { line: 10, column: 5 }, map: { version: 3, sources: ['b.ts'], mappings: encode([[[0, 0, 3, 1]], [[2, 0, 7, 0]]]) } },
      ],
    });
    expect(indexed.originalPositionFor(1, 3)?.source).toBe('a.ts');
    expect(indexed.originalPositionFor(11, 6)).toMatchObject({ source: 'b.ts', line: 4, column: 1 });
    expect(indexed.originalPositionFor(12, 2)).toMatchObject({ source: 'b.ts', line: 8 });
  });

  it('finds the first mapping inside a generated range, never one before it', () => {
    const ranged = new SourceMap({
      version: 3,
      sources: ['prev.ts', 'Stats.tsx'],
      mappings: encode([[[0, 0, 0, 0], [30, 1, 3, 0], [44, 1, 4, 2]], [], [[4, 1, 9, 0]]]),
    });
    // The function starts at column 20: the segment at 0 belongs to the previous module.
    expect(ranged.firstPositionIn(1, 20, 1, 60)).toMatchObject({ source: 'Stats.tsx', line: 4 });
    expect(ranged.originalPositionFor(1, 20)?.source).toBe('prev.ts');
    expect(ranged.firstPositionIn(1, 45, 3, 10)).toMatchObject({ source: 'Stats.tsx', line: 10 });
    expect(ranged.firstPositionIn(1, 45, 3, 2)).toBeUndefined();

    const indexed = new SourceMap({
      version: 3,
      sections: [
        { offset: { line: 0, column: 0 }, map: { version: 3, sources: ['a.ts'], mappings: encode([[[0, 0, 0, 0]]]) } },
        { offset: { line: 0, column: 50 }, map: { version: 3, sources: ['b.ts'], mappings: encode([[[5, 0, 2, 0]]]) } },
      ],
    });
    expect(indexed.firstPositionIn(1, 52, 1, 80)).toMatchObject({ source: 'b.ts', line: 3 });
    expect(indexed.firstPositionIn(1, 10, 1, 40)).toBeUndefined();
  });

  it('rejects other versions', () => {
    expect(() => new SourceMap({ version: 2 })).toThrow(/version/);
  });
});
