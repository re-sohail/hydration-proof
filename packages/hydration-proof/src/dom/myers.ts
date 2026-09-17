// Myers' O(ND) difference algorithm over two key sequences.
// Returns an edit script as index pairs; unmatched indices are insertions or
// deletions. Falls back to a greedy prefix/suffix match for huge inputs.

export type Edit =
  | { op: 'equal'; a: number; b: number }
  | { op: 'delete'; a: number }
  | { op: 'insert'; b: number };

const MAX_COST = 2_000_000;

export function myers<A, B = A>(
  a: readonly A[],
  b: readonly B[],
  equals: (x: A, y: B) => boolean = Object.is as (x: A, y: B) => boolean,
): Edit[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) return [];
  if (n * m > MAX_COST) return greedy(a, b, equals);

  const offset = max;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) x = v[offset + k + 1]!;
      else x = v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && equals(a[x]!, b[y]!)) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }

  // Backtrack.
  const edits: Edit[] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vd = trace[d]!;
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && vd[offset + k - 1]! < vd[offset + k + 1]!)) prevK = k + 1;
    else prevK = k - 1;
    const prevX = vd[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      edits.push({ op: 'equal', a: x, b: y });
    }
    if (d > 0) {
      if (x === prevX) edits.push({ op: 'insert', b: prevY });
      else edits.push({ op: 'delete', a: prevX });
    }
    x = prevX;
    y = prevY;
  }
  return edits.reverse();
}

function greedy<A, B>(a: readonly A[], b: readonly B[], equals: (x: A, y: B) => boolean): Edit[] {
  const edits: Edit[] = [];
  let start = 0;
  while (start < a.length && start < b.length && equals(a[start]!, b[start]!)) {
    edits.push({ op: 'equal', a: start, b: start });
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  const tail: Edit[] = [];
  while (endA > start && endB > start && equals(a[endA - 1]!, b[endB - 1]!)) {
    endA--;
    endB--;
    tail.unshift({ op: 'equal', a: endA, b: endB });
  }
  for (let i = start; i < endA; i++) edits.push({ op: 'delete', a: i });
  for (let j = start; j < endB; j++) edits.push({ op: 'insert', b: j });
  return edits.concat(tail);
}
