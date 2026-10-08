import type { InnerRegion, Rect } from '../types.js';
import type { MosaicNode } from '../mosaic-templates.js';
import { MOSAIC_TEMPLATES } from '../mosaic-templates.js';

/**
 * Mosaic layout using the fixed templates in `MOSAIC_TEMPLATES` for
 * photo counts 1..9. Cells are placed by the template's row/col weight
 * hierarchy, then photos are greedily assigned to cells: the largest
 * cells pick the best-matching photo by log-aspect distance (so the
 * hero cell gets the aspect-fittest photo).
 *
 * Returns `[]` for `n < 1` or `n > 9`. Returned array is indexed by
 * original photo position.
 */
export function mosaic(
  aspects: readonly number[],
  region: InnerRegion,
): Rect[] {
  const n = aspects.length;
  const rects: Rect[] = [];
  if (n === 0) return rects;

  const tplDef = MOSAIC_TEMPLATES[n];
  if (!tplDef) return rects;

  const { x: innerX, y: innerY, w: innerW, h: innerH, gap } = region;
  const orient: 'L' | 'P' = innerW >= innerH ? 'L' : 'P';
  const root: MosaicNode = tplDef[orient] ?? tplDef.L;

  // Collect leaf rects in DFS order (matches the leaf order of the
  // template tree). Pure recursion; no mutation of the template nodes.
  const leafRects: Rect[] = [];
  place(root, innerX, innerY, innerW, innerH, gap, leafRects);

  // Greedy assignment: largest cells first pick the photo whose aspect
  // best matches the cell's aspect (log-distance, scale-invariant).
  const cells = leafRects
    .map((rect, i) => ({ rect, area: rect.w * rect.h, order: i }))
    .sort((a, b) => b.area - a.area);

  const taken = new Set<number>();
  const out: Rect[] = new Array<Rect>(n);
  for (const cell of cells) {
    const ca = cell.rect.w / cell.rect.h;
    const caLog = Math.log(ca);
    let bestPhoto = -1;
    let bestCost = Infinity;
    for (let i = 0; i < n; i++) {
      if (taken.has(i)) continue;
      const ar = aspects[i];
      const cost = Math.abs(Math.log(ar) - caLog);
      if (cost < bestCost - 1e-9) {
        bestCost = cost;
        bestPhoto = i;
      }
    }
    taken.add(bestPhoto);
    out[bestPhoto] = cell.rect;
  }
  return out;
}

function place(
  node: MosaicNode,
  x: number,
  y: number,
  w: number,
  h: number,
  gap: number,
  out: Rect[],
): void {
  if (node.type === 'leaf') {
    out.push({ x, y, w: Math.max(1, w), h: Math.max(1, h) });
    return;
  }
  const k = node.children.length;
  const weights = node.children.map((c) => c.weight ?? 1);
  const sum = weights.reduce((a, b) => a + b, 0);
  const totalGap = gap * (k - 1);
  if (node.type === 'row') {
    const innerW = Math.max(1, w - totalGap);
    let cx = x;
    for (let i = 0; i < k; i++) {
      const cw = innerW * (weights[i] / sum);
      place(node.children[i], cx, y, cw, h, gap, out);
      cx += cw + gap;
    }
  } else {
    const innerH = Math.max(1, h - totalGap);
    let cy = y;
    for (let i = 0; i < k; i++) {
      const ch = innerH * (weights[i] / sum);
      place(node.children[i], x, cy, w, ch, gap, out);
      cy += ch + gap;
    }
  }
}
