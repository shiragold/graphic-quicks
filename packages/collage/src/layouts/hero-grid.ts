import type { HeroPosition, InnerRegion, Rect } from '../types.js';

/**
 * Hero + grid layout. Index 0 is the hero (large) photo; the remaining
 * photos are laid out in a supporting grid on one or both sides.
 *
 * Split direction: vertical band if the region is landscape, horizontal
 * if portrait. Position `'start' | 'center' | 'end'` selects where the
 * hero goes (`'center'` splits the supporting grid onto both sides).
 */
export function heroGrid(
  aspects: readonly number[],
  region: InnerRegion,
  heroPos: HeroPosition,
): Rect[] {
  const n = aspects.length;
  if (n === 0) return [];

  const { x: innerX, y: innerY, w: innerW, h: innerH, gap } = region;

  if (n === 1) {
    return [{ x: innerX, y: innerY, w: innerW, h: innerH }];
  }

  const horizontal = innerW > innerH;
  const heroFrac = 0.5;
  const pos = heroPos;
  const heroIdx = 0;
  const restIndices: number[] = [];
  for (let i = 0; i < n; i++) if (i !== heroIdx) restIndices.push(i);

  interface GridRegion {
    x: number;
    y: number;
    w: number;
    h: number;
    indices: number[];
  }

  let heroRect: Rect;
  const gridRegions: GridRegion[] = [];
  if (horizontal) {
    const heroW = innerW * heroFrac;
    const restW = innerW - heroW - gap;
    if (pos === 'start') {
      heroRect = { x: innerX, y: innerY, w: heroW, h: innerH };
      gridRegions.push({
        x: innerX + heroW + gap,
        y: innerY,
        w: restW,
        h: innerH,
        indices: restIndices,
      });
    } else if (pos === 'end') {
      heroRect = {
        x: innerX + restW + gap,
        y: innerY,
        w: heroW,
        h: innerH,
      };
      gridRegions.push({
        x: innerX,
        y: innerY,
        w: restW,
        h: innerH,
        indices: restIndices,
      });
    } else {
      const sideW = (innerW - heroW - 2 * gap) / 2;
      heroRect = {
        x: innerX + sideW + gap,
        y: innerY,
        w: heroW,
        h: innerH,
      };
      const half = Math.ceil(restIndices.length / 2);
      gridRegions.push({
        x: innerX,
        y: innerY,
        w: sideW,
        h: innerH,
        indices: restIndices.slice(0, half),
      });
      gridRegions.push({
        x: innerX + sideW + gap + heroW + gap,
        y: innerY,
        w: sideW,
        h: innerH,
        indices: restIndices.slice(half),
      });
    }
  } else {
    const heroH = innerH * heroFrac;
    const restH = innerH - heroH - gap;
    if (pos === 'start') {
      heroRect = { x: innerX, y: innerY, w: innerW, h: heroH };
      gridRegions.push({
        x: innerX,
        y: innerY + heroH + gap,
        w: innerW,
        h: restH,
        indices: restIndices,
      });
    } else if (pos === 'end') {
      heroRect = {
        x: innerX,
        y: innerY + restH + gap,
        w: innerW,
        h: heroH,
      };
      gridRegions.push({
        x: innerX,
        y: innerY,
        w: innerW,
        h: restH,
        indices: restIndices,
      });
    } else {
      const sideH = (innerH - heroH - 2 * gap) / 2;
      heroRect = {
        x: innerX,
        y: innerY + sideH + gap,
        w: innerW,
        h: heroH,
      };
      const half = Math.ceil(restIndices.length / 2);
      gridRegions.push({
        x: innerX,
        y: innerY,
        w: innerW,
        h: sideH,
        indices: restIndices.slice(0, half),
      });
      gridRegions.push({
        x: innerX,
        y: innerY + sideH + gap + heroH + gap,
        w: innerW,
        h: sideH,
        indices: restIndices.slice(half),
      });
    }
  }

  const out: Rect[] = new Array<Rect>(n);
  out[heroIdx] = heroRect;

  interface SubRowDef {
    start: number;
    end: number;
    height: number;
  }
  for (const gr of gridRegions) {
    const idxs = gr.indices;
    if (idxs.length === 0) continue;
    const subAspects = idxs.map((i) => aspects[i]);
    const cols = Math.max(
      1,
      Math.min(idxs.length, Math.round(Math.sqrt(idxs.length))),
    );
    const rowDefs: SubRowDef[] = [];
    let totalH = 0;
    for (let start = 0; start < idxs.length; start += cols) {
      const end = Math.min(start + cols, idxs.length);
      let sumA = 0;
      for (let k = start; k < end; k++) sumA += subAspects[k];
      const availW = gr.w - gap * (end - start - 1);
      const rowH = availW / sumA;
      rowDefs.push({ start, end, height: rowH });
      totalH += rowH;
    }
    totalH += gap * (rowDefs.length - 1);
    const scale = Math.min(1, gr.h / totalH);
    const offX = gr.x + (gr.w - gr.w * scale) / 2;
    const offY = gr.y + (gr.h - totalH * scale) / 2;
    let y = offY;
    for (const row of rowDefs) {
      const rowH = row.height * scale;
      let x = offX;
      for (let k = row.start; k < row.end; k++) {
        const w = subAspects[k] * rowH;
        out[idxs[k]] = { x, y, w, h: rowH };
        x += w + gap * scale;
      }
      y += rowH + gap * scale;
    }
  }

  return out;
}
