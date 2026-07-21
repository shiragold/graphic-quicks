import type { InnerRegion, Rect } from '../types.js';

/**
 * Justified layout in the row direction. Every photo is shown in full
 * (no crop). Photos are packed into rows that fill the region width;
 * rows stack vertically and each row picks its own height so aspect
 * ratios are preserved.
 *
 * For arbitrary mixed aspect ratios + a fixed region it's mathematically
 * impossible to always fill the region exactly with no cropping. We
 * pick the row count with the highest coverage after uniform
 * scale-to-fit and center the resulting stack in the region.
 */
export function justifiedRows(
  aspects: readonly number[],
  region: InnerRegion,
): Rect[] {
  return computeJustified(aspects, region, false);
}

/**
 * Justified layout in the column direction — mathematical transpose
 * of {@link justifiedRows}. Photos are packed into columns that fill
 * the region height; columns stack horizontally.
 */
export function justifiedCols(
  aspects: readonly number[],
  region: InnerRegion,
): Rect[] {
  return computeJustified(aspects, region, true);
}

function computeJustified(
  inputAspects: readonly number[],
  region: InnerRegion,
  transpose: boolean,
): Rect[] {
  const { x: innerX, y: innerY, gap } = region;
  // For column mode, transpose the problem: swap canvas dimensions
  // and use 1/aspect (since each photo's role of width <-> height swaps).
  const W = transpose ? region.h : region.w;
  const H = transpose ? region.w : region.h;
  const aspects = inputAspects.map((a) => (transpose ? 1 / a : a));
  const n = aspects.length;
  if (n === 0) return [];

  // Build optimal row partitions via linear partition DP.
  // We minimize the maximum row aspect-sum (classic linear partition)
  // which yields rows with similar heights when each fills the width.
  function partition(k: number): number[] {
    if (k >= n) k = n;
    if (k <= 1) return [n];
    const prefix = new Array<number>(n + 1).fill(0);
    for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + aspects[i];
    const dp: number[][] = Array.from({ length: n + 1 }, () =>
      new Array<number>(k + 1).fill(Infinity),
    );
    const parent: number[][] = Array.from({ length: n + 1 }, () =>
      new Array<number>(k + 1).fill(0),
    );
    dp[0][0] = 0;
    for (let i = 1; i <= n; i++) {
      dp[i][1] = prefix[i];
      parent[i][1] = 0;
    }
    for (let j = 2; j <= k; j++) {
      for (let i = j; i <= n; i++) {
        for (let p = j - 1; p < i; p++) {
          const cost = Math.max(dp[p][j - 1], prefix[i] - prefix[p]);
          if (cost < dp[i][j]) {
            dp[i][j] = cost;
            parent[i][j] = p;
          }
        }
      }
    }
    const breaks: number[] = [];
    let i = n;
    let j = k;
    while (j > 0) {
      breaks.push(i);
      i = parent[i][j];
      j--;
    }
    breaks.reverse();
    return breaks;
  }

  interface RowDef {
    start: number;
    end: number;
    height: number;
  }
  function buildRows(breaks: number[]): { rows: RowDef[]; totalH: number } {
    const rows: RowDef[] = [];
    let start = 0;
    let totalH = 0;
    for (let bi = 0; bi < breaks.length; bi++) {
      const end = breaks[bi];
      let sumA = 0;
      for (let k = start; k < end; k++) sumA += aspects[k];
      const numInRow = end - start;
      const availW = W - (numInRow - 1) * gap;
      const rowH = availW / sumA;
      rows.push({ start, end, height: rowH });
      totalH += rowH;
      if (bi < breaks.length - 1) totalH += gap;
      start = end;
    }
    return { rows, totalH };
  }

  let bestScore = -Infinity;
  let bestRows: RowDef[] | null = null;
  let bestScale = 1;
  for (let k = 1; k <= n; k++) {
    const breaks = partition(k);
    const { rows, totalH } = buildRows(breaks);
    const scale = Math.min(1, H / totalH);
    const coverage = (W * scale * totalH * scale) / (W * H);
    if (coverage > bestScore) {
      bestScore = coverage;
      bestRows = rows;
      bestScale = scale;
    }
  }

  // bestRows is guaranteed non-null because the k=1 iteration always
  // runs when n >= 1 (and we returned early for n === 0).
  const rows = bestRows as RowDef[];
  let totalH = 0;
  for (let r = 0; r < rows.length; r++) {
    totalH += rows[r].height;
    if (r < rows.length - 1) totalH += gap;
  }
  const finalW = W * bestScale;
  const finalH = totalH * bestScale;

  // Build rectangles in transposed (local) coordinates, then map
  // back to real coordinates. Local axes: u = along the row (length W),
  // v = stacking axis (height H).
  const offsetU = (W - finalW) / 2;
  const offsetV = (H - finalH) / 2;

  const out: Rect[] = new Array<Rect>(n);
  let v = offsetV;
  for (const row of rows) {
    const rowH = row.height * bestScale;
    let u = offsetU;
    for (let k = row.start; k < row.end; k++) {
      const wLocal = aspects[k] * rowH;
      if (transpose) {
        out[k] = {
          x: innerX + v,
          y: innerY + u,
          w: rowH,
          h: wLocal,
        };
      } else {
        out[k] = {
          x: innerX + u,
          y: innerY + v,
          w: wLocal,
          h: rowH,
        };
      }
      u += wLocal + gap * bestScale;
    }
    v += rowH + gap * bestScale;
  }
  return out;
}
