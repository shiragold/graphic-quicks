import type { InnerRegion, Rect } from '../types.js';

/**
 * Fixed-column grid with variable row heights. Photos are partitioned
 * into consecutive chunks of `columns` (last row may be shorter). Each
 * row fills the region width by picking its own height from the row's
 * aspect sum. The whole stack is scaled down (if needed) to fit the
 * region height and centered vertically.
 */
export function grid(
  aspects: readonly number[],
  region: InnerRegion,
  columns: number,
): Rect[] {
  const n = aspects.length;
  const rects: Rect[] = [];
  if (n === 0) return rects;

  const { x: innerX, y: innerY, w: innerW, h: innerH, gap } = region;
  const cols = Math.min(columns, n);

  interface RowDef {
    start: number;
    end: number;
    height: number;
  }
  const rowDefs: RowDef[] = [];
  let totalH = 0;
  for (let start = 0; start < n; start += cols) {
    const end = Math.min(start + cols, n);
    let sumA = 0;
    for (let k = start; k < end; k++) sumA += aspects[k];
    const availW = innerW - gap * (end - start - 1);
    const rowH = availW / sumA;
    rowDefs.push({ start, end, height: rowH });
    totalH += rowH;
  }
  totalH += gap * (rowDefs.length - 1);

  const scale = Math.min(1, innerH / totalH);
  const offsetX = innerX + (innerW - innerW * scale) / 2;
  const offsetY = innerY + (innerH - totalH * scale) / 2;

  let y = offsetY;
  for (const row of rowDefs) {
    const rowH = row.height * scale;
    let x = offsetX;
    for (let k = row.start; k < row.end; k++) {
      const w = aspects[k] * rowH;
      rects.push({ x, y, w, h: rowH });
      x += w + gap * scale;
    }
    y += rowH + gap * scale;
  }
  return rects;
}
