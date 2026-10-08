import type { InnerRegion, Rect } from '../types.js';

/**
 * Masonry: place each photo into the currently-shortest column, then
 * scale all columns vertically to fit the region height. Column count
 * is capped at the photo count. Returned rects are indexed by photo
 * position (matching the input `aspects` order).
 */
export function masonry(
  aspects: readonly number[],
  region: InnerRegion,
  columns: number,
): Rect[] {
  const n = aspects.length;
  if (n === 0) return [];

  const { x: innerX, y: innerY, w: innerW, h: innerH, gap } = region;
  const cols = Math.min(columns, n);
  const cellW = (innerW - gap * (cols - 1)) / cols;

  interface ColItem {
    index: number;
    h: number;
  }
  const colItems: ColItem[][] = Array.from({ length: cols }, () => []);
  const colHeights = new Array<number>(cols).fill(0);

  for (let i = 0; i < n; i++) {
    const ar = aspects[i];
    const h = cellW / ar;
    let target = 0;
    for (let c = 1; c < cols; c++) {
      if (colHeights[c] < colHeights[target]) target = c;
    }
    colItems[target].push({ index: i, h });
    colHeights[target] += h + gap;
  }

  // Trim trailing gap from each col height
  for (let c = 0; c < cols; c++) {
    if (colItems[c].length > 0) colHeights[c] -= gap;
  }
  const tallest = Math.max(...colHeights, 1);
  const scale = innerH / tallest;

  const out: Rect[] = new Array<Rect>(n);
  for (let c = 0; c < cols; c++) {
    const colH = colHeights[c] * scale;
    let y = innerY + (innerH - colH) / 2;
    for (const item of colItems[c]) {
      const h = item.h * scale;
      out[item.index] = {
        x: innerX + c * (cellW + gap),
        y,
        w: cellW,
        h,
      };
      y += h + gap;
    }
  }
  return out;
}
