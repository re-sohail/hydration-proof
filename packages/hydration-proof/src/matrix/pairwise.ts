// Combination strategies for the environment matrix. Axes are given by their
// number of values; a combination is one value index per axis. Value 0 of
// every axis is the baseline and always comes first when it is valid.

/** A partial assignment: `undefined` means the axis has no value yet. */
export type Assignment = readonly (number | undefined)[];
export type Validity = (assignment: Assignment) => boolean;

const always: Validity = () => true;

function pairKey(i: number, a: number, j: number, b: number): string {
  return `${i}:${a}|${j}:${b}`;
}

function pairsOf(combo: readonly number[]): string[] {
  const keys: string[] = [];
  for (let i = 0; i < combo.length; i++) {
    for (let j = i + 1; j < combo.length; j++) keys.push(pairKey(i, combo[i]!, j, combo[j]!));
  }
  return keys;
}

function partial(size: number, entries: [number, number][]): (number | undefined)[] {
  const out: (number | undefined)[] = Array.from({ length: size }, () => undefined);
  for (const [axis, value] of entries) out[axis] = value;
  return out;
}

/** Every combination (cartesian product) that is valid, baseline first. */
export function fullCombinations(sizes: readonly number[], valid: Validity = always, limit = 100_000): number[][] {
  const out: number[][] = [];
  const combo: number[] = Array.from({ length: sizes.length }, () => 0);
  if (sizes.some((size) => size === 0)) return out;
  for (;;) {
    if (valid(combo)) out.push([...combo]);
    if (out.length >= limit) return out;
    let axis = sizes.length - 1;
    while (axis >= 0 && combo[axis] === sizes[axis]! - 1) {
      combo[axis] = 0;
      axis--;
    }
    if (axis < 0) return out;
    combo[axis]!++;
  }
}

/**
 * A small set of combinations in which every valid pair of values of two
 * axes appears at least once (greedy, deterministic).
 */
export function pairwiseCombinations(sizes: readonly number[], valid: Validity = always): number[][] {
  const n = sizes.length;
  if (sizes.some((size) => size === 0)) return [];
  if (n <= 1) return fullCombinations(sizes, valid);

  const uncovered = new Set<string>();
  const pairs: [number, number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      for (let a = 0; a < sizes[i]!; a++) {
        for (let b = 0; b < sizes[j]!; b++) {
          if (!valid(partial(n, [[i, a], [j, b]]))) continue;
          uncovered.add(pairKey(i, a, j, b));
          pairs.push([i, a, j, b]);
        }
      }
    }
  }

  const out: number[][] = [];
  const add = (combo: number[]): void => {
    out.push(combo);
    for (const key of pairsOf(combo)) uncovered.delete(key);
  };
  const baseline: number[] = Array.from({ length: n }, () => 0);
  if (valid(baseline)) add(baseline);

  for (const [i, a, j, b] of pairs) {
    if (!uncovered.has(pairKey(i, a, j, b))) continue;
    const assignment = partial(n, [[i, a], [j, b]]);
    let complete = true;
    for (let axis = 0; axis < n; axis++) {
      if (assignment[axis] !== undefined) continue;
      let best = -1;
      let bestGain = -1;
      for (let value = 0; value < sizes[axis]!; value++) {
        assignment[axis] = value;
        if (!valid(assignment)) continue;
        let gain = 0;
        for (let other = 0; other < n; other++) {
          const otherValue = assignment[other];
          if (other === axis || otherValue === undefined) continue;
          const key = other < axis ? pairKey(other, otherValue, axis, value) : pairKey(axis, value, other, otherValue);
          if (uncovered.has(key)) gain++;
        }
        if (gain > bestGain) {
          best = value;
          bestGain = gain;
        }
      }
      if (best < 0) {
        complete = false;
        break;
      }
      assignment[axis] = best;
    }
    const combo = assignment as number[];
    if (complete && valid(combo)) add([...combo]);
    else uncovered.delete(pairKey(i, a, j, b));
  }
  return out;
}

/** Deterministic 32-bit PRNG (mulberry32). */
export function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `count` random valid combinations (baseline first), without repeats. */
export function sampleCombinations(sizes: readonly number[], count: number, seed: number, valid: Validity = always): number[][] {
  const all = fullCombinations(sizes, valid);
  if (all.length <= count) return all;
  const random = prng(seed);
  const hasBaseline = all[0]!.every((value) => value === 0);
  const pool = hasBaseline ? all.slice(1) : all.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return hasBaseline ? [all[0]!, ...pool.slice(0, count - 1)] : pool.slice(0, count);
}
