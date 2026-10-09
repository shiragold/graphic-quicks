import type { InnerRegion, Rect } from '../types.js';

/**
 * Uniform grid. Every row uses the same column tracks: equal cell width
 * and equal cell height, filling the region. `columns` is capped at the
 * photo count. A short last row keeps that cell size, so its photos sit
 * in the same columns as the rows above instead of stretching to a
 * different count.
 */
export function grid(
  aspects: readonly number[],
  region: InnerRegion,
  columns: number,
): Rect[] {
  const n = aspects.length;
  if (n === 0) return [];

  const { x: innerX, y: innerY, w: innerW, h: innerH, gap } = region;
  const cols = Math.min(Math.max(1, columns), n);
  const rows = Math.ceil(n / cols);
  const cellW = (innerW - gap * (cols - 1)) / cols;
  const cellH = (innerH - gap * (rows - 1)) / rows;

  const rects: Rect[] = new Array<Rect>(n);
  for (let i = 0; i < n; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    rects[i] = {
      x: innerX + col * (cellW + gap),
      y: innerY + row * (cellH + gap),
      w: cellW,
      h: cellH,
    };
  }
  return rects;
}
