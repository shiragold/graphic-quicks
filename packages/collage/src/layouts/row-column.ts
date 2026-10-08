import type { InnerRegion, Rect } from '../types.js';

/**
 * `count` equal-width cells laid out in a single row. Each cell spans
 * the full region height. Aspect ratios are ignored — the caller is
 * expected to cover-fit each photo into its rect.
 */
export function singleRow(count: number, region: InnerRegion): Rect[] {
  const n = count;
  if (n === 0) return [];
  const { x: innerX, y: innerY, w: innerW, h: innerH, gap } = region;
  const cellW = (innerW - gap * (n - 1)) / n;
  const rects: Rect[] = new Array<Rect>(n);
  for (let i = 0; i < n; i++) {
    rects[i] = {
      x: innerX + i * (cellW + gap),
      y: innerY,
      w: cellW,
      h: innerH,
    };
  }
  return rects;
}

/**
 * `count` equal-height cells laid out in a single column. Each cell
 * spans the full region width.
 */
export function singleColumn(count: number, region: InnerRegion): Rect[] {
  const n = count;
  if (n === 0) return [];
  const { x: innerX, y: innerY, w: innerW, h: innerH, gap } = region;
  const cellH = (innerH - gap * (n - 1)) / n;
  const rects: Rect[] = new Array<Rect>(n);
  for (let i = 0; i < n; i++) {
    rects[i] = {
      x: innerX,
      y: innerY + i * (cellH + gap),
      w: innerW,
      h: cellH,
    };
  }
  return rects;
}
