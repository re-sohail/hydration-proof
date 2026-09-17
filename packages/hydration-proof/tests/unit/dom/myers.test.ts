import { describe, expect, it } from 'vitest';
import { myers, type Edit } from '../../../src/dom/myers.ts';

function apply(a: string[], b: string[], edits: Edit[]): string[] {
  const out: string[] = [];
  for (const edit of edits) {
    if (edit.op === 'equal') out.push(a[edit.a]!);
    if (edit.op === 'insert') out.push(b[edit.b]!);
  }
  return out;
}

describe('myers', () => {
  it('finds the shortest edit script', () => {
    const a = [...'ABCABBA'];
    const b = [...'CBABAC'];
    const edits = myers(a, b);
    expect(apply(a, b, edits)).toEqual(b);
    expect(edits.filter((edit) => edit.op !== 'equal')).toHaveLength(5);
  });

  it('handles empty inputs', () => {
    expect(myers([], [])).toEqual([]);
    expect(myers(['x'], [])).toEqual([{ op: 'delete', a: 0 }]);
    expect(myers([], ['y'])).toEqual([{ op: 'insert', b: 0 }]);
  });

  it('keeps edits in order for random sequences', () => {
    for (let round = 0; round < 200; round++) {
      const a = Array.from({ length: Math.floor(Math.random() * 12) }, () => 'abc'[Math.floor(Math.random() * 3)]!);
      const b = Array.from({ length: Math.floor(Math.random() * 12) }, () => 'abc'[Math.floor(Math.random() * 3)]!);
      const edits = myers(a, b);
      expect(apply(a, b, edits)).toEqual(b);
      const deleted = edits.filter((edit) => edit.op !== 'insert').map((edit) => (edit as { a: number }).a);
      expect(deleted).toEqual(a.map((_, i) => i));
    }
  });
});
